# conDitar GUI Development Workbook

Personal development snapshot for the conDitar browser GUI and related results
review work.

This repository is a standalone copy of the current public-facing GUI code from
`conDitar-dev/gui`, plus the independent results comparison viewer used during
validation. The full conDitar model, container build files, and source code live
in the main project repository:

https://github.com/ninglab/conDitar-dev

## Contents

- `index.html`, `src/`, `backend/`, and launch scripts: the current conDitar GUI.
- `tools/`: plug-and-play GUI Tool Chest evaluators, including Lilly Medchem
  Rules and MedChem filters.
- `media/`: current logo and GUI screenshot assets.
- `comparison.html`, `src/comparison.js`, `src/comparison.css`, and `data/`:
  standalone validation/comparison viewer for repeated generation runs versus
  experiment/reference molecules.

Generated job folders are intentionally ignored under `job_data/`.

## GUI Quick Start

The GUI expects a conDitar container image named:

```text
localhost/conditar-dev:container-dev
```

For local CPU runs:

```bash
./setup_gui.sh
docker load -i /path/to/localhost_conditar-dev_container-dev.tar.gz
./start_cpu_gui.sh
```

On macOS, the easiest first-run path is:

```text
START_HERE_MAC.command
```

Double-clicking that file checks Docker Desktop, creates the optional Tool Chest
environment when conda is available, finds or asks for the container archive if
the image is missing, and starts the local CPU GUI.

On Windows, use Docker Desktop with WSL2 integration enabled, then run the shell
commands from the WSL terminal. Do not extract the container `.tar.gz` in
Windows File Explorer; load it directly with `docker load -i`.

For Slurm GPU runs:

```bash
./setup_slurm_gui.sh
./start_slurm_gui.sh
```

The Slurm setup helper prompts for the image archive and scheduler account when
needed, then saves local settings in `.conditar-slurm.env`.

## Tool Chest

Optional post-processing tools run on the GUI side after generation, so they can
be added or updated without rebuilding the conDitar sampling container.

To install the included optional tool environment:

```bash
./setup_tool_chest.sh
```

The GUI still starts without this environment; unavailable optional tools are
shown as unavailable until their dependencies are installed.

## Results Comparison Viewer

The standalone comparison viewer can be opened at:

```text
comparison.html
```

If the browser blocks local CSV loading, serve the repo locally:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/comparison.html
```

The viewer reads:

```text
data/final_recap_long_molecule_table.csv
```

It supports metric selection, case filtering, source filtering, distribution
plots, summary statistics, and molecule-level table review.

## Notes

This repo is meant as a personal workbook and polished exemplar. For deployment
or collaboration against the full model/container stack, use the main
`conDitar-dev` repository and keep this repo synced from its `gui/` folder.
