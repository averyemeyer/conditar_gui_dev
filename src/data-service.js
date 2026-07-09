import { EXAMPLES } from "./config.js?v=20260709-vina-display";
import { candidateId, parseSdf } from "./sdf.js?v=20260709-vina-display";

export class ExampleDataService {
  async loadStudy(exampleId, onProgress = () => {}) {
    const example = EXAMPLES[exampleId];
    if (!example) throw new Error(`Unknown example: ${exampleId}`);

    const [pdbText, referenceSdf] = await Promise.all([
      fetchText(example.pdb),
      example.sdf ? fetchText(example.sdf) : Promise.resolve(null),
    ]);

    let loaded = 0;
    const candidates = (await Promise.all(Array.from({ length: example.count }, async (_, index) => {
      const preferred = `${example.outputRoot}/${example.outputStem}${index}.sdf`;
      const fallback = example.outputFallbackStem
        ? `${example.outputRoot}/${example.outputFallbackStem}${index}.sdf`
        : null;
      let path = preferred;
      let text = await fetchText(preferred, false);
      if (!text && fallback) {
        path = fallback;
        text = await fetchText(fallback, false);
      }
      loaded += 1;
      onProgress(loaded, example.count);
      if (!text) return null;
      const molecule = parseSdf(text, path.split("/").pop());
      return { ...molecule, index, id: candidateId(index), path };
    }))).filter(Boolean).sort((a, b) => a.index - b.index);

    return { example, pdbText, referenceSdf, candidates };
  }

  async loadUploadedOutputs(files) {
    return Promise.all([...files].map(async (file, index) => {
      const text = await file.text();
      return { ...parseSdf(text, file.name), index, id: candidateId(index), path: file.name };
    }));
  }

  async submitJob(payload) {
    const response = await fetchJson("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.job;
  }

  async listJobs() {
    const response = await fetchJson("/api/jobs");
    return response.jobs;
  }

  async getJob(jobId) {
    const response = await fetchJson(`/api/jobs/${jobId}`);
    return response.job;
  }

  async getJobLogs(jobId) {
    return fetchJson(`/api/jobs/${jobId}/logs`);
  }

  async loadJobResults(job) {
    const response = await fetchJson(`/api/jobs/${job.id}/results`);
    return {
      inputs: response.inputs || {},
      candidates: response.files.map((file, index) => ({
        ...parseSdf(file.text, file.name),
        index,
        id: candidateId(index),
        path: file.relative_path,
      })),
    };
  }
}

async function fetchText(path, required = true) {
  const response = await fetch(path);
  if (!response.ok) {
    if (required) throw new Error(`Unable to load ${path}`);
    return null;
  }
  return response.text();
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed: ${path}`);
  return body;
}
