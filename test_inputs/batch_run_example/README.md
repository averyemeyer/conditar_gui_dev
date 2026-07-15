# Ready-to-run batch example

Upload/select this `batch_run_example/` folder with the GUI's **Batch folders**
picker. It contains two known-good folders and is intended for a clean smoke test:

- `01_reference_4aua/` — protein plus reference ligand
- `02_pocket_xxxx/` — pocket-only input

Use either input mode to submit `01_reference_4aua/`. In **Pocket only** mode,
submit both folders; in **Protein + reference ligand** mode, submit only `01`
because `02` intentionally has no reference SDF. Start with one molecule per
folder for a quick test, then increase the molecule count for throughput
testing. The original mixed suite (including additional edge cases) remains in
`../batch_suite/`.
