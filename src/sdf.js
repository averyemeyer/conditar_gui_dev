const ATOMIC_WEIGHTS = {
  H: 1.008, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998,
  P: 30.974, S: 32.06, Cl: 35.45, Br: 79.904, I: 126.904,
};

export function parseSdf(text, name = "molecule.sdf") {
  const block = text.split("$$$$")[0];
  const lines = block.replace(/\r/g, "").split("\n");
  const countLine = lines[3] || "";
  const atomCount = Number.parseInt(countLine.slice(0, 3), 10) || 0;
  const bondCount = Number.parseInt(countLine.slice(3, 6), 10) || 0;
  const atoms = [];
  const bonds = [];

  for (let i = 0; i < atomCount; i += 1) {
    const line = lines[4 + i] || "";
    atoms.push({
      x: Number.parseFloat(line.slice(0, 10)) || 0,
      y: Number.parseFloat(line.slice(10, 20)) || 0,
      z: Number.parseFloat(line.slice(20, 30)) || 0,
      element: line.slice(31, 34).trim() || "C",
    });
  }
  for (let i = 0; i < bondCount; i += 1) {
    const line = lines[4 + atomCount + i] || "";
    bonds.push({
      a: (Number.parseInt(line.slice(0, 3), 10) || 1) - 1,
      b: (Number.parseInt(line.slice(3, 6), 10) || 1) - 1,
      order: Number.parseInt(line.slice(6, 9), 10) || 1,
    });
  }

  const elementCounts = atoms.reduce((counts, atom) => {
    counts[atom.element] = (counts[atom.element] || 0) + 1;
    return counts;
  }, {});
  const heavyAtoms = atoms.filter((atom) => atom.element !== "H").length;
  const heteroAtoms = atoms.filter((atom) => !["C", "H"].includes(atom.element)).length;
  const molecularWeight = atoms.reduce((sum, atom) => sum + (ATOMIC_WEIGHTS[atom.element] || 0), 0);
  const components = connectedComponents(atoms.length, bonds);
  const rings = Math.max(0, bonds.length - atoms.length + components);

  return {
    name,
    text,
    atoms,
    bonds,
    atomCount: atoms.length,
    heavyAtoms,
    heteroAtoms,
    molecularWeight: Number(molecularWeight.toFixed(1)),
    rings,
    formula: formulaFromCounts(elementCounts),
  };
}

function connectedComponents(atomCount, bonds) {
  if (!atomCount) return 0;
  const links = Array.from({ length: atomCount }, () => []);
  bonds.forEach(({ a, b }) => {
    if (links[a] && links[b]) {
      links[a].push(b);
      links[b].push(a);
    }
  });
  const seen = new Set();
  let components = 0;
  for (let i = 0; i < atomCount; i += 1) {
    if (seen.has(i)) continue;
    components += 1;
    const stack = [i];
    while (stack.length) {
      const node = stack.pop();
      if (seen.has(node)) continue;
      seen.add(node);
      links[node].forEach((next) => stack.push(next));
    }
  }
  return components;
}

function formulaFromCounts(counts) {
  const ordered = ["C", "H", ...Object.keys(counts).filter((key) => !["C", "H"].includes(key)).sort()];
  return ordered.filter((key) => counts[key]).map((key) => `${key}${counts[key] > 1 ? counts[key] : ""}`).join("");
}

export function candidateId(index) {
  return `Candidate ${String(index).padStart(3, "0")}`;
}
