# conDitar Studio

A modular frontend prototype for configuring conDitar molecular generation studies,
exploring generated SDF structures, visualizing protein-ligand geometry, reviewing
structure-derived metrics, and exporting study artifacts.

This repository is a GUI plus lightweight local backend prototype. It can still
load bundled preview outputs, and it can submit local CPU conDitar sampling jobs
through the Docker/Podman image built from `conDitar-dev`.

## Quick start

### Option 1: Existing Python

Requirements:

- Git
- Python 3.9 or newer
- Docker Desktop, Docker Engine, or Podman for local job execution
- A loaded `localhost/conditar-dev:container-dev` image
- Internet access for 3Dmol.js, JSZip, and web fonts

```bash
git clone https://github.com/averyemeyer/conditar_gui_dev.git
cd conditar_gui_dev
python3 serve.py --open
```

If the browser does not open automatically, visit
`http://127.0.0.1:4173`.

### Option 2: Conda environment

```bash
git clone https://github.com/averyemeyer/conditar_gui_dev.git
cd conditar_gui_dev
conda env create -f environment.yml
conda activate conditar-gui-dev
python serve.py --open
```

The environment contains only Python because the current GUI has no Python
package dependencies.

## Local CPU backend jobs

The GUI backend now treats the Docker-format conDitar image as the main runtime
artifact. Build or load the image from `conDitar-dev`, then start the GUI:

```bash
docker load -i /path/to/conditar-dev-docker.tar.gz
CONDITAR_RUNTIME=docker python3 serve.py --open
```

The default image name is:

```text
localhost/conditar-dev:container-dev
```

Override it when needed:

```bash
CONDITAR_DOCKER_IMAGE=my-registry/conditar-dev:tag CONDITAR_RUNTIME=docker python3 serve.py --open
```

Runtime selection:

- `CONDITAR_RUNTIME=auto` prefers Podman, then Docker, then Apptainer/Singularity.
- `CONDITAR_RUNTIME=docker` forces Docker Desktop or Docker Engine.
- `CONDITAR_RUNTIME=podman` forces Podman on OSC/Linux.
- `CONDITAR_RUNTIME=apptainer` keeps the old SIF path available as a fallback.

If an executable is installed somewhere unusual, set the matching variable:

```bash
DOCKER_BIN=/path/to/docker CONDITAR_RUNTIME=docker python3 serve.py --open
PODMAN_BIN=/path/to/podman CONDITAR_RUNTIME=podman python3 serve.py --open
APPTAINER_BIN=/path/to/apptainer CONDITAR_RUNTIME=apptainer python3 serve.py --open
```

For the legacy Apptainer path, override the SIF path with `CONDITAR_SIF`:

```bash
CONDITAR_RUNTIME=apptainer CONDITAR_SIF=/path/to/conditar-dev.sif python3 serve.py --open
```

The **Generate molecules** button submits a local CPU background job. Job inputs,
logs, metadata, and outputs are written under `job_data/jobs/`, which is ignored
by git. If an email address is provided, the backend can send completion
notifications through SMTP:

```bash
CONDITAR_SMTP_HOST=smtp.example.edu \
CONDITAR_SMTP_PORT=587 \
CONDITAR_SMTP_USER=name@example.edu \
CONDITAR_SMTP_PASSWORD='app-password-or-token' \
CONDITAR_SMTP_FROM=name@example.edu \
CONDITAR_RUNTIME=docker \
python3 serve.py --open
```

If SMTP is not configured, the backend tries local `sendmail`. If neither SMTP
nor `sendmail` is available, it writes the same notification to
`job_data/jobs/<job-id>/logs/email_notice.txt` so the completion path can still
be tested locally.

## Startup scripts

macOS or Linux:

```bash
./scripts/start.sh
```

Windows PowerShell:

```powershell
.\scripts\start.ps1
```

The startup command checks that the bundled PDB, SDF, and result folders are
present before starting the server. Stop it with `Ctrl+C`.

## Current scope

- Uses the bundled `4aua` protein/ligand and `xxxx` pocket-only examples.
- Loads the existing generated SDF files as preview results.
- Mirrors the CLI options exposed by `sample.py`.
- Computes molecular weight, atom counts, heteroatom counts, formula, and a graph
  cycle estimate directly from each SDF.
- Renders structures with 3Dmol.js and a dependency-free SVG 2D renderer.
- Exports selected SDFs, evaluation CSV, run JSON, or a complete ZIP bundle.
- Submits local CPU jobs to the conDitar Docker/Podman image and polls job status.
- OSC/Slurm GPU submission is not implemented yet.

## Using the preview

1. Choose the `4AUA` protein plus ligand example or the `XXXX` pocket-only example.
2. Set the number of molecules and pocket radius.
3. Open **Advanced settings** for the remaining `sample.py` parameters.
4. Select **Results** to browse available generated molecules.
5. Use the 3D/2D controls, optional dataset charts, and download buttons.

Uploaded inputs are read by the browser, sent to the local backend, staged in a
job directory, and passed to the conDitar container.

## Architecture

```text
src/config.js        CLI parameter and example definitions
src/data-service.js  Replaceable study/result loading adapter
src/sdf.js           Browser-side SDF parsing and descriptors
src/viewers.js       2D SVG and 3Dmol structure rendering
src/charts.js        Native canvas property charts
src/app.js           Application state and interactions
backend/jobs.py      Local CPU queue, Apptainer command runner, job metadata
serve.py             Static file server plus JSON job API
```

## Troubleshooting

### `Address already in use`

Another process is using port `4173`. Choose another port:

```bash
python3 serve.py --port 4174 --open
```

### 3D viewer is blank

The 3D viewer loads 3Dmol.js from a CDN. Confirm that the machine has internet
access, then refresh the page. The 2D viewer and result tables do not depend on
3Dmol.js.

### Example structures do not load

Run the server from the repository checkout rather than opening `index.html`
directly. `serve.py` reports missing required demo files at startup.

### Conda environment already exists

Update it from the checked-in definition:

```bash
conda env update -f environment.yml --prune
```

## Backend integration

The first backend target is local CPU execution. The next backend target is an
OSC/Slurm runner that uses the same job metadata and API shape but generates and
submits an `sbatch` script with `apptainer run --nv`.
