import { ADVANCED_PARAMETERS, EXAMPLES, PARAMETERS } from "./config.js";
import { drawHistogram, drawScatter } from "./charts.js";
import { ExampleDataService } from "./data-service.js";
import { render2D, render3D } from "./viewers.js";

const service = new ExampleDataService();
const state = {
  study: null,
  selected: null,
  exampleId: "4aua",
  mode: "reference",
  view: "3d",
  parameters: Object.fromEntries([...PARAMETERS, ...ADVANCED_PARAMETERS].map((item) => [item.key, item.value])),
  customPdb: null,
  customSdf: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function initialize() {
  renderParameterFields(PARAMETERS, $("#parameter-fields"));
  renderParameterFields(ADVANCED_PARAMETERS, $("#advanced-fields"));
  bindEvents();
  loadExample("4aua");
}

function renderParameterFields(parameters, container) {
  container.innerHTML = parameters.map((parameter) => {
    const control = parameter.type === "select"
      ? `<select id="param-${parameter.key}">${parameter.options.map((option) => `<option ${option === parameter.value ? "selected" : ""}>${option}</option>`).join("")}</select>`
      : `<input id="param-${parameter.key}" type="${parameter.type}" value="${parameter.value}" ${parameter.min !== undefined ? `min="${parameter.min}"` : ""} ${parameter.max !== undefined ? `max="${parameter.max}"` : ""} ${parameter.step ? `step="${parameter.step}"` : ""}>`;
    return `<div class="parameter-field"><label for="param-${parameter.key}">${parameter.label}${parameter.suffix ? `<span>${parameter.suffix}</span>` : ""}</label>${control}<small>${parameter.help || ""}</small></div>`;
  }).join("");
}

function bindEvents() {
  $("#example-select").addEventListener("change", (event) => {
    if (event.target.value === "custom") {
      state.exampleId = "custom";
      showToast("Upload custom input structures. Example results remain visible until backend integration.");
      return;
    }
    loadExample(event.target.value);
  });
  $$(".mode-toggle button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  $$(".view-toggle button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$(".workflow-step").forEach((button) => button.addEventListener("click", () => {
    $$(".workflow-step").forEach((item) => item.classList.toggle("active", item === button));
    $(`#${button.dataset.section}-section`).scrollIntoView({ behavior: "smooth" });
  }));
  [...PARAMETERS, ...ADVANCED_PARAMETERS].forEach((parameter) => {
    $(`#param-${parameter.key}`).addEventListener("input", (event) => {
      state.parameters[parameter.key] = parameter.type === "number" ? Number(event.target.value) : event.target.value;
      updateCommand();
    });
  });
  $("#reset-params").addEventListener("click", resetParameters);
  $("#preview-run").addEventListener("click", () => showToast("The interface is ready for the conDitar backend adapter. No generation job was started."));
  $("#result-search").addEventListener("input", renderResultsTable);
  $("#result-sort").addEventListener("change", renderResultsTable);
  $("#histogram-metric").addEventListener("change", renderCharts);
  $("#protein-style").addEventListener("change", renderSelectedStructure);
  $("#ligand-style").addEventListener("change", renderSelectedStructure);
  $("#download-selected").addEventListener("click", downloadSelected);
  $("#download-csv").addEventListener("click", downloadCsv);
  $("#download-config").addEventListener("click", downloadConfig);
  $("#download-all").addEventListener("click", downloadAll);
  $("#theme-toggle").addEventListener("click", () => document.body.classList.toggle("high-contrast"));
  $("#pdb-input").addEventListener("change", handlePdbUpload);
  $("#sdf-input").addEventListener("change", handleSdfUpload);
  window.addEventListener("resize", debounce(renderCharts, 120));
}

async function loadExample(exampleId) {
  setLoading(true);
  state.exampleId = exampleId;
  const example = EXAMPLES[exampleId];
  $("#example-select").value = exampleId;
  setMode(example.mode, false);
  updateInputLabels(example);
  try {
    state.study = await service.loadStudy(exampleId, (loaded, total) => {
      $("#hero-status").textContent = `${Math.round((loaded / total) * 100)}%`;
    });
    state.selected = state.study.candidates[0] || null;
    $("#hero-candidate-count").textContent = state.study.candidates.length;
    $("#hero-status").textContent = "Ready";
    renderStudy();
  } catch (error) {
    showToast(error.message);
    $("#hero-status").textContent = "Error";
  } finally {
    setLoading(false);
  }
}

function setMode(mode, updateSelect = true) {
  state.mode = mode;
  $$(".mode-toggle button").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  $("#sdf-dropzone").hidden = mode === "pocket";
  $("#mode-note").textContent = mode === "reference"
    ? "The reference ligand defines the generation center. Pocket radius controls the surrounding protein context."
    : "The prepared pocket PDB supplies the generation region without a reference ligand.";
  $("#hero-input-mode").textContent = mode === "reference" ? "Ligand" : "Pocket";
  if (updateSelect) {
    const matching = Object.values(EXAMPLES).find((example) => example.mode === mode);
    if (matching) {
      $("#example-select").value = matching.id;
      loadExample(matching.id);
    }
  }
  updateCommand();
}

function updateInputLabels(example) {
  $("#pdb-name").textContent = example.pdb.split("/").pop();
  $("#pdb-detail").textContent = `${example.pdbRecords} · bundled example`;
  $("#sdf-name").textContent = example.sdf ? example.sdf.split("/").pop() : "No reference ligand";
  $("#sdf-detail").textContent = example.sdf ? "Reference ligand · bundled example" : "Pocket-only conditioning";
}

function renderStudy() {
  renderSummary();
  renderResultsTable();
  renderCharts();
  renderSelectedStructure();
  updateCommand();
}

function renderSummary() {
  const candidates = state.study?.candidates || [];
  const average = (key) => candidates.length ? candidates.reduce((sum, item) => sum + item[key], 0) / candidates.length : 0;
  const cards = [
    ["Loaded structures", candidates.length, "SDF"],
    ["Mean molecular weight", average("molecularWeight").toFixed(1), "Da"],
    ["Mean heavy atoms", average("heavyAtoms").toFixed(1), "atoms"],
    ["Ring-containing", candidates.filter((item) => item.rings > 0).length, "molecules"],
  ];
  $("#metric-strip").innerHTML = cards.map(([label, value, unit]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong><small>${unit}</small></div>`).join("");
}

function filteredCandidates() {
  const candidates = [...(state.study?.candidates || [])];
  const query = $("#result-search").value.trim().toLowerCase();
  const sort = $("#result-sort").value;
  return candidates
    .filter((item) => item.id.toLowerCase().includes(query) || item.formula.toLowerCase().includes(query))
    .sort((a, b) => sort === "index" ? a.index - b.index : b[sort] - a[sort]);
}

function renderResultsTable() {
  const candidates = filteredCandidates();
  $("#visible-count").textContent = `${candidates.length} shown`;
  $("#result-table").innerHTML = candidates.map((item) => `
    <tr data-index="${item.index}" class="${state.selected?.index === item.index ? "active" : ""}">
      <td>${item.id}<br><small>${item.formula}</small></td>
      <td>${item.molecularWeight}</td><td>${item.heavyAtoms}</td><td>${item.rings}</td>
    </tr>`).join("");
  $$("#result-table tr").forEach((row) => row.addEventListener("click", () => {
    state.selected = state.study.candidates.find((item) => item.index === Number(row.dataset.index));
    renderResultsTable();
    renderSelectedStructure();
    drawScatter($("#scatterplot"), state.study.candidates, state.selected.index);
  }));
}

function renderCharts() {
  if (!state.study) return;
  const metric = $("#histogram-metric").value;
  const label = $("#histogram-metric").selectedOptions[0].textContent;
  drawHistogram($("#histogram"), state.study.candidates.map((item) => item[metric]), label);
  drawScatter($("#scatterplot"), state.study.candidates, state.selected?.index);
}

function renderSelectedStructure() {
  const molecule = state.selected;
  if (!molecule || !state.study) return;
  $("#selected-name").textContent = molecule.id;
  $("#selected-metrics").innerHTML = [
    ["Formula", molecule.formula],
    ["MW", `${molecule.molecularWeight} Da`],
    ["Heavy atoms", molecule.heavyAtoms],
    ["Rings", molecule.rings],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  render2D($("#viewer-2d"), molecule);
  render3D($("#viewer-3d"), molecule, state.study.pdbText, {
    proteinStyle: $("#protein-style").value,
    ligandStyle: $("#ligand-style").value,
  });
  $("#viewer-loading").hidden = true;
}

function setView(view) {
  state.view = view;
  $$(".view-toggle button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#viewer-3d").hidden = view !== "3d";
  $("#viewer-2d").hidden = view !== "2d";
}

function updateCommand() {
  const example = EXAMPLES[state.exampleId] || EXAMPLES["4aua"];
  const args = [
    `python sample.py ${state.parameters.config}`,
    `--device ${state.parameters.device}`,
    `--num_samples ${state.parameters.num_samples}`,
    `--batch_size ${state.parameters.batch_size}`,
    `--pocket_radius ${state.parameters.pocket_radius}`,
    `--exhaustiveness ${state.parameters.exhaustiveness}`,
    `--atom_enc_mode ${state.parameters.atom_enc_mode}`,
    `--pdb_filename ${example.pdb}`,
  ];
  if (state.mode === "reference" && example.sdf) args.push(`--sdf_filename ${example.sdf}`);
  $("#command-preview").textContent = args.join(" ");
}

function resetParameters() {
  [...PARAMETERS, ...ADVANCED_PARAMETERS].forEach((parameter) => {
    state.parameters[parameter.key] = parameter.value;
    $(`#param-${parameter.key}`).value = parameter.value;
  });
  updateCommand();
  showToast("Sampling defaults restored.");
}

async function handlePdbUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  state.customPdb = { name: file.name, text: await file.text() };
  $("#pdb-name").textContent = file.name;
  $("#pdb-detail").textContent = `${formatBytes(file.size)} · local upload`;
  $("#example-select").value = "custom";
  state.exampleId = "custom";
  if (state.study) {
    state.study.pdbText = state.customPdb.text;
    renderSelectedStructure();
  }
}

async function handleSdfUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  state.customSdf = { name: file.name, text: await file.text() };
  $("#sdf-name").textContent = file.name;
  $("#sdf-detail").textContent = `${formatBytes(file.size)} · local upload`;
  $("#example-select").value = "custom";
  state.exampleId = "custom";
}

function downloadSelected() {
  if (!state.selected) return;
  downloadBlob(state.selected.text, state.selected.name, "chemical/x-mdl-sdfile");
}

function downloadCsv() {
  if (!state.study) return;
  const header = ["candidate", "source_file", "formula", "molecular_weight", "atom_count", "heavy_atoms", "hetero_atoms", "ring_estimate"];
  const rows = state.study.candidates.map((item) => [item.id, item.name, item.formula, item.molecularWeight, item.atomCount, item.heavyAtoms, item.heteroAtoms, item.rings]);
  downloadBlob([header, ...rows].map((row) => row.join(",")).join("\n"), `${studyName()}_metrics.csv`, "text/csv");
}

function downloadConfig() {
  downloadBlob(JSON.stringify(buildConfiguration(), null, 2), `${studyName()}_config.json`, "application/json");
}

async function downloadAll() {
  if (!state.study) return;
  if (!window.JSZip) {
    showToast("ZIP support could not load. Download the CSV and selected SDF individually.");
    return;
  }
  const button = $("#download-all");
  button.disabled = true;
  button.textContent = "Packaging…";
  const zip = new window.JSZip();
  const structures = zip.folder("generated_structures");
  state.study.candidates.forEach((item) => structures.file(item.name, item.text));
  zip.file("metrics.csv", csvText());
  zip.file("run_config.json", JSON.stringify(buildConfiguration(), null, 2));
  zip.file(state.study.example.pdb.split("/").pop(), state.study.pdbText);
  if (state.study.referenceSdf) zip.file(state.study.example.sdf.split("/").pop(), state.study.referenceSdf);
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `${studyName()}_study.zip`, "application/zip");
  button.disabled = false;
  button.innerHTML = "Download ZIP <b>↓</b>";
}

function buildConfiguration() {
  const example = EXAMPLES[state.exampleId];
  return {
    interface_version: "0.1.0",
    backend_connected: false,
    conditioning_mode: state.mode,
    inputs: {
      pdb_filename: state.customPdb?.name || example?.pdb || null,
      sdf_filename: state.mode === "reference" ? (state.customSdf?.name || example?.sdf || null) : null,
    },
    parameters: { ...state.parameters },
  };
}

function csvText() {
  const header = ["candidate", "source_file", "formula", "molecular_weight", "atom_count", "heavy_atoms", "hetero_atoms", "ring_estimate"];
  const rows = state.study.candidates.map((item) => [item.id, item.name, item.formula, item.molecularWeight, item.atomCount, item.heavyAtoms, item.heteroAtoms, item.rings]);
  return [header, ...rows].map((row) => row.join(",")).join("\n");
}

function studyName() {
  return state.study?.example?.id || "conditar";
}

function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setLoading(loading) {
  $("#viewer-loading").hidden = !loading;
  if (loading) $("#hero-status").textContent = "Loading";
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3400);
}

function formatBytes(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function debounce(fn, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

initialize();
