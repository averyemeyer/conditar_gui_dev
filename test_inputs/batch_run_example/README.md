# Ready-to-run batch example

Upload/select this `batch_run_example/` folder with the GUI's **Batch folders**
picker. It contains three valid folders and is intended for a clean smoke test:

- `01_reference_4aua/` — protein plus reference ligand
- `02_pocket_xxxx/` — pocket-only input
- `03_pocket_second/` — protein plus reference ligand

Use **Protein + reference ligand** mode to submit folders `01` and `03`.
Use **Pocket only** mode to submit all three folders. Start with one molecule
per folder for a quick test, then increase the molecule count for throughput
testing. The original mixed valid/invalid suite remains in `../batch_suite/`.
