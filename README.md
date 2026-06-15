# conDitar Studio

A modular frontend prototype for configuring conDitar molecular generation studies,
exploring generated SDF structures, visualizing protein-ligand geometry, reviewing
structure-derived metrics, and exporting study artifacts.

## Run locally

```bash
python3 serve.py
```

Open `http://127.0.0.1:4173`.

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

## Architecture

```text
src/config.js        CLI parameter and example definitions
src/data-service.js  Replaceable study/result loading adapter
src/sdf.js           Browser-side SDF parsing and descriptors
src/viewers.js       2D SVG and 3Dmol structure rendering
src/charts.js        Native canvas property charts
src/app.js           Application state and interactions
```

The repository includes conDitar example data whose original licensing terms
remain applicable. Review those terms before publishing or redistributing data.
