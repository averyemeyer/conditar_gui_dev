# conDitar Studio

A modular frontend prototype for configuring conDitar molecular generation studies,
exploring generated SDF structures, visualizing protein-ligand geometry, reviewing
structure-derived metrics, and exporting study artifacts.

This repository is a **frontend preview**. It uses bundled example inputs and
previously generated SDF outputs; it does not execute the conDitar model yet.

## Quick start

### Option 1: Existing Python

Requirements:

- Git
- Python 3.9 or newer
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
- Does not execute conDitar yet. `ExampleDataService` is the frontend boundary to
  replace with a backend job API.

## Using the preview

1. Choose the `4AUA` protein plus ligand example or the `XXXX` pocket-only example.
2. Set the number of molecules and pocket radius.
3. Open **Advanced settings** for the remaining `sample.py` parameters.
4. Select **Results** to browse available generated molecules.
5. Use the 3D/2D controls, optional dataset charts, and download buttons.

Uploaded inputs are read locally by the browser. The **Generate molecules**
button is a placeholder until a backend job service is connected.

## Architecture

```text
src/config.js        CLI parameter and example definitions
src/data-service.js  Replaceable study/result loading adapter
src/sdf.js           Browser-side SDF parsing and descriptors
src/viewers.js       2D SVG and 3Dmol structure rendering
src/charts.js        Native canvas property charts
src/app.js           Application state and interactions
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

Replace or extend `ExampleDataService` in `src/data-service.js` with API methods
for job submission, status polling, result manifests, and evaluation data. The
UI state and viewers are intentionally separate from this adapter.
