# Batch upload test suite

Choose the `test_inputs/batch_suite/` folder in the GUI's **Batch folders**
picker. The suite intentionally mixes valid and invalid folders:

- `01_reference_4aua/`: valid protein + reference ligand pair.
- `02_pocket_xxxx/`: valid pocket-only input.
- `03_pocket_second/`: another valid PDB/SDF pair.
- `04_invalid_no_pdb/`: invalid; contains no PDB file.
- `05_invalid_bad_sdf/`: invalid; the SDF content is malformed.

In **Protein + reference ligand** mode, expected behavior is two accepted
folders (`01` and `03`) and three skipped folders (`02` has no SDF, `04` has no
PDB, and `05` has an invalid SDF). The setup panel should show a yellow
**Batch mode active** banner and the button should say `Submit 2 batch jobs`.

In **Pocket only** mode, `01`, `02`, `03`, and `05` are valid because SDF files
are optional; only `04` is skipped. This is useful for checking that the mode
toggle changes batch validation as well as the visible input controls.

For a clean all-valid test, select only folders `01_reference_4aua`,
`02_pocket_xxxx`, and `03_pocket_second` in a temporary directory, or remove
the two invalid folders from the selection before uploading.
