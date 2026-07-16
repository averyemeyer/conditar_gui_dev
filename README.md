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
docker image inspect localhost/conditar-dev:container-dev >/dev/null \
  && echo "conDitar container loaded"
```

To copy a shared image archive from a remote cluster to your local machine, run
`rsync` from your local terminal (replace the placeholders with your cluster
username, login host, and archive path):

```bash
mkdir -p "$HOME/containers"
rsync -avP \
  <CLUSTER_USER>@<CLUSTER_LOGIN_HOST>:/path/to/localhost_conditar-dev_container-dev.tar.gz \
  "$HOME/containers/"
docker load -i "$HOME/containers/localhost_conditar-dev_container-dev.tar.gz"
```

Docker Desktop must be installed and running before `docker load`, `docker run`,
or GUI job submission. The archive is large; `rsync -P` resumes an interrupted
transfer. The shared archive is intended for local CPU testing. Local NVIDIA
GPU execution additionally requires Docker Desktop GPU support and a compatible
NVIDIA runtime. On Apple Silicon, use the `linux/amd64` image; emulation may be
slower.

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

## Slurm GPU Startup

Requirements:

- A cluster session with Slurm available
- Podman available on the login or compute environment
- The conDitar image available as `localhost/conditar-dev:container-dev`, or a
  shared image archive that can be loaded by the Slurm job
- Any site-specific setup required for remote desktop or web access

Clone or update the GUI on the cluster:

```bash
git clone https://github.com/averyemeyer/conditar_gui_dev.git
cd conditar_gui_dev
```

Start with the GPU helper:

```bash
./start_gpu_gui.sh
```

This checks that Podman and Slurm are available before starting the GUI. If
`CONDITAR_DOCKER_TAR` is set, the Slurm job loads that archive before running;
otherwise it uses the named image already available to Podman.
For site-specific defaults that should not be committed, put environment
assignments in `.conditar-slurm.env`; the launcher loads it automatically.

The helper defaults to:

```bash
CONDITAR_RUNTIME=podman
CONDITAR_DOCKER_IMAGE=localhost/conditar-dev:container-dev
CONDITAR_DOCKER_TAR=                  # optional archive to load inside the job
CONDITAR_SLURM_ACCOUNT=               # required by many Slurm sites
CONDITAR_SLURM_TIME=04:00:00
CONDITAR_SLURM_MEM=32G
CONDITAR_SLURM_CPUS=4
CONDITAR_SLURM_GPUS=1
```

Override any default inline when needed:

```bash
CONDITAR_SLURM_PARTITION=nextgen \
CONDITAR_SLURM_TIME=08:00:00 \
./start_slurm_gui.sh
```

In the GUI, enter your required Slurm account and choose **Slurm GPU · Podman** under **Where should this run?**
before submitting. The backend writes `run.slurm`, submits with `sbatch`, and
polls Slurm/log files until outputs are ready.

## Runtime options

The GUI chooses the container runner from environment variables:

- `CONDITAR_RUNTIME=docker` for local Mac/Docker Desktop.
- `CONDITAR_RUNTIME=podman` for Linux/cluster Podman.
- `CONDITAR_RUNTIME=auto` to select an available local Docker/Podman runtime.

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
dependencies, model/checkpoint files, or container setup changes. The Slurm GPU
launcher automatically uses `../conDitar-dev` as
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
4. Choose **This computer · CPU** or **Slurm GPU · Podman**.
5. Enable Vina scoring if desired, then review Slurm options when using the GPU target.
6. Click **Generate molecules**.
7. Use the **Jobs** tab to monitor status and load completed outputs.
8. Use the **Results** and **Export** tabs to inspect molecules and download
   SDF/CSV/ZIP artifacts.

CPU email notifications are intentionally disabled in the GUI until a local
SMTP/sendmail path is configured. Slurm GPU jobs can use scheduler email notifications
when an email address is provided.

If a Slurm job is `PENDING`, the scheduler has accepted it but is waiting for account,
partition, or GPU capacity. If it fails before producing container output,
inspect `logs/sbatch.stderr.log` and `logs/stderr.log`; a missing image archive
or an attempted pull of `localhost/conditar-dev:container-dev` indicates that
the GPU launcher was not used or the archive path is incorrect.

## Batch folders

The GUI can accept folders of paired inputs.

- Local CPU batches become one job per folder in a serial local worker queue.
- Slurm GPU batches submit one Slurm array with one task per folder, allowing
  Slurm to run them in parallel subject to account, partition, and GPU
  availability.

The browser never passes arbitrary client filesystem paths into the container.
Uploaded files are copied into each job's private `inputs/` directory first.

## Vina post-processing

Vina scoring is optional and lives in the run setup controls. When enabled,
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
