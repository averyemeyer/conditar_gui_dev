import { ADVANCED_PARAMETERS, EXAMPLES, PARAMETERS } from "./config.js?v=20260710-qvina-modes";
import { drawHistogram } from "./charts.js?v=20260710-qvina-modes";
import { ExampleDataService } from "./data-service.js?v=20260710-qvina-modes";
import { render2D, render3D } from "./viewers.js?v=20260710-qvina-modes";

const service = new ExampleDataService();
const state = {
  study: null,
  selected: null,
  exampleId: "custom",
  mode: "reference",
  view: "3d",
  parameters: Object.fromEntries([...PARAMETERS, ...ADVANCED_PARAMETERS].map((item) => [item.key, item.value])),
  customPdb: null,
  customSdf: null,
  batchInputs: [],
  currentJob: null,
  selectedJob: null,
  jobs: [],
  jobFilter: "all",
  jobPollTimer: null,
  activeTab: "setup",
  resultSource: "upload",
  runtimeHealth: null,
  targetTouched: false,
  histogramThreshold: null,
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
  setMode("reference", false);
  updateInputLabels(null);
  updateCommand();
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
      state.study = null;
      state.selected = null;
      state.resultSource = "upload";
      updateInputLabels(null);
      renderSummary();
      renderResultsTable();
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
  $("#job-target").addEventListener("change", () => {
    state.targetTouched = true;
    updateJobTargetControls();
  });
  $("#refresh-pdb").addEventListener("click", () => chooseFileAgain("#pdb-input"));
  $("#refresh-sdf").addEventListener("click", () => chooseFileAgain("#sdf-input"));
  $("#vina-enabled").addEventListener("change", updateVinaControls);
  ["#vina-mode", "#vina-exhaustiveness", "#vina-cpu"].forEach((selector) => {
    $(selector).addEventListener("input", updateCommand);
  });
  $("#refresh-jobs").addEventListener("click", () => refreshJobs(true));
  $("#job-filter").addEventListener("change", (event) => {
    state.jobFilter = event.target.value;
    renderJobsTable();
  });
  $("#result-search").addEventListener("input", renderResultsTable);
  $("#result-sort").addEventListener("change", renderResultsTable);
  $("#histogram-metric").addEventListener("change", renderCharts);
  $("#histogram-threshold").addEventListener("input", (event) => {
    state.histogramThreshold = Number(event.target.value);
    $("#histogram-threshold-value").textContent = Number(event.target.value).toFixed(1);
    renderCharts();
    renderResultsTable();
  });
  $("#histogram").addEventListener("mousemove", handleHistogramHover);
  $("#histogram").addEventListener("mouseleave", () => { $("#histogram-tooltip").textContent = "Hover a bar to see its range and count."; });
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
  $("#folder-input").addEventListener("change", handleFolderUpload);
  $("#clear-batch").addEventListener("click", clearBatchSelection);
  window.addEventListener("resize", debounce(renderCharts, 120));
  updateJobTargetControls();
  updateVinaControls();
  refreshRuntime(false);
}

async function refreshRuntime(showMessage = false) {
  const status = $("#runtime-status");
  const detail = $("#runtime-detail");
  status.textContent = "Checking runtime…";
  detail.textContent = "Detecting available container and scheduler tools.";
  try {
    const health = await service.health();
    state.runtimeHealth = health;
    if (!state.targetTouched) {
      $("#job-target").value = health.gpu_available && health.slurm?.sbatch ? "osc_gpu" : "local_cpu";
      updateJobTargetControls();
    }
    const slurm = health.slurm?.sbatch ? "sbatch available" : "sbatch not found";
    const gpu = health.gpu_available ? "GPU device visible" : "no local GPU visible";
    const gpuTarget = health.gpu_available && health.slurm?.sbatch;
    status.textContent = gpuTarget ? "OSC GPU available" : "Local CPU available";
    detail.textContent = `${gpu}; ${slurm}. Selected target: ${gpuTarget ? "OSC GPU" : "Local CPU"}.`;
    if (showMessage) showToast("Runtime selection refreshed.");
  } catch (error) {
    status.textContent = "Backend unavailable";
    detail.textContent = error.message;
    if (showMessage) showToast(`Runtime check failed: ${error.message}`);
  }
}

function resolvedTarget() {
  return $("#job-target").value;
}

function chooseFileAgain(selector) {
  const input = $(selector);
  input.value = "";
  input.click();
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
  state.customPdb = null;
  state.customSdf = null;
  state.batchInputs = [];
  updateCustomOptionLabel("");
  updateBatchLabel();
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
    if (state.exampleId !== "custom") {
      state.exampleId = "custom";
      state.study = null;
      state.selected = null;
      state.resultSource = "upload";
      updateInputLabels(null);
    }
    $("#example-select").value = "custom";
  }
  updateCommand();
}

function updateInputLabels(example) {
  $("#pdb-name").textContent = example ? example.pdb.split("/").pop() : "Choose a PDB file";
  $("#pdb-detail").textContent = example ? `${example.pdbRecords} · demo dataset` : "Required · uploaded with this job";
  $("#sdf-name").textContent = example?.sdf ? example.sdf.split("/").pop() : "Choose a reference SDF";
  $("#sdf-detail").textContent = example?.sdf ? "Reference ligand · demo dataset" : "Required for protein + ligand mode";
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
  if (!state.batchInputs.length && !state.study && !state.customPdb) {
    showToast("Load or upload a PDB before submitting a job.");
    return;
  }
  const button = $("#preview-run");
  button.disabled = true;
  button.querySelector("span").textContent = "Submitting";
  try {
    const payload = state.batchInputs.length ? buildBatchPayload() : buildJobPayload();
    const response = state.batchInputs.length ? await service.submitBatch(payload) : { jobs: [await service.submitJob(payload)], errors: [] };
    const job = response.jobs[0];
    state.currentJob = job;
    state.selectedJob = job;
    const failedJobs = response.jobs.filter((item) => item.status === "failed");
    const queuedJobs = response.jobs.length - failedJobs.length;
    const message = failedJobs.length
      ? `${queuedJobs} queued, ${failedJobs.length} failed. ${failedJobs[0].error_message || "See the selected job logs."}`
      : response.jobs.length > 1
        ? `${response.jobs.length} jobs queued${response.errors.length ? `, ${response.errors.length} skipped` : ""}.`
        : "Job queued.";
    updateJobPanel(job, message);
    updateJobDetail(job, message);
    await refreshJobs(false);
    setActiveTab("jobs");
    showToast(failedJobs.length ? message : response.jobs.length > 1 ? message : `${targetLabel(job)} job queued.`);
    if (response.errors.length) console.warn("Batch submission errors", response.errors);
    if (job.status !== "failed") pollJob(job.id);
  } catch (error) {
    showToast(error.message);
    updateJobPanel(null, error.message);
  } finally {
    button.disabled = false;
    updateBatchLabel();
  }
}

function buildJobPayload(inputOverride = null) {
  const example = EXAMPLES[state.exampleId];
  const pdb = inputOverride?.pdb || state.customPdb || (state.study?.pdbText ? {
    name: example?.pdb.split("/").pop() || "input.pdb",
    text: state.study.pdbText,
  } : null);
  const sdf = state.mode === "reference"
    ? (inputOverride?.sdf || state.customSdf || (state.study?.referenceSdf ? {
      name: example?.sdf?.split("/").pop() || "reference.sdf",
      text: state.study.referenceSdf,
    } : null))
    : null;
  return {
    target: resolvedTarget(),
    mode: state.mode,
    example_id: state.exampleId,
    input_name: inputOverride?.name || pdb?.name || state.exampleId,
    email: $("#job-email").value.trim(),
    pdb,
    sdf,
    slurm: buildSlurmPayload(),
    postprocess: buildPostprocessPayload(),
    parameters: {
      ...state.parameters,
      device: resolvedTarget() === "osc_gpu" ? "cuda:0" : "cpu",
    },
  };
}

function buildBatchPayload() {
  return {
    jobs: state.batchInputs.map((input) => buildJobPayload(input)),
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
    state.selectedJob = result.job || job;
    updateJobDetail(state.selectedJob, result.logs?.stdout || result.logs?.stderr || "No SDF files were found in the job output directory.");
    showToast(state.selectedJob?.error_message || "No SDF results were found for this job.");
    setActiveTab("jobs");
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
    artifacts: result.artifacts || [],
    logs: result.logs || {},
    summary: result.summary || {},
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
  const note = job?.status_note ? `${job.status_note}\n\n` : "";
  const error = job?.error_message ? `Error: ${job.error_message}\n\n` : "";
  $("#job-detail-log").textContent = trimLog(note + error + (logText || "Select a job to view logs."));
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
  const jobs = [...state.jobs]
    .filter((job) => {
      if (state.jobFilter === "all") return true;
      if (state.jobFilter === "active") return ["queued", "running"].includes(job.status);
      return job.status === state.jobFilter;
    })
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  $("#jobs-table").innerHTML = jobs.length ? jobs.map((job) => `
    <tr data-job-id="${escapeHtml(job.id)}" class="${state.selectedJob?.id === job.id ? "active" : ""}">
      <td>${escapeHtml(shortJobId(job.id))}<br><small title="${escapeHtml(job.id)}">${escapeHtml(job.mode || "run")}</small></td>
      <td><span class="status-badge" data-status="${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>${job.status_note ? `<br><small>${escapeHtml(job.status_note)}</small>` : ""}</td>
      <td>${escapeHtml(targetLabel(job))}<br><small>${escapeHtml(inputLabel(job))}</small></td>
      <td>${formatDate(job.created_at)}<br><small>${escapeHtml(slurmLabel(job))}</small></td>
      <td>
        <button class="secondary-button compact-action load-job-results" ${job.status === "completed" ? "" : "disabled"}>Results</button>
        <button class="secondary-button compact-action cancel-job" ${["completed", "failed", "canceled"].includes(job.status) ? "disabled" : ""}>Cancel</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="5">No jobs yet.</td></tr>`;

  $$("#jobs-table tr[data-job-id]").forEach((row) => row.addEventListener("click", async (event) => {
    const job = state.jobs.find((item) => item.id === row.dataset.jobId);
    if (!job) return;
    state.selectedJob = job;
    renderJobsTable();
    if (event.target.closest(".cancel-job")) {
      await cancelJob(job.id);
      return;
    }
    const logs = await service.getJobLogs(job.id).catch(() => ({ stdout: "", stderr: "" }));
    updateJobDetail(job, logs.stdout || logs.stderr || "Logs are not available for this job yet.");
    if (event.target.closest(".load-job-results")) {
      await loadSelectedJobResults(job.id);
    }
  }));
}

async function cancelJob(jobId) {
  try {
    const response = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Cancel failed.");
    state.selectedJob = body.job;
    await refreshJobs(false);
    updateJobDetail(body.job, "Cancel requested.");
    showToast("Job canceled.");
  } catch (error) {
    showToast(error.message);
  }
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
    cards.push(["Mean docking score", formatMetric(average("vinaScore")), "kcal/mol"]);
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
    ["Scored by docking", scored ? `${scored}/${candidates.length}` : "Not run"],
    ["Best docking", bestVina === null ? "n/a" : `${formatMetric(bestVina)} kcal/mol`],
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
    .filter((item) => {
      if (!query) return true;
      return [
        item.id,
        item.name,
        item.formula,
        item.smiles,
        item.properties?.SMILES,
        item.properties?.VINA_STATUS,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    })
    .filter((item) => {
      if (state.histogramThreshold === null) return true;
      const metric = $("#histogram-metric").value;
      const value = Number(item[metric]);
      if (!Number.isFinite(value)) return false;
      return metric === "vinaScore" ? value <= state.histogramThreshold : value >= state.histogramThreshold;
    })
    .sort((a, b) => sort === "index" ? a.index - b.index : compareMetric(candidateMetric(b, sort), candidateMetric(a, sort)));
}

function renderResultsTable() {
  const candidates = filteredCandidates();
  $("#visible-count").textContent = `${candidates.length} shown`;
  $("#result-table").innerHTML = candidates.map((item) => `
    <tr data-index="${item.index}" class="${state.selected?.index === item.index ? "active" : ""}">
      <td>${escapeHtml(item.id)}<br><small>${escapeHtml(item.formula)}</small></td>
      <td class="smiles-cell" title="${escapeHtml(item.smiles || item.properties?.SMILES || "")}">${escapeHtml(item.smiles || item.properties?.SMILES || "-")}</td>
      <td>${formatMetric(propertyMetric(item, "VINA_SCORE_ONLY"))}</td>
      <td>${formatMetric(propertyMetric(item, "VINA_MINIMIZE"))}</td>
      <td>${formatMetric(propertyMetric(item, "VINA_DOCK") ?? propertyMetric(item, "QVINA") ?? item.vinaScore)}</td>
    </tr>`).join("");
  $$("#result-table tr").forEach((row) => row.addEventListener("click", () => {
    state.selected = state.study.candidates.find((item) => item.index === Number(row.dataset.index));
    renderResultsTable();
    renderSelectedStructure();
    renderCharts();
  }));
}

function propertyMetric(item, key) {
  const value = Number.parseFloat(item.properties?.[key]);
  return Number.isFinite(value) ? value : null;
}

function candidateMetric(item, key) {
  if (key === "vina_score_only") return propertyMetric(item, "VINA_SCORE_ONLY");
  if (key === "vina_minimize") return propertyMetric(item, "VINA_MINIMIZE");
  if (key === "vina_dock") return propertyMetric(item, "VINA_DOCK");
  if (key === "qvina") return propertyMetric(item, "QVINA");
  return item[key];
}

function renderCharts() {
  if (!state.study || state.activeTab !== "results" || !$(".analytics-details").open) return;
  const metric = $("#histogram-metric").value;
  const label = $("#histogram-metric").selectedOptions[0].textContent;
  const values = numericValues(state.study.candidates, metric);
  const slider = $("#histogram-threshold");
  if (!values.length) {
    slider.disabled = true;
    $("#histogram-threshold-value").textContent = "—";
    drawHistogram($("#histogram"), values, label);
    return;
  }
  const min = Math.min(...values); const max = Math.max(...values);
  slider.disabled = false; slider.min = min; slider.max = max; slider.step = (max - min || 1) / 100;
  if (state.histogramThreshold === null || state.histogramThreshold < min || state.histogramThreshold > max) state.histogramThreshold = min;
  slider.value = state.histogramThreshold;
  $("#histogram-threshold-value").textContent = Number(state.histogramThreshold).toFixed(1);
  const lowerIsBetter = metric === "vinaScore";
  const passing = values.filter((value) => lowerIsBetter ? value <= state.histogramThreshold : value >= state.histogramThreshold).length;
  $("#histogram-tooltip").textContent = `${passing}/${values.length} molecules meet the threshold (${lowerIsBetter ? "at or below" : "at or above"}).`;
  drawHistogram($("#histogram"), values, label, state.histogramThreshold);
}

function handleHistogramHover(event) {
  const chart = $("#histogram")._histogram;
  if (!chart) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const index = Math.max(0, Math.min(chart.bins - 1, Math.floor((x - chart.pad.left) / (chart.plotW / chart.bins))));
  const step = (chart.max - chart.min || 1) / chart.bins;
  const start = chart.min + index * step;
  $("#histogram-tooltip").textContent = `${start.toFixed(1)}–${(start + step).toFixed(1)}: ${chart.counts[index]} molecule${chart.counts[index] === 1 ? "" : "s"}`;
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
    metrics.push(["Docking", formatMetric(molecule.vinaScore)]);
  }
  if (molecule.properties?.VINA_SCORE_ONLY && molecule.vinaScore === null) {
    metrics.push(["Vina score", formatMetric(Number.parseFloat(molecule.properties.VINA_SCORE_ONLY))]);
  }
  if (molecule.properties?.VINA_MINIMIZE) {
    metrics.push(["Vina min", formatMetric(Number.parseFloat(molecule.properties.VINA_MINIMIZE))]);
  }
  if (molecule.properties?.VINA_DOCK) {
    metrics.push(["Vina dock", formatMetric(Number.parseFloat(molecule.properties.VINA_DOCK))]);
  }
  if (molecule.properties?.QVINA) {
    metrics.push(["QVina", formatMetric(Number.parseFloat(molecule.properties.QVINA))]);
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
  if (state.resultSource === "job" && state.selectedJob) {
    const count = state.study?.summary?.sdf_count ?? state.study?.candidates?.length ?? 0;
    $("#results-source").textContent = `Loaded ${count} generated SDF${count === 1 ? "" : "s"} from job ${state.selectedJob.id}.`;
    return;
  }
  $("#results-source").textContent = "Upload input structures and submit a job to review generated outputs here.";
}

function targetLabel(job) {
  if (!job) return "Local CPU";
  if (job.target === "local_cpu") return "Local CPU";
  if (job.target === "osc_gpu") return "OSC GPU";
  return job.target || "Local CPU";
}

function shortJobId(jobId) {
  const text = String(jobId || "");
  return text.length > 22 ? `${text.slice(0, 15)}…${text.slice(-6)}` : text;
}

function slurmLabel(job) {
  const slurm = job?.slurm || {};
  if (slurm.job_id && slurm.state) return `Slurm ${slurm.job_id} · ${slurm.state}`;
  if (slurm.job_id) return `Slurm ${slurm.job_id}`;
  return job?.target === "osc_gpu" ? "Slurm pending" : "";
}

function inputLabel(job) {
  return job?.input_name || filenameOnly(job?.inputs?.pdb || "") || job?.example_id || "custom";
}

function updateJobTargetControls() {
  const target = resolvedTarget();
  $("#slurm-controls").hidden = target !== "osc_gpu";
  $("#job-runtime-label").textContent = target === "osc_gpu" ? "OSC GPU" : "Local CPU";
  $("#param-device").value = target === "osc_gpu" ? "auto" : "cpu";
  state.parameters.device = target === "osc_gpu" ? "auto" : "cpu";
  updateBatchLabel();
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
  const pdbName = state.batchInputs.length
    ? `${state.batchInputs.length} folders`
    : (state.customPdb?.name || EXAMPLES[state.exampleId]?.pdb || "<choose PDB>");
  const sdfName = state.customSdf?.name || EXAMPLES[state.exampleId]?.sdf;
  const args = [
    "conditar-sample",
    `--device ${state.parameters.device}`,
    `--num_samples ${state.parameters.num_samples}`,
    `--batch_size ${state.parameters.batch_size}`,
    `--pocket_radius ${state.parameters.pocket_radius}`,
    `--atom_enc_mode ${state.parameters.atom_enc_mode}`,
    `--pdb_filename ${pdbName}`,
  ];
  if (state.mode === "reference" && sdfName) args.push(`--sdf_filename ${sdfName}`);
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
  const text = await readValidatedTextFile(file, "pdb");
  if (!text) return;
  state.customPdb = { name: file.name, text };
  state.batchInputs = [];
  updateBatchLabel();
  $("#pdb-name").textContent = file.name;
  $("#pdb-detail").textContent = `${formatBytes(file.size)} · local upload`;
  $("#example-select").value = "custom";
  state.exampleId = "custom";
  updateCustomOptionLabel(file.name);
  if (state.study) {
    state.study.pdbText = state.customPdb.text;
    renderSelectedStructure();
  }
}

async function handleSdfUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const text = await readValidatedTextFile(file, "sdf");
  if (!text) return;
  state.customSdf = { name: file.name, text };
  state.batchInputs = [];
  updateBatchLabel();
  $("#sdf-name").textContent = file.name;
  $("#sdf-detail").textContent = `${formatBytes(file.size)} · local upload`;
  $("#example-select").value = "custom";
  state.exampleId = "custom";
  updateCustomOptionLabel(state.customPdb?.name || file.name);
}

async function handleFolderUpload(event) {
  const files = [...event.target.files];
  if (!files.length) return;
  try {
    const grouped = await groupBatchFiles(files);
    state.batchInputs = grouped;
    $("#example-select").value = "custom";
    state.exampleId = "custom";
    updateCustomOptionLabel(grouped.length === 1 ? grouped[0].name : `${grouped.length} folders`);
    updateBatchLabel();
    updateCommand();
    showToast(`${grouped.length} folder${grouped.length === 1 ? "" : "s"} ready for batch submission.`);
  } catch (error) {
    showToast(error.message);
    state.batchInputs = [];
    updateBatchLabel();
  }
}

function clearBatchSelection() {
  state.batchInputs = [];
  $("#folder-input").value = "";
  updateBatchLabel();
  updateCommand();
  showToast("Batch selection cleared. You can choose another folder or upload one input.");
}

async function groupBatchFiles(files) {
  const byFolder = new Map();
  files.forEach((file) => {
    const relative = file.webkitRelativePath || file.name;
    const parts = relative.split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "Selected files";
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(file);
  });
  const jobs = [];
  const skipped = [];
  for (const [folder, folderFiles] of byFolder) {
    const pdbFile = chooseInputFile(folderFiles, ".pdb", ["protein", "pocket"]);
    const sdfFile = chooseInputFile(folderFiles, ".sdf", ["ligand", "reference", "ref"]);
    if (!pdbFile) {
      skipped.push(`${folder}: no PDB`);
      continue;
    }
    const pdbText = await readValidatedTextFile(pdbFile, "pdb", false);
    const sdfText = sdfFile ? await readValidatedTextFile(sdfFile, "sdf", false) : null;
    if (!pdbText) {
      skipped.push(`${folder}: invalid PDB`);
      continue;
    }
    if (state.mode === "reference" && !sdfText) {
      skipped.push(`${folder}: no valid SDF`);
      continue;
    }
    jobs.push({
      name: folder,
      pdb: { name: pdbFile.name, text: pdbText },
      sdf: sdfText ? { name: sdfFile.name, text: sdfText } : null,
    });
  }
  if (!jobs.length) {
    throw new Error(state.mode === "reference"
      ? "No valid batch folders found. Each folder needs a PDB and SDF in reference mode."
      : "No valid batch folders found. Each folder needs a PDB.");
  }
  if (skipped.length) {
    showToast(`${jobs.length} folder${jobs.length === 1 ? "" : "s"} ready; ${skipped.length} skipped.`);
    console.warn("Skipped batch folders", skipped);
  }
  return jobs;
}

function chooseInputFile(files, extension, preferredTokens = []) {
  const candidates = files.filter((file) => file.name.toLowerCase().endsWith(extension));
  if (!candidates.length) return null;
  const preferred = candidates.find((file) => {
    const name = file.name.toLowerCase();
    return preferredTokens.some((token) => name.includes(token)) && !name.includes("generated");
  });
  return preferred || candidates.find((file) => !file.name.toLowerCase().includes("generated")) || candidates[0];
}

async function readValidatedTextFile(file, kind, showError = true) {
  const text = await file.text();
  const lower = file.name.toLowerCase();
  const validExtension = kind === "pdb" ? lower.endsWith(".pdb") : lower.endsWith(".sdf");
  const validContent = kind === "pdb"
    ? text.split(/\r?\n/, 200).some((line) => /^(ATOM  |HETATM|MODEL |HEADER|CRYST1)/.test(line))
    : text.includes("$$$$");
  if (!validExtension || !validContent) {
    if (showError) showToast(`${file.name} does not look like a valid ${kind.toUpperCase()} file.`);
    return null;
  }
  return text;
}

function updateBatchLabel() {
  const count = state.batchInputs.length;
  $("#folder-name").textContent = count ? `${count} batch folder${count === 1 ? "" : "s"}` : "Batch folders";
  $("#folder-detail").textContent = count
    ? `Generate will submit ${count} ${resolvedTarget() === "osc_gpu" ? "independent Slurm" : "serial queued CPU"} job${count === 1 ? "" : "s"}`
    : "Optional: one PDB and optional SDF per folder";
  $("#batch-mode-banner").hidden = !count;
  $("#batch-mode-title").textContent = resolvedTarget() === "osc_gpu" ? "Parallel GPU batch" : "Queued CPU batch";
  $("#batch-mode-message").textContent = count
    ? `${count} folder${count === 1 ? "" : "s"} ready. ${resolvedTarget() === "osc_gpu" ? "Parallel GPU batch ready: Slurm will process the folders concurrently when capacity is available." : "Queued CPU batch ready: folders will run one at a time."} Each folder is processed as its own job; inputs are never mixed.`
    : "Each selected folder will submit as a separate job.";
  $("#preview-run span").textContent = count
    ? `Submit ${count} batch job${count === 1 ? "" : "s"}`
    : "Generate molecules";
}

function updateCustomOptionLabel(label) {
  const option = $("#example-select option[value='custom']");
  option.textContent = label ? `Custom · ${label}` : "Custom upload";
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
  let archiveNotice = "The archive will be saved by your browser to its Downloads folder.";
  if (state.resultSource === "job" && state.selectedJob?.id) {
    try {
      const saved = await service.exportJob(state.selectedJob.id);
      archiveNotice = `A server copy was saved to ${saved.path}. The browser copy will be saved to its Downloads folder.`;
    } catch (error) {
      archiveNotice = `Browser copy will be saved to Downloads. Server archive was not created: ${error.message}`;
    }
  }
  const zip = new window.JSZip();
  const structures = zip.folder("generated_structures");
  filteredCandidates().forEach((item) => structures.file(item.name, item.text));
  zip.file("metrics.csv", csvText());
  zip.file("run_config.json", JSON.stringify(buildConfiguration(), null, 2));
  if (state.study.logs?.stdout) zip.file("logs/stdout.log", state.study.logs.stdout);
  if (state.study.logs?.stderr) zip.file("logs/stderr.log", state.study.logs.stderr);
  if (state.study.summary) zip.file("job_summary.json", JSON.stringify(state.study.summary, null, 2));
  if (state.study.pdbText) zip.file(filenameOnly(state.study.example.pdb || "input.pdb"), state.study.pdbText);
  if (state.study.referenceSdf) zip.file(filenameOnly(state.study.example.sdf || "reference.sdf"), state.study.referenceSdf);
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `${studyName()}_study.zip`, "application/zip");
  showToast(archiveNotice);
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
    "qvina",
  ];
  const rows = filteredCandidates().map((item) => [
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
    item.properties?.QVINA || "",
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
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
