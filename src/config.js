export const PARAMETERS = [
  { key: "num_samples", label: "Molecules", type: "number", value: 100, min: 1, max: 1000, step: 1, help: "Number of candidates to generate" },
  { key: "batch_size", label: "Batch size", type: "number", value: 100, min: 1, max: 500, step: 1, help: "Samples processed per batch" },
  { key: "pocket_radius", label: "Pocket radius", type: "number", value: 10, min: 4, max: 20, step: 1, suffix: "Å", help: "Protein context around the ligand" },
];

export const ADVANCED_PARAMETERS = [];

export const EXAMPLES = {
  "4aua": {
    id: "4aua",
    label: "4AUA",
    mode: "reference",
    pdb: "4aua/4aua_protein.pdb",
    sdf: "4aua/4aua_ligand.sdf",
    outputRoot: "conditar_results/4aua",
    outputStem: "4aua_ligand.sdf_generated_",
    outputFallbackStem: "4aua_protein.pdb_generated_",
    count: 100,
    pdbRecords: "2,051 records",
  },
  "xxxx": {
    id: "xxxx",
    label: "XXXX",
    mode: "pocket",
    pdb: "xxxx/xxxx_pocket.pdb",
    sdf: null,
    outputRoot: "conditar_results/xxxx",
    outputStem: "xxxx_pocket.pdb_generated_",
    count: 100,
    pdbRecords: "509 records",
  },
};
