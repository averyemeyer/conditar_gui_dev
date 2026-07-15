# conDitar Studio Internal Testing

Use this checklist before handing a GUI/backend build to lab testers.

## Start the GUI

On a local CPU machine with Docker Desktop:

```bash
cd /path/to/conditar_gui_dev
docker load -i /path/to/localhost_conditar-dev_container-dev-20260710-105038.tar.gz
docker image inspect localhost/conditar-dev:container-dev >/dev/null
CONDITAR_RUNTIME=docker python serve.py --open
```

If the archive is still on OSC, copy it first from a local terminal:

```bash
rsync -avP \
  <OSC_USER>@<OSC_LOGIN_HOST>:/fs/ess/PCON0041/mey200/container_images/localhost_conditar-dev_container-dev-20260710-105038.tar.gz \
  "$HOME/containers/"
```

Docker Desktop must be installed and running for local jobs. `rsync -P` permits
resuming the large archive transfer.

Before submitting a job, verify that the loaded image exposes every supported
post-processing mode:

```bash
docker run --rm localhost/conditar-dev:container-dev --help
```

The `--vina-mode` help text should list `none`, `vina_score`, `vina_dock`,
`qvina`, and `all`.

On an OSC desktop or VM with Podman and Slurm:

```bash
cd /users/PCON0041/mey200/NINGLAB_DEV/conditar_gui_dev
CONDITAR_RUNTIME=podman \
CONDITAR_DOCKER_IMAGE=localhost/conditar-dev:container-dev \
CONDITAR_DOCKER_TAR=/fs/ess/PCON0041/mey200/container_images/localhost_conditar-dev_container-dev-20260710-105038.tar.gz \
CONDITAR_SLURM_ACCOUNT=PCON0041 \
python serve.py --host 0.0.0.0 --port 4173 --open
```

For source-code iteration without rebuilding the container, add:

```bash
CONDITAR_SOURCE_MOUNT=/users/PCON0041/mey200/NINGLAB_DEV/conDitar-dev
```

## Smoke Test Matrix

Run each case with `num_samples=1`, `batch_size=1` first. Turn Vina on for at
least one CPU case and one OSC GPU case.

| Backend | Input mode | Example input | Expected result |
|---|---|---|---|
| Local CPU | Pocket only | `xxxx/xxxx_pocket.pdb` | Completed job with generated SDFs |
| Local CPU | Protein + ligand | `4aua/4aua_protein.pdb` + `4aua/4aua_ligand.sdf` | Completed job with generated SDFs |
| OSC GPU | Pocket only | `xxxx/xxxx_pocket.pdb` | Slurm job moves queued -> running -> completed |
| OSC GPU | Protein + ligand | `4aua/4aua_protein.pdb` + `4aua/4aua_ligand.sdf` | Slurm job moves queued -> running -> completed |
| OSC GPU | Batch folders | Folder upload with one PDB/SDF pair per folder | Multiple jobs created and visible |

Local CPU batch folders are intentionally processed serially by the backend
worker. OSC GPU batch folders are submitted as independent Slurm jobs and may
run in parallel when the account and partition have capacity.

## What to Verify in the GUI

Setup:

- Switching between `Protein + reference ligand` and `Pocket only` changes the
  required upload fields.
- Folder upload skips invalid folders and reports how many were accepted.
- OSC Slurm controls appear only for the OSC GPU target.
- Vina controls appear only when Vina scoring is enabled.

Jobs:

- Newly submitted jobs appear in the Jobs tab.
- OSC jobs display Slurm job IDs when available.
- Jobs do not remain stuck as `queued` after logs show they started.
- Failed or no-output jobs show an error in the selected-job log panel.
- Cancel works for queued/running jobs when Slurm or a local process is active.

Results:

- Completed jobs can be loaded into the Results tab.
- The table includes SMILES, Vina score, Vina minimize, Vina dock/QVina, and status.
- Search matches candidate ID, filename, formula, SMILES, and Vina status.
- Sorting by Vina columns behaves as expected.
- 2D and 3D views render the selected molecule.
- Download ZIP includes generated SDFs, `metrics.csv`, `run_config.json`, logs, and `job_summary.json`.

## Common Debug Paths

Each job is stored under:

```text
job_data/jobs/<job-id>/
```

Useful files:

```text
job.json
run.slurm
logs/stdout.log
logs/stderr.log
logs/sbatch.stdout.log
logs/sbatch.stderr.log
logs/exit_code.txt
outputs/*.sdf
```

If a job failed, first inspect `logs/stderr.log` and `job.json:error_message`.
If OSC status is flaky, the GUI may display a status note while still using the
job logs and output files as fallback evidence.

## Timing Notes

Observed wall-clock runtimes include container startup, model loading,
generation, optional Vina scoring, and output writing. They do not include Slurm
queue wait time.

Small GPU jobs are dominated by startup overhead. Larger GPU jobs should use a
larger batch size when memory allows, for example `num_samples=100` and
`batch_size=100`.

CPU generation is intended as a compatibility and smoke-test path. Even a
single molecule can take several minutes because all 1,000 diffusion steps run
on the CPU; use OSC GPU jobs for normal throughput testing.
