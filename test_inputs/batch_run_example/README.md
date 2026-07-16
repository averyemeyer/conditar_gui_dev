# Ready-to-run batch example

Upload/select this `batch_run_example/` folder with the GUI's **Batch folders**
picker. It contains five pocket-only folders and is intended for a Slurm GPU
parallel-batch smoke test:

- `01_pocket_xxxx/` through `05_pocket_xxxx/` — the same valid pocket input,
  duplicated so the batch has five parallel tasks

Choose **Pocket only** mode before uploading this folder. For Slurm GPU, the five
inputs are submitted as one Slurm array (one task per folder), so they can run
in parallel when GPU/account capacity is available. Start with one molecule per
task, then increase the molecule count for throughput testing. The original
mixed suite (including invalid-input edge cases) remains in `../batch_suite/`.
