# Porting the GUI Into conDitar Workspaces

This GUI is intentionally self-contained so it can be copied into another
conDitar workspace as one folder.

## Recommended sibling layout

```text
workspace-parent/
  conDitar-dev/
    ...conDitar source and container build files...

  conditar-gui/
    index.html
    serve.py
    backend/
    media/
    src/
    start_gpu_gui.sh
    start_slurm_gui.sh
```

With this layout, `start_slurm_gui.sh` automatically detects the sibling
`../conDitar-dev` checkout and uses it as `CONDITAR_SOURCE_MOUNT`.

## Copy into another repo as a folder

From this GUI repo, copy only tracked source files:

```bash
rsync -av \
  --exclude .git \
  --exclude job_data \
  --exclude __pycache__ \
  --exclude '*.pyc' \
  ./ /path/to/target-repo/conditar-gui/
```

Do not copy generated job folders, caches, or local `.conditar-slurm.env`
settings.

## Run after moving

Local Docker:

```bash
cd /path/to/target-repo/conditar-gui
CONDITAR_RUNTIME=docker \
CONDITAR_DOCKER_IMAGE=localhost/conditar-dev:container-dev \
CONDITAR_SOURCE_MOUNT="$(cd ../conDitar-dev && pwd)" \
python3 serve.py --open
```

Slurm/Podman:

```bash
cd /path/to/target-repo/conditar-gui
CONDITAR_DOCKER_IMAGE=localhost/conditar-dev:container-dev \
CONDITAR_DOCKER_TAR=/path/to/localhost_conditar-dev_container-dev.tar.gz \
CONDITAR_SLURM_ACCOUNT=your-account \
./start_slurm_gui.sh
```

If the GUI folder is placed somewhere other than beside `conDitar-dev`, set
`CONDITAR_SOURCE_MOUNT` explicitly before starting the GUI.

## Target repo ignores

Add these patterns to the target repo if they are not already covered:

```gitignore
conditar-gui/job_data/
conditar-gui/__pycache__/
conditar-gui/backend/__pycache__/
conditar-gui/tests/__pycache__/
conditar-gui/.conditar-slurm.env
```
