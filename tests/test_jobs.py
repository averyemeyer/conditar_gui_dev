from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.jobs import LocalJobManager


class JobManagerStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tmpdir.name)
        self.manager = LocalJobManager(self.root)
        self.manager.squeue_bin = None
        self.manager.sacct_bin = None
        self.manager.sbatch_bin = None
        self.manager.container_runtime = "/bin/echo"
        self.manager.container_runtime_kind = "docker"

    def tearDown(self) -> None:
        self.tmpdir.cleanup()

    def write_job(self, job_id: str, job: dict) -> Path:
        root = self.root / "job_data" / "jobs" / job_id
        (root / "inputs").mkdir(parents=True)
        (root / "outputs").mkdir()
        (root / "logs").mkdir()
        (root / "job.json").write_text(json.dumps(job))
        return root

    def test_completed_osc_job_normalizes_stale_slurm_state(self) -> None:
        job_id = "stale-slurm"
        self.write_job(job_id, {
            "id": job_id,
            "status": "completed",
            "target": "osc_gpu",
            "created_at": "2026-07-15T00:00:00+00:00",
            "inputs": {},
            "outputs": {"directory": "outputs"},
            "slurm": {"job_id": "6370155_3", "array_job_id": "6370155", "state": "RUNNING"},
        })

        refreshed = self.manager.get_job(job_id)

        self.assertEqual(refreshed["status"], "completed")
        self.assertEqual(refreshed["slurm"]["state"], "COMPLETED")

    def test_osc_output_sdf_marks_running_job_completed(self) -> None:
        job_id = "output-complete"
        job_root = self.write_job(job_id, {
            "id": job_id,
            "status": "running",
            "target": "osc_gpu",
            "created_at": "2026-07-15T00:00:00+00:00",
            "inputs": {},
            "outputs": {"directory": "outputs"},
            "slurm": {"job_id": "123_0", "array_job_id": "123", "state": "RUNNING"},
        })
        (job_root / "outputs" / "result.sdf").write_text("example\n$$$$\n")

        refreshed = self.manager.get_job(job_id)

        self.assertEqual(refreshed["status"], "completed")
        self.assertEqual(refreshed["exit_code"], 0)
        self.assertEqual(refreshed["output_count"], 1)
        self.assertEqual(refreshed["slurm"]["state"], "COMPLETED")

    def test_array_log_files_are_included_as_extra_logs(self) -> None:
        job_id = "array-logs"
        self.write_job(job_id, {
            "id": job_id,
            "status": "running",
            "target": "osc_gpu",
            "created_at": "2026-07-15T00:00:00+00:00",
            "inputs": {},
            "outputs": {"directory": "outputs"},
            "slurm": {"job_id": "456_2", "array_job_id": "456"},
        })
        (self.root / "slurm-456_2.out").write_text("hello from slurm array\n")

        logs = self.manager.logs(job_id)

        self.assertIn("hello from slurm array", logs["extra"])

    def test_batch_array_submission_without_job_id_fails_jobs(self) -> None:
        fake_sbatch = self.root / "fake_sbatch"
        fake_sbatch.write_text("#!/usr/bin/env bash\nexit 0\n")
        fake_sbatch.chmod(0o755)
        self.manager.sbatch_bin = str(fake_sbatch)

        jobs = []
        for index in range(2):
            job_id = f"array-no-id-{index}"
            job_root = self.write_job(job_id, {
                "id": job_id,
                "status": "queued",
                "target": "osc_gpu",
                "created_at": "2026-07-15T00:00:00+00:00",
                "inputs": {"pdb": "inputs/input.pdb"},
                "outputs": {"directory": "outputs"},
                "parameters": {"num_samples": 1, "pocket_radius": 10},
                "postprocess": {"vina": False},
                "slurm": {"account": "TEST", "partition": "", "time": "00:10:00", "mem": "1G", "cpus": "1", "gpus": "1"},
            })
            (job_root / "inputs" / "input.pdb").write_text("HEADER TEST\n")
            jobs.append(json.loads((job_root / "job.json").read_text()))

        self.manager._submit_slurm_array(jobs)

        for job in jobs:
            refreshed = self.manager.get_job(job["id"])
            self.assertEqual(refreshed["status"], "failed")
            self.assertIn("returned no job ID", refreshed["error_message"])


if __name__ == "__main__":
    unittest.main()
