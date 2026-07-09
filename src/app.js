import { ADVANCED_PARAMETERS, EXAMPLES, PARAMETERS } from "./config.js";
import { drawHistogram } from "./charts.js";
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
  currentJob: null,
  selectedJob: null,
  jobs: [],
  jobPollTimer: null,
  activeTab: "setup",
  resultSource: "example",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function initialize() {
  const commonKeys = new Set(["num_samples", "pocket_radius"]);
  renderParameterFields(PARAMETERS.filter((parameter) => commonKeys.has(parameter.key)), $("#parameter-fields"));
  renderParameterFields(
    [...PARAMETERS.filter((parameter) => !commonKeys.has(parameter.key)), ...ADVANCED_PARAMETERS],
    $("#advanced-fields"),
  );
  bindEvents();
  loadExample("4aua");
  refreshJobs(false);
  setActiveTab("setup");
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
      showToast("Upload custom input structures, then submit a local CPU job.");
      return;
    }
    loadExample(event.target.value);
  });
  $$(".mode-toggle button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  $$(".view-toggle button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$(".workflow-step").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.section)));
  [...PARAMETERS, ...ADVANCED_PARAMETERS].forEach((parameter) => {
    $(`#param-${parameter.key}`).addEventListener("input", (event) => {
      state.parameters[parameter.key] = parameter.type === "number" ? Number(event.target.value) : event.target.value;
      updateCommand();
    });
  });
  $("#reset-params").addEventListener("click", resetParameters);
  $("#preview-run").addEventListener("click", submitGenerationJob);
  $("#job-target").addEventListener("change", updateJobTargetControls);
  $("#vina-enabled").addEventListener("change", updateVinaControls);
  ["#vina-mode", "#vina-exhaustiveness", "#vina-cpu"].forEach((selector) => {
    $(selector).addEventListener("input", updateCommand);
  });
  $("#refresh-jobs").addEventListener("click", () => refreshJobs(true));
  $("#result-search").addEventListener("input", renderResultsTable);
  $("#result-sort").addEventListener("change", renderResultsTable);
  $("#histogram-metric").addEventListener("change", renderCharts);
  $(".analytics-details").addEventListener("toggle", (event) => {
    if (event.target.open) requestAnimationFrame(renderCharts);
  });
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
  updateJobTargetControls();
  updateVinaControls();
}

async function setActiveTab(tab) {
  state.activeTab = tab;
  $$(".workflow-step").forEach((button) => button.classList.toggle("active", button.dataset.section === tab));
  $$(".workspace-section").forEach((section) => {
    section.hidden = section.id !== `${tab}-section`;
  });
  if (tab === "jobs") {
    await refreshJobs(false);
  }
  if (tab === "results") {
    renderCharts();
    renderSelectedStructure();
  }
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
    state.resultSource = "example";
    state.selectedJob = null;
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
  updateResultsSource();
  updateCommand();
}

async function submitGenerationJob() {
  if (!state.study && !state.customPdb) {
    showToast("Load or upload a PDB before submitting a job.");
    return;
  }
  const button = $("#preview-run");
  button.disabled = true;
  button.querySelector("span").textContent = "Submitting";
  try {
    const payload = buildJobPayload();
    const job = await service.submitJob(payload);
    state.currentJob = job;
    state.selectedJob = job;
    updateJobPanel(job, "Job queued.");
    updateJobDetail(job, "Job queued.");
    await refreshJobs(false);
    setActiveTab("jobs");
    showToast(`${targetLabel(job)} job queued.`);
    pollJob(job.id);
  } catch (error) {
    showToast(error.message);
    updateJobPanel(null, error.message);
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "Generate molecules";
  }
}

function buildJobPayload() {
  const example = EXAMPLES[state.exampleId] || EXAMPLES["4aua"];
  const pdb = state.customPdb || {
    name: example.pdb.split("/").pop(),
    text: state.study?.pdbText,
  };
  const sdf = state.mode === "reference"
    ? (state.customSdf || (state.study?.referenceSdf ? {
      name: example.sdf?.split("/").pop() || "reference.sdf",
      text: state.study.referenceSdf,
    } : null))
    : null;
  return {
    target: $("#job-target").value,
    mode: state.mode,
    example_id: state.exampleId,
    email: $("#job-email").value.trim(),
    pdb,
    sdf,
    slurm: buildSlurmPayload(),
    postprocess: buildPostprocessPayload(),
    parameters: {
      ...state.parameters,
      device: $("#job-target").value === "osc_gpu" ? "cuda:0" : "cpu",
    },
  };
}

function buildSlurmPayload() {
  return {
    time: $("#slurm-time").value.trim(),
    mem: $("#slurm-mem").value.trim(),
    cpus: $("#slurm-cpus").value,
    gpus: $("#slurm-gpus").value,
    partition: $("#slurm-partition").value.trim(),
    account: $("#slurm-account").value.trim(),
  };
}

function buildPostprocessPayload() {
  return {
    vina: $("#vina-enabled").checked,
    vina_mode: $("#vina-mode").value,
    vina_exhaustiveness: $("#vina-exhaustiveness").value,
    vina_cpu: $("#vina-cpu").value,
  };
}

async function pollJob(jobId) {
  clearTimeout(state.jobPollTimer);
  try {
    const job = await service.getJob(jobId);
    const logs = await service.getJobLogs(jobId).catch(() => ({ stdout: "", stderr: "" }));
    state.currentJob = job;
    state.selectedJob = job;
    updateJobPanel(job, logs.stdout || logs.stderr || "Waiting for job output.");
    updateJobDetail(job, logs.stdout || logs.stderr || "Waiting for job output.");
    renderJobsTable();
    if (job.status === "completed") {
      await refreshJobs(false);
      await loadCompletedJob(job);
      return;
    }
    if (job.status === "failed" || job.status === "canceled") {
      showToast(job.error_message || `Job ${job.status}.`);
      return;
    }
    state.jobPollTimer = setTimeout(() => pollJob(jobId), 5000);
  } catch (error) {
    updateJobPanel(state.currentJob, error.message);
    state.jobPollTimer = setTimeout(() => pollJob(jobId), 5000);
  }
}

async function loadCompletedJob(job) {
  const result = await service.loadJobResults(job);
  const candidates = result.candidates || [];
  if (!candidates.length) {
    showToast("Job completed but no SDF results were found.");
    return;
  }
  const fallbackExample = state.study?.example || EXAMPLES[state.exampleId] || EXAMPLES["4aua"];
  const pdbInput = result.inputs?.pdb || null;
  const sdfInput = result.inputs?.sdf || null;
  state.study = {
    ...state.study,
    example: {
      ...fallbackExample,
      id: job.id,
      label: job.id,
      pdb: pdbInput?.name || fallbackExample.pdb,
      sdf: sdfInput?.name || fallbackExample.sdf,
    },
    pdbText: pdbInput?.text || state.study?.pdbText || "",
    referenceSdf: sdfInput?.text || state.study?.referenceSdf || null,
    candidates,
  };
  state.currentJob = job;
  state.selectedJob = job;
  state.resultSource = "job";
  state.selected = candidates[0];
  $("#hero-candidate-count").textContent = candidates.length;
  $("#hero-status").textContent = "Completed";
  renderStudy();
  setActiveTab("results");
  showToast(`Job completed with ${candidates.length} result${candidates.length === 1 ? "" : "s"}.`);
}

function updateJobPanel(job, logText) {
  $("#job-status").textContent = job?.status || "Idle";
  $("#job-id").textContent = job?.id || "None";
  $("#job-log").textContent = trimLog(logText || "No job submitted.");
}

function updateJobDetail(job, logText) {
  $("#job-detail-status").textContent = job?.status || "None";
  $("#job-detail-status").dataset.status = job?.status || "none";
  $("#job-detail-id").textContent = job?.id || "None";
  $("#job-detail-target").textContent = targetLabel(job);
  $("#job-detail-started").textContent = formatDate(job?.started_at || job?.created_at);
  $("#job-detail-log").textContent = trimLog(logText || "Select a job to view logs.");
}

async function refreshJobs(showMessage = false) {
  try {
    state.jobs = await service.listJobs();
    renderJobsTable();
    if (showMessage) showToast(`Loaded ${state.jobs.length} job${state.jobs.length === 1 ? "" : "s"}.`);
  } catch (error) {
    if (showMessage) showToast(error.message);
  }
}

function renderJobsTable() {
  const jobs = [...state.jobs].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  $("#jobs-table").innerHTML = jobs.length ? jobs.map((job) => `
    <tr data-job-id="${job.id}" class="${state.selectedJob?.id === job.id ? "active" : ""}">
      <td>${job.id}<br><small>${job.mode || "run"}</small></td>
      <td><span class="status-badge" data-status="${job.status}">${job.status}</span></td>
      <td>${targetLabel(job)}<br><small>${job.example_id || "custom"}</small></td>
      <td>${formatDate(job.created_at)}</td>
      <td><button class="secondary-button compact-action load-job-results" ${job.status === "completed" ? "" : "disabled"}>Results</button></td>
    </tr>`).join("") : `<tr><td colspan="5">No jobs yet.</td></tr>`;

  $$("#jobs-table tr[data-job-id]").forEach((row) => row.addEventListener("click", async (event) => {
    const job = state.jobs.find((item) => item.id === row.dataset.jobId);
    if (!job) return;
    state.selectedJob = job;
    renderJobsTable();
    const logs = await service.getJobLogs(job.id).catch(() => ({ stdout: "", stderr: "" }));
    updateJobDetail(job, logs.stdout || logs.stderr || "Logs are not available for this job yet.");
    if (event.target.closest(".load-job-results")) {
      await loadSelectedJobResults(job.id);
    }
  }));
}

async function loadSelectedJobResults(jobId) {
  const job = await service.getJob(jobId);
  state.selectedJob = job;
  updateJobDetail(job, "Loading results...");
  if (job.status !== "completed") {
    showToast("Only completed jobs have results to load.");
    return;
  }
  await loadCompletedJob(job);
}

function trimLog(text) {
  return text.length > 5000 ? `…\n${text.slice(-5000)}` : text;
}

function renderSummary() {
  const candidates = state.study?.candidates || [];
  const average = (key) => {
    const values = numericValues(candidates, key);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const cards = [
    ["Loaded structures", candidates.length, "SDF"],
    ["Mean molecular weight", formatMetric(average("molecularWeight"), 1), "Da"],
    ["Mean heavy atoms", formatMetric(average("heavyAtoms"), 1), "atoms"],
    ["Ring-containing", candidates.filter((item) => item.rings > 0).length, "molecules"],
  ];
  if (numericValues(candidates, "vinaScore").length) {
    cards.push(["Mean Vina score", formatMetric(average("vinaScore")), "kcal/mol"]);
  }
  $("#metric-strip").innerHTML = cards.map(([label, value, unit]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong><small>${unit}</small></div>`).join("");
  renderQualitySummary(candidates);
}

function renderQualitySummary(candidates) {
  const vinaValues = numericValues(candidates, "vinaScore");
  const qedValues = propertyValues(candidates, "QED");
  const saValues = propertyValues(candidates, "SA");
  const logpValues = propertyValues(candidates, "LOGP");
  const lipinskiValues = propertyValues(candidates, "LIPINSKI");
  const uniqueFormulas = new Set(candidates.map((item) => item.formula).filter(Boolean)).size;
  const scored = candidates.filter((item) => item.properties?.VINA_STATUS === "ok" || item.vinaScore !== null).length;
  const lipinskiPasses = lipinskiValues.filter((value) => value >= 4).length;
  const bestVina = vinaValues.length ? Math.min(...vinaValues) : null;
  const rows = [
    ["Scored by Vina", scored ? `${scored}/${candidates.length}` : "Not run"],
    ["Best Vina", bestVina === null ? "n/a" : `${formatMetric(bestVina)} kcal/mol`],
    ["QED range", rangeLabel(qedValues)],
    ["SA range", rangeLabel(saValues)],
    ["LogP range", rangeLabel(logpValues)],
    ["Lipinski >=4", lipinskiValues.length ? `${lipinskiPasses}/${lipinskiValues.length}` : "n/a"],
    ["Unique formulas", candidates.length ? `${uniqueFormulas}/${candidates.length}` : "n/a"],
    ["Ring-containing", candidates.length ? `${candidates.filter((item) => item.rings > 0).length}/${candidates.length}` : "n/a"],
  ];
  $("#quality-summary").innerHTML = rows.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function filteredCandidates() {
  const candidates = [...(state.study?.candidates || [])];
  const query = $("#result-search").value.trim().toLowerCase();
  const sort = $("#result-sort").value;
  return candidates
    .filter((item) => item.id.toLowerCase().includes(query) || item.formula.toLowerCase().includes(query))
    .sort((a, b) => sort === "index" ? a.index - b.index : compareMetric(b[sort], a[sort]));
}

function renderResultsTable() {
  const candidates = filteredCandidates();
  $("#visible-count").textContent = `${candidates.length} shown`;
  $("#result-table").innerHTML = candidates.map((item) => `
    <tr data-index="${item.index}" class="${state.selected?.index === item.index ? "active" : ""}">
      <td>${item.id}<br><small>${item.formula}</small></td>
      <td>${item.molecularWeight}</td><td>${item.rings}</td><td>${formatMetric(item.vinaScore)}</td>
    </tr>`).join("");
  $$("#result-table tr").forEach((row) => row.addEventListener("click", () => {
    state.selected = state.study.candidates.find((item) => item.index === Number(row.dataset.index));
    renderResultsTable();
    renderSelectedStructure();
    renderCharts();
  }));
}

function renderCharts() {
  if (!state.study || state.activeTab !== "results" || !$(".analytics-details").open) return;
  const metric = $("#histogram-metric").value;
  const label = $("#histogram-metric").selectedOptions[0].textContent;
  drawHistogram($("#histogram"), numericValues(state.study.candidates, metric), label);
}

function renderSelectedStructure() {
  const molecule = state.selected;
  if (!molecule || !state.study || state.activeTab !== "results") return;
  $("#selected-name").textContent = molecule.id;
  const metrics = [
    ["Formula", molecule.formula],
    ["MW", `${molecule.molecularWeight} Da`],
    ["Heavy atoms", molecule.heavyAtoms],
    ["Rings", molecule.rings],
  ];
  if (molecule.smiles) {
    metrics.push(["SMILES", molecule.smiles]);
  }
  if (molecule.vinaScore !== null) {
    metrics.push(["Vina", formatMetric(molecule.vinaScore)]);
  }
  if (molecule.properties?.VINA_MINIMIZE) {
    metrics.push(["Vina min", formatMetric(Number.parseFloat(molecule.properties.VINA_MINIMIZE))]);
  }
  $("#selected-metrics").innerHTML = metrics.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
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

function updateResultsSource() {
  $("#results-source").textContent = state.resultSource === "job" && state.selectedJob
    ? `Loaded generated outputs from job ${state.selectedJob.id}.`
    : "Preview example results are loaded. Select a completed job from Jobs to review generated outputs.";
}

function targetLabel(job) {
  if (!job) return "Local CPU";
  if (job.target === "local_cpu") return "Local CPU";
  if (job.target === "osc_gpu") return "OSC GPU";
  return job.target || "Local CPU";
}

function updateJobTargetControls() {
  const target = $("#job-target").value;
  $("#slurm-controls").hidden = target !== "osc_gpu";
  $("#job-runtime-label").textContent = target === "osc_gpu" ? "OSC GPU" : "Local CPU";
  $("#param-device").value = target === "osc_gpu" ? "auto" : "cpu";
  state.parameters.device = target === "osc_gpu" ? "auto" : "cpu";
  updateCommand();
}

function updateVinaControls() {
  $("#vina-options").hidden = !$("#vina-enabled").checked;
  updateCommand();
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMetric(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function numericValues(items, key) {
  return items.map((item) => Number(item[key])).filter(Number.isFinite);
}

function propertyValues(items, key) {
  return items.map((item) => Number.parseFloat(item.properties?.[key])).filter(Number.isFinite);
}

function rangeLabel(values) {
  if (!values.length) return "n/a";
  return `${formatMetric(Math.min(...values))} to ${formatMetric(Math.max(...values))}`;
}

function compareMetric(a, b) {
  const left = Number(a);
  const right = Number(b);
  const leftValid = Number.isFinite(left);
  const rightValid = Number.isFinite(right);
  if (!leftValid && !rightValid) return 0;
  if (!leftValid) return -1;
  if (!rightValid) return 1;
  return left - right;
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
  if ($("#vina-enabled").checked) {
    args.push(`--vina_score --vina_mode ${$("#vina-mode").value} --vina_exhaustiveness ${$("#vina-exhaustiveness").value}`);
  }
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
  downloadBlob(csvText(), `${studyName()}_metrics.csv`, "text/csv");
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
  if (state.study.pdbText) zip.file(filenameOnly(state.study.example.pdb || "input.pdb"), state.study.pdbText);
  if (state.study.referenceSdf) zip.file(filenameOnly(state.study.example.sdf || "reference.sdf"), state.study.referenceSdf);
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `${studyName()}_study.zip`, "application/zip");
  button.disabled = false;
  button.innerHTML = "Download ZIP <b>↓</b>";
}

function buildConfiguration() {
  const example = EXAMPLES[state.exampleId];
  return {
    interface_version: "0.1.0",
    backend_connected: true,
    job_id: state.resultSource === "job" ? state.currentJob?.id || null : null,
    conditioning_mode: state.mode,
    inputs: {
      pdb_filename: state.customPdb?.name || example?.pdb || null,
      sdf_filename: state.mode === "reference" ? (state.customSdf?.name || example?.sdf || null) : null,
    },
    parameters: { ...state.parameters },
  };
}

function csvText() {
  const header = [
    "candidate",
    "source_file",
    "smiles",
    "formula",
    "molecular_weight",
    "atom_count",
    "heavy_atoms",
    "hetero_atoms",
    "ring_estimate",
    "vina_score_only",
    "vina_minimize",
    "vina_dock",
    "vina_status",
  ];
  const rows = state.study.candidates.map((item) => [
    item.id,
    item.name,
    item.smiles || item.properties?.SMILES || "",
    item.formula,
    item.molecularWeight,
    item.atomCount,
    item.heavyAtoms,
    item.heteroAtoms,
    item.rings,
    item.properties?.VINA_SCORE_ONLY || "",
    item.properties?.VINA_MINIMIZE || "",
    item.properties?.VINA_DOCK || "",
    item.properties?.VINA_STATUS || "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function studyName() {
  return state.study?.example?.id || "conditar";
}

function filenameOnly(path) {
  return String(path || "").split("/").pop() || "conditar_input";
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
