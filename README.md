# conDitar GUI

A lightweight browser GUI for running conDitar molecular generation jobs.

This repository does not contain the conDitar model environment itself. The GUI
starts a small Python web server, stages user-selected PDB/SDF inputs, and then
launches conDitar inside the container image built from `conDitar-dev`.

## How the pieces fit together

```text
conditar_gui_dev
  Browser GUI + Python backend
  Starts jobs, tracks logs/status, reads generated SDF outputs

conDitar-dev container
  Docker/Podman image with conDitar code, dependencies, model files, and sample.py
  Default image name: localhost/conditar-dev:container-dev
```

Typical local flow:

1. Build or load the `conDitar-dev` container image.
2. Start this GUI repo with `CONDITAR_RUNTIME=docker`.
3. Open `http://127.0.0.1:4173`.
4. Choose inputs, settings, and target, then click **Generate molecules**.

Job folders are written under `job_data/jobs/<job-id>/`. That directory is
ignored by git and contains staged inputs, logs, metadata, generated SDFs, and
export ZIPs.

## Local Mac startup

Requirements:

- Git
- Python 3.9 or newer
- Docker Desktop
- A loaded conDitar image named `localhost/conditar-dev:container-dev`

Clone the GUI:

```bash
git clone https://github.com/averyemeyer/conditar_gui_dev.git
cd conditar_gui_dev
```

Load the conDitar image if needed:

```bash
docker load -i /path/to/localhost_conditar-dev_container-dev.tar.gz
```

Start the GUI:

```bash
CONDITAR_RUNTIME=docker \
CONDITAR_DOCKER_IMAGE=localhost/conditar-dev:container-dev \
python3 serve.py --open
```

If the browser does not open automatically, visit:

```text
http://127.0.0.1:4173
```

If port `4173` is already in use, either use the already-running GUI or start on
a different port:

```bash
python3 serve.py --port 4174 --open
```

## OSC GPU startup

Requirements:

- An OSC session with Slurm available
- Podman available on the OSC host/compute environment
- The conDitar image available as `localhost/conditar-dev:container-dev`, or a
  shared image archive that can be loaded by the Slurm job
- Any OSC-specific setup required for remote desktop access

Clone or update the GUI on OSC:

```bash
git clone https://github.com/averyemeyer/conditar_gui_dev.git
cd conditar_gui_dev
```

Start with the OSC helper:

```bash
./start_osc_gui.sh
```

The helper defaults to:

```bash
CONDITAR_RUNTIME=podman
CONDITAR_DOCKER_IMAGE=localhost/conditar-dev:container-dev
CONDITAR_DOCKER_TAR=/fs/ess/PCON0041/mey200/container_images/localhost_conditar-dev_container-dev-20260710-105038.tar.gz
CONDITAR_SLURM_ACCOUNT=PCON0041
CONDITAR_SLURM_TIME=04:00:00
CONDITAR_SLURM_MEM=32G
CONDITAR_SLURM_CPUS=4
CONDITAR_SLURM_GPUS=1
```

Override any default inline when needed:

```bash
CONDITAR_SLURM_PARTITION=nextgen \
CONDITAR_SLURM_TIME=08:00:00 \
./start_osc_gui.sh
```

In the GUI, choose **OSC GPU · Slurm/Podman** under **Where should this run?**
before submitting. The backend writes `run.slurm`, submits with `sbatch`, and
polls Slurm/log files until outputs are ready.

## Runtime options

The GUI chooses the container runner from environment variables:

- `CONDITAR_RUNTIME=docker` for local Mac/Docker Desktop.
- `CONDITAR_RUNTIME=podman` for OSC/Linux Podman.
- `CONDITAR_RUNTIME=auto` to try Podman first, then Docker.

Use a different image name:

```bash
CONDITAR_DOCKER_IMAGE=my-registry/conditar-dev:tag \
CONDITAR_RUNTIME=docker \
python3 serve.py --open
```

Use a local `conDitar-dev` checkout while keeping the same container
environment/checkpoints:

```bash
CONDITAR_SOURCE_MOUNT=/path/to/conDitar-dev \
CONDITAR_RUNTIME=docker \
python3 serve.py --open
```

This is useful for source-only conDitar edits. Rebuild the container when
dependencies, model/checkpoint files, or container setup changes. On OSC,
`start_osc_gui.sh` automatically uses `../conDitar-dev` as
`CONDITAR_SOURCE_MOUNT` when that sibling checkout exists.

If Docker or Podman is installed in a nonstandard location:

```bash
DOCKER_BIN=/path/to/docker CONDITAR_RUNTIME=docker python3 serve.py --open
PODMAN_BIN=/path/to/podman CONDITAR_RUNTIME=podman python3 serve.py --open
```

## Using the GUI

1. Choose **Protein + reference ligand** or **Pocket only**.
2. Select an example dataset or replace the PDB/SDF with custom files.
3. Set **Molecules**, **Batch size**, and **Pocket radius**.
4. Choose **This computer · CPU** or **OSC GPU · Slurm/Podman**.
5. Open **Advanced run settings** only if you need Vina scoring, OSC Slurm
   options, or GPU email notifications.
6. Click **Generate molecules**.
7. Use the **Jobs** tab to monitor status and load completed outputs.
8. Use the **Results** and **Export** tabs to inspect molecules and download
   SDF/CSV/ZIP artifacts.

CPU email notifications are intentionally disabled in the GUI until a local
SMTP/sendmail path is configured. OSC GPU jobs can use Slurm email notifications
when an email address is provided.

## Batch folders

The GUI can accept folders of paired inputs.

- Local CPU batches become one job per folder in a serial local worker queue.
- OSC GPU batches submit one independent `sbatch` job per folder, allowing Slurm
  to run them in parallel subject to account, partition, and GPU availability.

The browser never passes arbitrary client filesystem paths into the container.
Uploaded files are copied into each job's private `inputs/` directory first.

## Vina post-processing

Vina scoring is optional and lives under **Advanced run settings**. When enabled,
the backend adds Vina arguments to the same container/job after generation. The
Results page reads SDF properties dynamically and can display/export properties
such as:

```text
VINA_SCORE_ONLY
VINA_MINIMIZE
VINA_DOCK
QVINA
QED
SA
```

## Smoke test checklist

For the full internal QA runbook, see [`INTERNAL_TESTING.md`](INTERNAL_TESTING.md).

Before a demo or handoff, confirm:

| Area | Expected result |
| --- | --- |
| App launch | GUI opens at `http://127.0.0.1:4173` |
| Runtime detection | Local Mac shows CPU; OSC shows Slurm/GPU option when available |
| Example input | Bundled PDB/SDF examples populate correctly |
| Custom input | Replaced PDB/SDF names appear in the setup panel |
| CPU target | Email is disabled; command preview uses CPU |
| OSC target | Slurm fields and email are available; command preview uses GPU |
| Vina toggle | Vina options appear only when enabled |
| Job submission | Job ID, status, logs, and output folder are created |
| Jobs tab | Existing jobs reload after server restart |
| Results/export | Generated SDFs load and ZIP/CSV/SDF export works |

For failed OSC jobs, inspect the job folder:

```text
job_data/jobs/<job-id>/run.slurm
job_data/jobs/<job-id>/logs/stdout.log
job_data/jobs/<job-id>/logs/stderr.log
job_data/jobs/<job-id>/logs/sbatch.stderr.log
job_data/jobs/<job-id>/logs/exit_code.txt
```

These usually identify whether the issue is Slurm submission, container image
loading, GPU visibility, or conDitar runtime behavior.
