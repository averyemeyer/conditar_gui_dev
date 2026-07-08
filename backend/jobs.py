from __future__ import annotations

import json
import os
import queue
import shlex
import shutil
import smtplib
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path


TERMINAL_STATES = {"completed", "failed", "canceled"}
SLURM_PENDING_STATES = {"CONFIGURING", "PENDING", "REQUEUED", "RESIZING", "SUSPENDED"}
SLURM_RUNNING_STATES = {"COMPLETING", "RUNNING", "STAGE_OUT"}
SLURM_SUCCESS_STATES = {"COMPLETED"}
SLURM_FAILURE_STATES = {
    "BOOT_FAIL",
    "CANCELLED",
    "DEADLINE",
    "FAILED",
    "NODE_FAIL",
    "OUT_OF_MEMORY",
    "PREEMPTED",
    "REVOKED",
    "SPECIAL_EXIT",
    "TIMEOUT",
}


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
        self.docker_image = os.environ.get("CONDITAR_DOCKER_IMAGE", "localhost/conditar-dev:container-dev")
        self.container_runtime_kind, self.container_runtime = self._resolve_container_runtime()
        self.default_tmp = Path(os.environ.get("CONDITAR_TMP", "/tmp/conditar-gui"))
        self.sbatch_bin = os.environ.get("SBATCH_BIN") or shutil.which("sbatch")
        self.squeue_bin = os.environ.get("SQUEUE_BIN") or shutil.which("squeue")
        self.sacct_bin = os.environ.get("SACCT_BIN") or shutil.which("sacct")
        self.slurm_defaults = {
            "account": os.environ.get("CONDITAR_SLURM_ACCOUNT", ""),
            "partition": os.environ.get("CONDITAR_SLURM_PARTITION", ""),
            "time": os.environ.get("CONDITAR_SLURM_TIME", "04:00:00"),
            "mem": os.environ.get("CONDITAR_SLURM_MEM", "32G"),
            "cpus": os.environ.get("CONDITAR_SLURM_CPUS", "4"),
            "gpus": os.environ.get("CONDITAR_SLURM_GPUS", "1"),
        }
        self.docker_tar = os.environ.get("CONDITAR_DOCKER_TAR", "")
        self._queue: queue.Queue[str] = queue.Queue()
        self._processes: dict[str, subprocess.Popen] = {}
        self._lock = threading.Lock()
        self.job_root.mkdir(parents=True, exist_ok=True)
        self._recover_incomplete_jobs()
        self._worker = threading.Thread(target=self._work_loop, daemon=True)
        self._worker.start()

    def submit(self, payload: dict) -> dict:
        target = payload.get("target", "local_cpu")
        if target not in {"local_cpu", "osc_gpu"}:
            raise ValueError("Only local_cpu and osc_gpu jobs are supported.")
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
        parameters["device"] = "cuda:0" if target == "osc_gpu" else "cpu"
        postprocess = self._postprocess_options(payload.get("postprocess") or {})
        command = self._build_command(paths, pdb_path, sdf_path, parameters, target, postprocess)
        slurm_options = self._slurm_options(payload.get("slurm") or {}) if target == "osc_gpu" else None
        job = {
            "id": job_id,
            "target": target,
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
            "postprocess": postprocess,
            "slurm": slurm_options,
            "container": {
                "backend": "slurm_podman" if target == "osc_gpu" else self.container_runtime_kind,
                "runtime": os.environ.get("PODMAN_BIN", "podman") if target == "osc_gpu" else self.container_runtime,
                "docker_image": self.docker_image if target == "osc_gpu" or self.container_runtime_kind in {"docker", "podman"} else None,
                "sif": str(self.sif_path) if self.container_runtime_kind in {"apptainer", "singularity"} else None,
            },
            "command": command,
            "exit_code": None,
            "error_message": None,
        }
        self._write_job(paths, job)
        if target == "osc_gpu":
            job = self._submit_slurm_job(job, paths, pdb_path, sdf_path)
        else:
            self._queue.put(job_id)
        return job

    def list_jobs(self) -> list[dict]:
        jobs = [self._refresh_job(self._read_job(path.parent.name)) for path in self.job_root.glob("*/job.json")]
        return sorted((job for job in jobs if job), key=lambda item: item["created_at"], reverse=True)

    def get_job(self, job_id: str) -> dict | None:
        return self._refresh_job(self._read_job(job_id))

    def _read_job(self, job_id: str) -> dict | None:
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
        score_files = []
        for path in sorted(paths.outputs.rglob("vina_scores.*")):
            score_files.append({
                "name": path.name,
                "relative_path": str(path.relative_to(paths.root)),
                "text": path.read_text(errors="replace"),
            })
        return {"job_id": job_id, "files": files, "score_files": score_files}

    def cancel(self, job_id: str) -> dict:
        job = self.get_job(job_id)
        if not job:
            raise ValueError("Unknown job.")
        if job["status"] in TERMINAL_STATES:
            return job
        if job.get("target") == "osc_gpu":
            slurm_job_id = (job.get("slurm") or {}).get("job_id")
            scancel = shutil.which(os.environ.get("SCANCEL_BIN", "")) if os.environ.get("SCANCEL_BIN") else shutil.which("scancel")
            if slurm_job_id and scancel:
                subprocess.run([scancel, slurm_job_id], check=False)
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

    def _build_command(
        self,
        paths: JobPaths,
        pdb_path: Path,
        sdf_path: Path | None,
        parameters: dict,
        target: str = "local_cpu",
        postprocess: dict | None = None,
    ) -> list[str]:
        if target == "osc_gpu":
            return self._build_docker_command(paths, pdb_path, sdf_path, parameters, device="cuda:0", gpu=True, postprocess=postprocess)
        if not self.container_runtime:
            raise ValueError(
                "Container runtime not found. Install Docker/Podman for local CPU runs, "
                "or Apptainer/Singularity for SIF runs. You can set CONDITAR_RUNTIME, "
                "DOCKER_BIN, PODMAN_BIN, or APPTAINER_BIN."
            )
        if self.container_runtime_kind in {"apptainer", "singularity"}:
            return self._build_apptainer_command(paths, pdb_path, sdf_path, parameters)
        if self.container_runtime_kind in {"docker", "podman"}:
            return self._build_docker_command(paths, pdb_path, sdf_path, parameters, device="cpu", gpu=False, postprocess=postprocess)
        raise ValueError(f"Unsupported container runtime: {self.container_runtime_kind}")

    def _build_apptainer_command(
        self,
        paths: JobPaths,
        pdb_path: Path,
        sdf_path: Path | None,
        parameters: dict,
    ) -> list[str]:
        if not self.sif_path.exists():
            raise ValueError(f"Container image not found: {self.sif_path}")
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

    def _build_docker_command(
        self,
        paths: JobPaths,
        pdb_path: Path,
        sdf_path: Path | None,
        parameters: dict,
        device: str = "cpu",
        gpu: bool = False,
        postprocess: dict | None = None,
    ) -> list[str]:
        tmp_dir = paths.root / "tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        runtime = os.environ.get("PODMAN_BIN", "podman") if gpu else self.container_runtime
        command = [
            runtime,
            "run",
            "--rm",
        ]
        if gpu:
            command.extend(["--device", "nvidia.com/gpu=all"])
        command.extend([
            "-e",
            f"CONDITAR_DEVICE={device}",
            "-v",
            f"{paths.inputs.resolve()}:/inputs:ro",
            "-v",
            f"{paths.outputs.resolve()}:/results",
            "-v",
            f"{tmp_dir.resolve()}:/tmp/conditar",
            self.docker_image,
            "--pdb",
            f"/inputs/{pdb_path.name}",
            "--out",
            "/results",
            "--tmp-dir",
            "/tmp/conditar",
            "--device",
            device,
        ])
        if sdf_path:
            command.extend(["--sdf", f"/inputs/{sdf_path.name}"])
        for gui_key, cli_key in (
            ("num_samples", "--num-samples"),
            ("batch_size", "--batch-size"),
            ("pocket_radius", "--pocket-radius"),
        ):
            value = parameters.get(gui_key)
            if value not in (None, ""):
                command.extend([cli_key, str(value)])
        self._append_postprocess_args(command, postprocess)
        return command

    def _resolve_container_runtime(self) -> tuple[str | None, str | None]:
        requested = os.environ.get("CONDITAR_RUNTIME", "auto").lower()
        if requested in {"apptainer", "singularity"}:
            return requested, self._resolve_executable("APPTAINER_BIN", requested)
        if requested in {"docker", "podman"}:
            return requested, self._resolve_executable(f"{requested.upper()}_BIN", requested)
        if requested != "auto":
            return requested, None

        podman = self._resolve_executable("PODMAN_BIN", "podman")
        if podman:
            return "podman", podman
        docker = self._resolve_executable("DOCKER_BIN", "docker")
        if docker:
            return "docker", docker

        apptainer = shutil.which(os.environ.get("APPTAINER_BIN", "")) if os.environ.get("APPTAINER_BIN") else None
        apptainer = apptainer or shutil.which("apptainer") or shutil.which("singularity")
        if self.sif_path.exists() and apptainer:
            kind = "singularity" if Path(apptainer).name == "singularity" else "apptainer"
            return kind, apptainer
        return None, None

    def _resolve_executable(self, env_name: str, fallback: str) -> str | None:
        configured = os.environ.get(env_name)
        if configured:
            return configured if shutil.which(configured) else None
        return shutil.which(fallback)

    def _postprocess_options(self, payload_options: dict) -> dict:
        vina_enabled = bool(payload_options.get("vina"))
        vina_mode = str(payload_options.get("vina_mode") or "vina_score").strip()
        if vina_mode not in {"vina_score", "vina_dock"}:
            raise ValueError("Vina mode must be vina_score or vina_dock.")
        return {
            "vina": vina_enabled,
            "vina_mode": vina_mode,
            "vina_exhaustiveness": str(payload_options.get("vina_exhaustiveness") or "8").strip(),
            "vina_cpu": str(payload_options.get("vina_cpu") or "4").strip(),
        }

    def _append_postprocess_args(self, command: list[str], postprocess: dict | None) -> None:
        if not postprocess or not postprocess.get("vina"):
            return
        command.extend([
            "--vina-score",
            "--vina-mode",
            postprocess.get("vina_mode") or "vina_score",
            "--vina-exhaustiveness",
            str(postprocess.get("vina_exhaustiveness") or "8"),
            "--vina-cpu",
            str(postprocess.get("vina_cpu") or "4"),
        ])

    def _submit_slurm_job(self, job: dict, paths: JobPaths, pdb_path: Path, sdf_path: Path | None) -> dict:
        if not self.sbatch_bin:
            raise ValueError("sbatch not found. Start the GUI on OSC with Slurm available or set SBATCH_BIN.")
        slurm = self._slurm_options(job.get("slurm") or {})
        script_path = paths.root / "run.slurm"
        script_path.write_text(self._slurm_script(job, paths, pdb_path, sdf_path, slurm))
        job["slurm"] = {
            **slurm,
            "script": str(script_path.relative_to(paths.root)),
            "job_id": None,
            "state": None,
        }
        self._write_job(paths, job)

        result = subprocess.run(
            [self.sbatch_bin, str(script_path)],
            cwd=str(self.project_root),
            text=True,
            capture_output=True,
            check=False,
        )
        (paths.logs / "sbatch.stdout.log").write_text(result.stdout)
        (paths.logs / "sbatch.stderr.log").write_text(result.stderr)
        if result.returncode != 0:
            job["status"] = "failed"
            job["finished_at"] = utc_now()
            job["exit_code"] = result.returncode
            job["error_message"] = result.stderr.strip() or "sbatch submission failed."
            self._write_job(paths, job)
            self._send_email(job, paths)
            return job

        slurm_job_id = self._parse_sbatch_job_id(result.stdout)
        job["slurm"]["job_id"] = slurm_job_id
        job["status"] = "queued"
        self._write_job(paths, job)
        return job

    def _slurm_options(self, payload_options: dict) -> dict:
        merged = {**self.slurm_defaults, **(payload_options or {})}
        return {
            "account": str(merged.get("account") or "").strip(),
            "partition": str(merged.get("partition") or "").strip(),
            "time": str(merged.get("time") or "04:00:00").strip(),
            "mem": str(merged.get("mem") or "32G").strip(),
            "cpus": str(merged.get("cpus") or "4").strip(),
            "gpus": str(merged.get("gpus") or "1").strip(),
        }

    def _slurm_script(
        self,
        job: dict,
        paths: JobPaths,
        pdb_path: Path,
        sdf_path: Path | None,
        slurm: dict,
    ) -> str:
        lines = [
            "#!/usr/bin/env bash",
            f"#SBATCH --job-name=conditar-{job['id'][-8:]}",
            f"#SBATCH --output={paths.stdout}",
            f"#SBATCH --error={paths.stderr}",
            "#SBATCH --nodes=1",
            "#SBATCH --ntasks=1",
            f"#SBATCH --cpus-per-task={slurm['cpus']}",
            f"#SBATCH --mem={slurm['mem']}",
            f"#SBATCH --time={slurm['time']}",
            f"#SBATCH --gpus={slurm['gpus']}",
        ]
        if slurm["account"]:
            lines.append(f"#SBATCH --account={slurm['account']}")
        if slurm["partition"]:
            lines.append(f"#SBATCH --partition={slurm['partition']}")

        command = self._build_docker_command(
            paths,
            pdb_path,
            sdf_path,
            job["parameters"],
            device="cuda:0",
            gpu=True,
            postprocess=job.get("postprocess"),
        )
        command_text = " ".join(shlex.quote(part) for part in command)
        podman_command = shlex.quote(os.environ.get("PODMAN_BIN", "podman"))
        image_check = ""
        if self.docker_tar:
            image_check = "\n".join([
                f"if ! {podman_command} image exists {shlex.quote(self.docker_image)}; then",
                f"  if [[ ! -f {shlex.quote(self.docker_tar)} ]]; then",
                f"    echo \"Container image archive not found: {shlex.quote(self.docker_tar)}\" >&2",
                "    exit 127",
                "  fi",
                f"  {podman_command} load -i {shlex.quote(self.docker_tar)}",
                "fi",
            ])

        return "\n".join([
            *lines,
            "",
            "set +e",
            "echo \"Starting conDitar Slurm job at $(date)\"",
            image_check,
            f"echo \"$ {command_text}\"",
            command_text,
            "rc=$?",
            f"echo \"$rc\" > {shlex.quote(str(paths.logs / 'exit_code.txt'))}",
            "echo \"Finished conDitar Slurm job at $(date) with exit code $rc\"",
            "exit $rc",
            "",
        ])

    def _parse_sbatch_job_id(self, stdout: str) -> str | None:
        parts = stdout.strip().split()
        return parts[-1] if parts else None

    def _refresh_job(self, job: dict | None) -> dict | None:
        if not job or job.get("status") in TERMINAL_STATES:
            return job
        if job.get("target") != "osc_gpu":
            return job

        paths = self._paths(job["id"])
        exit_code_path = paths.logs / "exit_code.txt"
        if exit_code_path.exists():
            try:
                exit_code = int(exit_code_path.read_text().strip())
            except ValueError:
                exit_code = 1
            job["exit_code"] = exit_code
            job["finished_at"] = job.get("finished_at") or utc_now()
            job["status"] = "completed" if exit_code == 0 else "failed"
            if exit_code != 0:
                job["error_message"] = f"Slurm container command exited with status {exit_code}."
            self._write_job(paths, job)
            self._send_email(job, paths)
            return job

        state = self._slurm_state(job)
        if state:
            job.setdefault("slurm", {})["state"] = state
            if state in SLURM_PENDING_STATES:
                job["status"] = "queued"
            elif state in SLURM_RUNNING_STATES:
                job["status"] = "running"
                job["started_at"] = job.get("started_at") or utc_now()
            elif state in SLURM_SUCCESS_STATES:
                job["status"] = "completed" if list(paths.outputs.rglob("*.sdf")) else "failed"
                job["finished_at"] = job.get("finished_at") or utc_now()
                job["exit_code"] = 0 if job["status"] == "completed" else 1
                if job["status"] == "failed":
                    job["error_message"] = "Slurm completed but no SDF outputs were found."
                self._send_email(job, paths)
            elif state in SLURM_FAILURE_STATES:
                job["status"] = "failed"
                job["finished_at"] = job.get("finished_at") or utc_now()
                job["exit_code"] = 1
                job["error_message"] = f"Slurm job ended with state {state}."
                self._send_email(job, paths)
            self._write_job(paths, job)
        return job

    def _slurm_state(self, job: dict) -> str | None:
        slurm_job_id = (job.get("slurm") or {}).get("job_id")
        if not slurm_job_id:
            return None
        for command in self._slurm_state_commands(slurm_job_id):
            result = subprocess.run(command, text=True, capture_output=True, check=False)
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip().splitlines()[0].split("|")[0].strip().split()[0]
        return None

    def _slurm_state_commands(self, slurm_job_id: str) -> list[list[str]]:
        commands = []
        if self.squeue_bin:
            commands.append([self.squeue_bin, "-h", "-j", slurm_job_id, "-o", "%T"])
        if self.sacct_bin:
            commands.append([self.sacct_bin, "-n", "-X", "-j", slurm_job_id, "-o", "State", "-P"])
        return commands

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
                if job.get("target") == "osc_gpu":
                    continue
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
        smtp_host = os.environ.get("CONDITAR_SMTP_HOST")
        if smtp_host:
            self._send_smtp_email(job, paths, subject, body)
            return
        sendmail = shutil.which("sendmail")
        if sendmail:
            message = f"Subject: {subject}\nTo: {job['email']}\n\n{body}\n"
            subprocess.run([sendmail, "-t"], input=message, text=True, check=False)
            return
        (paths.logs / "email_notice.txt").write_text(f"To: {job['email']}\nSubject: {subject}\n\n{body}\n")

    def _send_smtp_email(self, job: dict, paths: JobPaths, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["To"] = job["email"]
        msg["From"] = os.environ.get("CONDITAR_SMTP_FROM", os.environ.get("CONDITAR_SMTP_USER", "conditar-gui@localhost"))
        msg.set_content(body)

        host = os.environ["CONDITAR_SMTP_HOST"]
        port = int(os.environ.get("CONDITAR_SMTP_PORT", "587"))
        user = os.environ.get("CONDITAR_SMTP_USER")
        password = os.environ.get("CONDITAR_SMTP_PASSWORD")
        use_tls = os.environ.get("CONDITAR_SMTP_TLS", "true").lower() not in {"0", "false", "no"}
        try:
            with smtplib.SMTP(host, port, timeout=30) as server:
                if use_tls:
                    server.starttls()
                if user and password:
                    server.login(user, password)
                server.send_message(msg)
        except Exception as error:
            (paths.logs / "email_notice.txt").write_text(
                f"To: {job['email']}\nSubject: {subject}\n\n{body}\n\nSMTP delivery failed: {error}\n"
            )
