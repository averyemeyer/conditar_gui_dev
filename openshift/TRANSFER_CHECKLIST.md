# conDitar GUI OpenShift Transfer Checklist

This checklist captures the OpenShift assumptions validated in the sandbox and
the items to confirm with a site cluster admin.

## Current Site Signals

- OpenShift Web Terminal may replace a local workstation install of `oc`, Git,
  Helm, and Kustomize.
- Browser-based apps can be exposed through OpenShift Routes/URLs with
  site-managed TLS.
- The site may prefer controlled automation from an approved remote code
  repository or image repository.
- The remaining image question is whether the conDitar runtime image can be
  pulled directly from Docker Hub or must be mirrored into an approved internal
  registry.

## Required Images

- GUI image built from `gui/Containerfile`.
- conDitar runtime image. Start with the public image if the cluster can pull
  from Docker Hub:
  `docker.io/osuninglab/conditar-dev:2026-07-10`
- If external pulls are blocked, mirror the runtime image into a site-accessible
  registry. Internal OpenShift registry references usually look like:
  `image-registry.openshift-image-registry.svc:5000/<project>/conditar-runtime:2026-07-10`
- The GUI image includes the GUI Tool Chest and builds the Lilly Medchem Rules
  command-line tools during the image build.

## Required OpenShift Objects

Apply the manifests under `gui/openshift/`:

- `ServiceAccount`: `conditar-gui`
- `Role` and `RoleBinding` allowing the GUI pod to create, read, and delete
  Kubernetes Jobs and read Pods/logs.
- `PersistentVolumeClaim`: `conditar-gui-jobs`
- `Deployment`: `conditar-gui`
- `Service` and `Route`
- `BuildConfig` and `ImageStream` if using OpenShift binary builds

## Storage Requirement

The GUI pod and generator Job pods share one PVC mounted at `/data`.

Validated sandbox storage was `ReadWriteOnce`. With RWO storage, generator Jobs
must run on the same node as the GUI pod. The generated Job manifest includes
required pod affinity for pods labeled `app=conditar-gui` on the same
`kubernetes.io/hostname`.

If the site provides `ReadWriteMany` storage, the affinity rule is still safe
but may be relaxed later.

## Required Environment

The deployed GUI should be configured with:

```bash
CONDITAR_RUNTIME=openshift_job
CONDITAR_OPENSHIFT_SUBMIT=true
CONDITAR_OPENSHIFT_DEVICE=cpu
CONDITAR_OPENSHIFT_GPU_COUNT=0
CONDITAR_OPENSHIFT_CPU_REQUEST=500m
CONDITAR_OPENSHIFT_MEMORY_REQUEST=4Gi
CONDITAR_OPENSHIFT_MEMORY_LIMIT=8Gi
CONDITAR_DOCKER_IMAGE=<site runtime image>
CONDITAR_JOB_ROOT=/data/jobs
```

For GPU clusters, replace the CPU settings with the site GPU resource name,
GPU count, and memory requests after the admin confirms their conventions.

## Deploy Command

From `gui/` after `oc login` and selecting the target project:

```bash
./openshift/deploy.sh \
  --project <project> \
  --runtime openshift_job \
  --submit \
  --cpu \
  --runtime-image <site-runtime-image>
```

Use `--storage <size>` to change the PVC request and `--route-host <host>` if
the site requires a fixed route hostname.

## Validation Run

Start with a small CPU job:

- target: OpenShift Job
- samples: 2
- batch size: 100
- Vina: off for the first infrastructure test
- optional tools: Lilly Medchem Rules and MedChem Filters

Expected behavior:

- GUI job enters `running`.
- `stdout.log` shows manifest creation and in-cluster submission.
- additional logs show OpenShift pod sampling progress.
- job flips to `completed`.
- SDF count appears in Results.
- output SDF files are under `/data/jobs/<job-id>/outputs`.
- generated manifest is saved as `outputs/conditar-openshift-job.yaml`.

## Known Sandbox Findings

- If pod logs show `HTTP Error 400: Bad Request`, the container may not have
  started yet. Check pod state before treating it as a job failure.
- If the pod is stuck in `ContainerCreating` with a `Multi-Attach` PVC error,
  the storage is probably `ReadWriteOnce` and the GUI and generator pods were
  scheduled onto different nodes. The current generated manifest includes pod
  affinity to avoid this.
- Long `oc logs -f` sessions can drop with a local connection reset. This does
  not mean the OpenShift Job failed. Re-run `oc login` if the CLI later reports
  that credentials are required.
- The standalone Lilly Tool Chest runner is available in the GUI image. The
  MedChem package's internal Lilly demerit filter may still need package-level
  `lilly-medchem-rules` discovery wiring if the site requires that specific
  subfilter.

## Site Questions

- Which OpenShift version and project/namespace will host the GUI?
- Should the first setup use OpenShift Web Terminal, SCALe automation, or a
  local workstation with `oc`?
- Can they provide `ReadWriteMany` storage, or should we keep RWO pod affinity?
- Are there any additional Route/TLS requirements beyond the site-managed
  default?
- Will generator Jobs run CPU-only or with GPUs?
- If GPUs are used, what is the resource name, such as `nvidia.com/gpu`?
- Do they allow OpenShift binary builds, or should we provide a prebuilt image?
- Can OpenShift pull `docker.io/osuninglab/conditar-dev:2026-07-10`, or what
  image registry should host the mirrored GUI and runtime images?
- If SCALe automation is used, what source should trigger it: an internal Git
  repository, an approved external repository, or an approved image registry?
- Are egress restrictions relevant for image builds or package downloads?
