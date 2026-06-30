from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


TERMINAL_STATES = {"completed", "failed", "canceled"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_name(name: str, fallback: str) -> str:
    cleaned = "".join(char for char in name if char.isalnum() or char in "._-")
    return cleaned or fallback


@dataclass
class JobPaths:
    root: Path
    inputs: Path
    outputs: Path
    logs: Path
    metadata: Path
    stdout: Path
    stderr: Path


class LocalJobManager:
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.job_root = project_root / "job_data" / "jobs"
        self.sif_path = Path(os.environ.get(
            "CONDITAR_SIF",
            project_root.parent / "conDitar-dev" / "conditar-dev.sif",
        )).expanduser()
        self.container_runtime = self._resolve_container_runtime()
        self.default_tmp = Path(os.environ.get("CONDITAR_TMP", "/tmp/conditar-gui"))
        self._queue: queue.Queue[str] = queue.Queue()
        self._processes: dict[str, subprocess.Popen] = {}
        self._lock = threading.Lock()
        self.job_root.mkdir(parents=True, exist_ok=True)
        self._recover_incomplete_jobs()
        self._worker = threading.Thread(target=self._work_loop, daemon=True)
        self._worker.start()

    def submit(self, payload: dict) -> dict:
        if payload.get("target", "local_cpu") != "local_cpu":
            raise ValueError("Only local_cpu jobs are supported in this backend slice.")
        pdb = payload.get("pdb") or {}
        if not pdb.get("text"):
            raise ValueError("A PDB input is required.")

        job_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
        paths = self._paths(job_id)
        paths.inputs.mkdir(parents=True)
        paths.outputs.mkdir(parents=True)
        paths.logs.mkdir(parents=True)

        pdb_name = safe_name(pdb.get("name", "input.pdb"), "input.pdb")
        pdb_path = paths.inputs / pdb_name
        pdb_path.write_text(pdb["text"])

        sdf_path = None
        sdf = payload.get("sdf")
        if sdf and sdf.get("text"):
            sdf_name = safe_name(sdf.get("name", "reference.sdf"), "reference.sdf")
            sdf_path = paths.inputs / sdf_name
            sdf_path.write_text(sdf["text"])

        parameters = payload.get("parameters") or {}
        parameters["device"] = "cpu"
        command = self._build_command(paths, pdb_path, sdf_path, parameters)
        job = {
            "id": job_id,
            "target": "local_cpu",
            "status": "queued",
            "created_at": utc_now(),
            "started_at": None,
            "finished_at": None,
            "email": payload.get("email") or None,
            "mode": payload.get("mode") or "pocket",
            "example_id": payload.get("example_id") or None,
            "inputs": {
                "pdb": str(pdb_path.relative_to(paths.root)),
                "sdf": str(sdf_path.relative_to(paths.root)) if sdf_path else None,
            },
            "outputs": {
                "directory": str(paths.outputs.relative_to(paths.root)),
            },
            "parameters": parameters,
            "command": command,
            "exit_code": None,
            "error_message": None,
        }
        self._write_job(paths, job)
        self._queue.put(job_id)
        return job

    def list_jobs(self) -> list[dict]:
        jobs = [self.get_job(path.parent.name) for path in self.job_root.glob("*/job.json")]
        return sorted((job for job in jobs if job), key=lambda item: item["created_at"], reverse=True)

    def get_job(self, job_id: str) -> dict | None:
        metadata = self._paths(job_id).metadata
        if not metadata.exists():
            return None
        return json.loads(metadata.read_text())

    def logs(self, job_id: str) -> dict:
        paths = self._paths(job_id)
        return {
            "stdout": paths.stdout.read_text(errors="replace") if paths.stdout.exists() else "",
            "stderr": paths.stderr.read_text(errors="replace") if paths.stderr.exists() else "",
        }

    def results(self, job_id: str) -> dict:
        paths = self._paths(job_id)
        files = []
        if paths.outputs.exists():
            for path in sorted(paths.outputs.rglob("*.sdf")):
                files.append({
                    "name": path.name,
                    "relative_path": str(path.relative_to(paths.root)),
                    "text": path.read_text(errors="replace"),
                })
        return {"job_id": job_id, "files": files}

    def cancel(self, job_id: str) -> dict:
        job = self.get_job(job_id)
        if not job:
            raise ValueError("Unknown job.")
        if job["status"] in TERMINAL_STATES:
            return job
        process = self._processes.get(job_id)
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
        job["status"] = "canceled"
        job["finished_at"] = utc_now()
        self._write_job(self._paths(job_id), job)
        return job

    def _build_command(self, paths: JobPaths, pdb_path: Path, sdf_path: Path | None, parameters: dict) -> list[str]:
        if not self.sif_path.exists():
            raise ValueError(f"Container image not found: {self.sif_path}")
        if not self.container_runtime:
            raise ValueError(
                "Apptainer/Singularity executable not found. Install a SIF runtime "
                "or set APPTAINER_BIN=/path/to/apptainer."
            )
        command = [
            self.container_runtime,
            "run",
            str(self.sif_path),
            "--pdb",
            str(pdb_path),
            "--out",
            str(paths.outputs),
            "--tmp-dir",
            str(self.default_tmp),
            "--device",
            "cpu",
        ]
        if sdf_path:
            command.extend(["--sdf", str(sdf_path)])
        for gui_key, cli_key in (
            ("num_samples", "--num-samples"),
            ("batch_size", "--batch-size"),
            ("pocket_radius", "--pocket-radius"),
        ):
            value = parameters.get(gui_key)
            if value not in (None, ""):
                command.extend([cli_key, str(value)])
        return command

    def _resolve_container_runtime(self) -> str | None:
        configured = os.environ.get("APPTAINER_BIN")
        if configured:
            return configured if shutil.which(configured) else None
        return shutil.which("apptainer") or shutil.which("singularity")

    def _paths(self, job_id: str) -> JobPaths:
        root = self.job_root / job_id
        return JobPaths(
            root=root,
            inputs=root / "inputs",
            outputs=root / "outputs",
            logs=root / "logs",
            metadata=root / "job.json",
            stdout=root / "logs" / "stdout.log",
            stderr=root / "logs" / "stderr.log",
        )

    def _write_job(self, paths: JobPaths, job: dict) -> None:
        paths.root.mkdir(parents=True, exist_ok=True)
        paths.metadata.write_text(json.dumps(job, indent=2))

    def _recover_incomplete_jobs(self) -> None:
        for job in self.list_jobs():
            if job["status"] not in TERMINAL_STATES:
                job["status"] = "failed"
                job["finished_at"] = utc_now()
                job["error_message"] = "Server restarted before this job completed."
                self._write_job(self._paths(job["id"]), job)

    def _work_loop(self) -> None:
        while True:
            job_id = self._queue.get()
            try:
                self._run(job_id)
            finally:
                self._queue.task_done()

    def _run(self, job_id: str) -> None:
        paths = self._paths(job_id)
        job = self.get_job(job_id)
        if not job or job["status"] == "canceled":
            return
        job["status"] = "running"
        job["started_at"] = utc_now()
        self._write_job(paths, job)

        env = os.environ.copy()
        env["CONDITAR_DEVICE"] = "cpu"
        paths.logs.mkdir(parents=True, exist_ok=True)
        with paths.stdout.open("w") as stdout, paths.stderr.open("w") as stderr:
            stdout.write("$ " + " ".join(job["command"]) + "\n\n")
            stdout.flush()
            process = subprocess.Popen(
                job["command"],
                stdout=stdout,
                stderr=stderr,
                cwd=str(self.project_root),
                env=env,
                start_new_session=True,
            )
            with self._lock:
                self._processes[job_id] = process
            exit_code = process.wait()
            with self._lock:
                self._processes.pop(job_id, None)

        job = self.get_job(job_id) or job
        if job["status"] == "canceled":
            return
        job["exit_code"] = exit_code
        job["finished_at"] = utc_now()
        job["status"] = "completed" if exit_code == 0 else "failed"
        if exit_code != 0:
            job["error_message"] = f"Command exited with status {exit_code}."
        self._write_job(paths, job)
        self._send_email(job, paths)

    def _send_email(self, job: dict, paths: JobPaths) -> None:
        if not job.get("email"):
            return
        subject = f"conDitar job {job['status']}: {job['id']}"
        body = "\n".join([
            f"Job: {job['id']}",
            f"Status: {job['status']}",
            f"Started: {job.get('started_at')}",
            f"Finished: {job.get('finished_at')}",
            f"Output directory: {paths.outputs}",
            f"Error: {job.get('error_message') or ''}",
        ])
        sendmail = shutil.which("sendmail")
        if sendmail:
            message = f"Subject: {subject}\nTo: {job['email']}\n\n{body}\n"
            subprocess.run([sendmail, "-t"], input=message, text=True, check=False)
            return
        (paths.logs / "email_notice.txt").write_text(f"To: {job['email']}\nSubject: {subject}\n\n{body}\n")
