const CSV_URL = "./data/final_recap_long_molecule_table.csv";
const GENERATED = "generated";
const ORIGINAL = "curated_without_opt";
const SOURCE_LABELS = {
  [GENERATED]: "Repeated runs",
  [ORIGINAL]: "Experiment runs",
};
const SOURCE_COLORS = {
  [GENERATED]: "#256f84",
  [ORIGINAL]: "#b8643b",
};
const METRICS = [
  ["vina_score_only", "Vina score only", "Lower is better"],
  ["rdkit_mw", "Molecular weight", "Da"],
  ["rdkit_heavy_atoms", "Heavy atoms", "count"],
  ["rdkit_hetero_atoms", "Hetero atoms", "count"],
  ["rdkit_rings", "Rings", "count"],
  ["rdkit_rotatable_bonds", "Rotatable bonds", "count"],
  ["rdkit_hbd", "H-bond donors", "count"],
  ["rdkit_hba", "H-bond acceptors", "count"],
  ["rdkit_tpsa", "TPSA", "Å²"],
  ["rdkit_logp", "LogP", "score"],
  ["rdkit_qed", "QED", "0 to 1"],
];

const state = {
  rows: [],
  metric: "vina_score_only",
  caseId: "all",
  source: "both",
  query: "",
};

const $ = (selector) => document.querySelector(selector);

initialize();

async function initialize() {
  $("#theme-toggle").addEventListener("click", () => document.body.classList.toggle("high-contrast"));
  $("#metric-select").innerHTML = METRICS.map(([key, label]) => `<option value="${key}">${label}</option>`).join("");
  $("#metric-select").value = state.metric;
  $("#metric-select").addEventListener("change", (event) => {
    state.metric = event.target.value;
    render();
  });
  $("#case-select").addEventListener("change", (event) => {
    state.caseId = event.target.value;
    render();
  });
  $("#source-select").addEventListener("change", (event) => {
    state.source = event.target.value;
    render();
  });
  $("#molecule-search").addEventListener("input", debounce((event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  }, 100));
  window.addEventListener("resize", debounce(renderPlots, 120));
  await loadData();
}

async function loadData() {
  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error(`Could not load ${CSV_URL}`);
    const text = await response.text();
    state.rows = parseCsv(text).map(normalizeRow);
    const cases = [...new Set(state.rows.map((row) => row.case_id))].sort(naturalSort);
    $("#case-select").innerHTML = `<option value="all">All cases</option>${cases.map((caseId) => `<option value="${escapeHtml(caseId)}">${escapeHtml(caseId)}</option>`).join("")}`;
    $("#comparison-row-count").textContent = state.rows.length.toLocaleString();
    $("#comparison-case-count").textContent = `${cases.length.toLocaleString()} cases`;
    $("#load-status").hidden = true;
    render();
  } catch (error) {
    $("#load-status").textContent = error.message;
  }
}

function normalizeRow(row) {
  const numeric = {};
  METRICS.forEach(([key]) => {
    const value = Number.parseFloat(row[key]);
    numeric[key] = Number.isFinite(value) ? value : null;
  });
  return { ...row, numeric };
}

function render() {
  const filtered = filteredRows();
  renderKpis(filtered);
  renderPlots(filtered);
  renderStats(filtered);
  renderCaseTable(filtered);
  renderMoleculeTable(filtered);
}

function filteredRows() {
  return state.rows.filter((row) => {
    if (state.caseId !== "all" && row.case_id !== state.caseId) return false;
    if (state.source !== "both" && row.source !== state.source) return false;
    if (!state.query) return true;
    return [row.case_id, row.molecule_id, row.smiles, row.sdf_name, row.benchmark_ligand_filename]
      .some((value) => String(value || "").toLowerCase().includes(state.query));
  });
}

function renderKpis(rows) {
  const comparison = compareRows(rows);
  const generatedStats = stats(valuesFor(rows, GENERATED));
  const originalStats = stats(valuesFor(rows, ORIGINAL));
  const generatedValues = valuesFor(rows, GENERATED);
  const betterText = generatedStats.n && originalStats.n
    ? state.metric === "vina_score_only"
      ? `${pct(generatedValues.filter((value) => value <= originalStats.median).length, generatedStats.n)} at or below experiment median`
      : `${pct(generatedValues.filter((value) => value >= originalStats.median).length, generatedStats.n)} at or above experiment median`
    : "n/a";
  $("#comparison-kpis").innerHTML = [
    ["Rows in view", rows.length.toLocaleString(), `${caseCount(rows)} cases`],
    ["Mean delta", fmt(comparison.meanDelta), "repeated minus experiment"],
    ["KS distance", fmt(comparison.ks, 3), "0 same · 1 different"],
    ["Overlap", pctNumber(comparison.overlap), "histogram area shared"],
    ["Repeated median test", betterText, metricUnit()],
  ].map(([label, value, note]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join("");
}

function renderPlots(rows = filteredRows()) {
  const generated = valuesFor(rows, GENERATED);
  const original = valuesFor(rows, ORIGINAL);
  const metric = currentMetricLabel();
  const layout = plotLayout(metric);
  if (!window.Plotly) {
    $("#histogram-plot").textContent = "Plotly did not load.";
    $("#box-plot").textContent = "Plotly did not load.";
    return;
  }
  window.Plotly.react("histogram-plot", [
    histogramTrace(generated, GENERATED),
    histogramTrace(original, ORIGINAL),
  ], {
    ...layout,
    barmode: "overlay",
    bargap: 0.03,
    yaxis: { title: "Density", gridcolor: "#edf0f2" },
  }, plotConfig());
  window.Plotly.react("box-plot", [
    boxTrace(generated, GENERATED),
    boxTrace(original, ORIGINAL),
  ], {
    ...layout,
    xaxis: { showgrid: false },
    yaxis: { title: metric, gridcolor: "#edf0f2", zerolinecolor: "#dfe4e8" },
  }, plotConfig());
}

function renderStats(rows) {
  $("#stats-table").innerHTML = [GENERATED, ORIGINAL].map((source) => {
    const item = stats(valuesFor(rows, source));
    return `<tr>
      <td>${SOURCE_LABELS[source]}</td>
      <td>${item.n.toLocaleString()}</td>
      <td>${fmt(item.mean)}</td>
      <td>${fmt(item.median)}</td>
      <td>${fmt(item.sd)}</td>
      <td>${fmt(item.iqr)}</td>
      <td>${fmt(item.min)}</td>
      <td>${fmt(item.max)}</td>
    </tr>`;
  }).join("");
}

function renderCaseTable(rows) {
  const cases = [...new Set(rows.map((row) => row.case_id))].sort(naturalSort);
  const items = cases.map((caseId) => {
    const caseRows = rows.filter((row) => row.case_id === caseId);
    return { caseId, ...compareRows(caseRows) };
  }).sort((a, b) => Math.abs(b.meanDelta || 0) - Math.abs(a.meanDelta || 0));
  $("#case-visible-count").textContent = `${items.length.toLocaleString()} cases`;
  $("#case-table").innerHTML = items.map((item) => `<tr>
    <td>${escapeHtml(item.caseId)}</td>
    <td>${item.generated.n.toLocaleString()}</td>
    <td>${item.original.n.toLocaleString()}</td>
    <td>${fmt(item.generated.mean)}</td>
    <td>${fmt(item.original.mean)}</td>
    <td class="${deltaClass(item.meanDelta)}">${fmt(item.meanDelta)}</td>
    <td>${fmt(item.effect, 3)}</td>
    <td>${fmt(item.ks, 3)}</td>
    <td>${pctNumber(item.overlap)}</td>
  </tr>`).join("");
}

function renderMoleculeTable(rows) {
  const sorted = [...rows].sort((a, b) => {
    const metricDelta = (a.numeric[state.metric] ?? Number.POSITIVE_INFINITY) - (b.numeric[state.metric] ?? Number.POSITIVE_INFINITY);
    return metricDelta || naturalSort(a.case_id, b.case_id) || Number(a.source_index || 0) - Number(b.source_index || 0);
  });
  const visible = sorted.slice(0, 500);
  $("#molecule-visible-count").textContent = `${visible.length.toLocaleString()} of ${rows.length.toLocaleString()} shown`;
  $("#molecule-table").innerHTML = visible.map((row) => `<tr>
    <td><span class="source-pill" data-source="${row.source}">${SOURCE_LABELS[row.source] || row.source}</span></td>
    <td>${escapeHtml(row.case_id)}</td>
    <td>${escapeHtml(row.source_index)}</td>
    <td>${fmt(row.numeric[state.metric])}</td>
    <td>${fmt(row.numeric.vina_score_only)}</td>
    <td>${fmt(row.numeric.rdkit_mw, 1)}</td>
    <td>${fmt(row.numeric.rdkit_qed, 3)}</td>
    <td class="smiles-cell" title="${escapeHtml(row.smiles)}">${escapeHtml(row.smiles)}</td>
    <td class="smiles-cell" title="${escapeHtml(row.sdf_path)}">${escapeHtml(row.sdf_name || row.benchmark_ligand_filename || "")}</td>
  </tr>`).join("");
}

function compareRows(rows) {
  const generatedValues = valuesFor(rows, GENERATED);
  const originalValues = valuesFor(rows, ORIGINAL);
  const generated = stats(generatedValues);
  const original = stats(originalValues);
  const pooled = Math.sqrt((((generated.n - 1) * generated.sd ** 2) + ((original.n - 1) * original.sd ** 2)) / Math.max(1, generated.n + original.n - 2));
  return {
    generated,
    original,
    meanDelta: generated.mean - original.mean,
    effect: pooled ? (generated.mean - original.mean) / pooled : null,
    ks: ksDistance(generatedValues, originalValues),
    overlap: histogramOverlap(generatedValues, originalValues),
  };
}

function valuesFor(rows, source) {
  return rows
    .filter((row) => row.source === source)
    .map((row) => row.numeric[state.metric])
    .filter((value) => Number.isFinite(value));
}

function stats(values) {
  if (!values.length) return { n: 0, mean: null, median: null, sd: null, iqr: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  return {
    n: values.length,
    mean,
    median: quantile(sorted, 0.5),
    sd: Math.sqrt(variance),
    iqr: quantile(sorted, 0.75) - quantile(sorted, 0.25),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function ksDistance(a, b) {
  if (!a.length || !b.length) return null;
  const values = [...new Set([...a, ...b])].sort((x, y) => x - y);
  const aa = [...a].sort((x, y) => x - y);
  const bb = [...b].sort((x, y) => x - y);
  let ai = 0;
  let bi = 0;
  let max = 0;
  values.forEach((value) => {
    while (ai < aa.length && aa[ai] <= value) ai += 1;
    while (bi < bb.length && bb[bi] <= value) bi += 1;
    max = Math.max(max, Math.abs(ai / aa.length - bi / bb.length));
  });
  return max;
}

function histogramOverlap(a, b) {
  if (!a.length || !b.length) return null;
  const min = Math.min(...a, ...b);
  const max = Math.max(...a, ...b);
  const bins = 24;
  const ah = histogram(a, min, max, bins).map((count) => count / a.length);
  const bh = histogram(b, min, max, bins).map((count) => count / b.length);
  return ah.reduce((sum, count, index) => sum + Math.min(count, bh[index]), 0);
}

function histogram(values, min, max, bins) {
  const counts = Array(bins).fill(0);
  const step = (max - min || 1) / bins;
  values.forEach((value) => {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value - min) / step)));
    counts[index] += 1;
  });
  return counts;
}

function histogramTrace(values, source) {
  return {
    type: "histogram",
    x: values,
    name: SOURCE_LABELS[source],
    histnorm: "probability density",
    nbinsx: 36,
    marker: { color: SOURCE_COLORS[source], opacity: 0.55, line: { color: SOURCE_COLORS[source], width: 1 } },
    hovertemplate: `${SOURCE_LABELS[source]}<br>${currentMetricLabel()}: %{x}<br>Density: %{y}<extra></extra>`,
  };
}

function boxTrace(values, source) {
  return {
    type: "box",
    y: values,
    name: SOURCE_LABELS[source],
    boxpoints: "outliers",
    marker: { color: SOURCE_COLORS[source], size: 3, opacity: 0.45 },
    line: { color: SOURCE_COLORS[source] },
    fillcolor: `${SOURCE_COLORS[source]}33`,
    hovertemplate: `${SOURCE_LABELS[source]}<br>${currentMetricLabel()}: %{y}<extra></extra>`,
  };
}

function plotLayout(metric) {
  return {
    margin: { l: 56, r: 20, t: 16, b: 48 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: { family: "Manrope, Arial, sans-serif", color: "#17202a", size: 12 },
    legend: { orientation: "h", x: 0, y: 1.12 },
    xaxis: { title: metric, gridcolor: "#edf0f2", zerolinecolor: "#dfe4e8" },
  };
}

function plotConfig() {
  return {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift();
  return rows.filter((item) => item.length === headers.length).map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index]])));
}

function currentMetricLabel() {
  return METRICS.find(([key]) => key === state.metric)?.[1] || state.metric;
}

function metricUnit() {
  return METRICS.find(([key]) => key === state.metric)?.[2] || "";
}

function caseCount(rows) {
  return new Set(rows.map((row) => row.case_id)).size.toLocaleString();
}

function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return "n/a";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: Math.abs(value) < 10 ? Math.min(2, digits) : 0 });
}

function pct(part, total) {
  if (!total) return "n/a";
  return `${((part / total) * 100).toFixed(0)}%`;
}

function pctNumber(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(0)}%`;
}

function deltaClass(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.01) return "";
  return value < 0 ? "delta-good" : "delta-warn";
}

function naturalSort(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}
