const ELEMENT_COLORS = {
  C: "#263632", N: "#3f67b1", O: "#c95b50", S: "#d6a431", F: "#4a9a6a",
  Cl: "#4a9a6a", Br: "#9c5f45", I: "#72559b", H: "#b9c1be",
};

let viewer = null;

export function render3D(container, molecule, receptorText, options = {}) {
  container.innerHTML = "";
  if (!window.$3Dmol) {
    container.innerHTML = "<div class='viewer-error'>3Dmol.js could not load. The 2D structure view remains available.</div>";
    return;
  }
  viewer = window.$3Dmol.createViewer(container, { backgroundColor: "#f7f9f8", antialias: true });
  if (receptorText && options.proteinStyle !== "hidden") {
    const receptor = viewer.addModel(receptorText, "pdb");
    if (options.proteinStyle === "surface") {
      receptor.setStyle({}, { line: { color: "#a7b3af", opacity: 0.25 } });
      viewer.addSurface(window.$3Dmol.SurfaceType.VDW, { opacity: 0.17, color: "#8ba69d" }, { model: receptor });
    } else if (options.proteinStyle === "line") {
      receptor.setStyle({}, { line: { color: "#aab6b2", opacity: 0.42 } });
    } else {
      receptor.setStyle({}, { cartoon: { color: "#a9bbb5", opacity: 0.72 } });
    }
  }
  const ligand = viewer.addModel(molecule.text, "sdf");
  const ligandStyle = options.ligandStyle || "stick";
  if (ligandStyle === "sphere") ligand.setStyle({}, { sphere: { scale: 0.28, colorscheme: "Jmol" } });
  else if (ligandStyle === "line") ligand.setStyle({}, { line: { linewidth: 2, colorscheme: "Jmol" } });
  else ligand.setStyle({}, { stick: { radius: 0.18, colorscheme: "Jmol" } });
  viewer.zoomTo({ model: ligand });
  viewer.zoom(0.9);
  viewer.render();
}

export function render2D(container, molecule) {
  const width = 720;
  const height = 480;
  const layout = layoutMolecule(molecule, width, height);
  const bonds = layout.bonds.map((bond) => bondSvg(layout.points[bond.a], layout.points[bond.b], bond.order)).join("");
  const atoms = molecule.atoms.map((atom, index) => {
    const point = layout.points[index];
    if (!point) return "";
    if (atom.element === "C" || atom.element === "H") return "";
    return `<g><circle cx="${point.x}" cy="${point.y}" r="13" fill="#f7f9f8"/><text x="${point.x}" y="${point.y + 5}" text-anchor="middle" fill="${ELEMENT_COLORS[atom.element] || "#263632"}">${atom.element}</text></g>`;
  }).join("");
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="2D structure of ${molecule.id}"><rect width="${width}" height="${height}" fill="#f7f9f8"/>${bonds}${atoms}</svg>`;
}

function layoutMolecule(molecule, width, height) {
  const visible = molecule.atoms
    .map((atom, index) => ({ atom, index }))
    .filter(({ atom }) => atom.element !== "H");
  const visibleSet = new Set(visible.map(({ index }) => index));
  const bonds = molecule.bonds.filter((bond) => visibleSet.has(bond.a) && visibleSet.has(bond.b));
  if (!visible.length) return { points: [], bonds: [] };

  const points = Array.from({ length: molecule.atoms.length }, () => null);
  const center = { x: width / 2, y: height / 2 };
  const radius = Math.min(width, height) * 0.28;
  visible.forEach(({ index }, order) => {
    const angle = (Math.PI * 2 * order) / visible.length - Math.PI / 2;
    points[index] = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });

  const ideal = 52;
  for (let iteration = 0; iteration < 360; iteration += 1) {
    visible.forEach(({ index }, i) => {
      const point = points[index];
      for (let j = i + 1; j < visible.length; j += 1) {
        const other = points[visible[j].index];
        const dx = point.x - other.x;
        const dy = point.y - other.y;
        const dist2 = Math.max(dx * dx + dy * dy, 25);
        const force = 950 / dist2;
        const dist = Math.sqrt(dist2);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        point.vx += fx;
        point.vy += fy;
        other.vx -= fx;
        other.vy -= fy;
      }
    });

    bonds.forEach((bond) => {
      const a = points[bond.a];
      const b = points[bond.b];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const force = (dist - ideal) * 0.035;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    });

    visible.forEach(({ index }) => {
      const point = points[index];
      point.vx += (center.x - point.x) * 0.004;
      point.vy += (center.y - point.y) * 0.004;
      point.x += point.vx;
      point.y += point.vy;
      point.vx *= 0.72;
      point.vy *= 0.72;
    });
  }

  fitPoints(points, visible.map(({ index }) => index), width, height);
  return { points, bonds };
}

function fitPoints(points, indices, width, height) {
  const pad = 54;
  const xs = indices.map((index) => points[index].x);
  const ys = indices.map((index) => points[index].y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxY - minY || 1), 2.2);
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  indices.forEach((index) => {
    points[index].x = offsetX + (points[index].x - minX) * scale;
    points[index].y = offsetY + (points[index].y - minY) * scale;
  });
}

function bondSvg(a, b, order) {
  if (!a || !b) return "";
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const offsetX = (-dy / length) * 3;
  const offsetY = (dx / length) * 3;
  const line = (offset = 0) => `<line x1="${a.x + offsetX * offset}" y1="${a.y + offsetY * offset}" x2="${b.x + offsetX * offset}" y2="${b.y + offsetY * offset}" stroke="#40514c" stroke-width="2.3" stroke-linecap="round"/>`;
  if (order === 2) return line(-1) + line(1);
  if (order >= 3) return line(-1.7) + line(0) + line(1.7);
  return line(0);
}
