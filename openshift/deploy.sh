#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Deploy the conDitar GUI to the current OpenShift project.

Usage:
  ./openshift/deploy.sh [options]

Options:
  --project NAME             Switch to an existing OpenShift project first.
  --create-project NAME      Create or switch to an OpenShift project first.
  --runtime MODE             Default GUI runtime target: openshift_mock or openshift_job.
  --runtime-image IMAGE      conDitar generator image used by OpenShift Jobs.
  --submit                   Allow the GUI pod to create and poll OpenShift Jobs.
  --cpu                      Configure generated OpenShift Jobs for CPU-only execution.
  --storage SIZE             PVC request size, such as 10Gi or 50Gi.
  --route-host HOST          Optional fixed Route hostname.
  --skip-build               Apply manifests without starting a new OpenShift build.
  --help                     Show this help.

Default runtime is openshift_mock, which is safe for first deployment checks.
EOF
}

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PROJECT=""
CREATE_PROJECT=""
RUNTIME="${CONDITAR_RUNTIME:-openshift_mock}"
RUNTIME_IMAGE="${CONDITAR_DOCKER_IMAGE:-osuninglab/conditar-dev:2026-07-10}"
STORAGE="${CONDITAR_OPENSHIFT_STORAGE:-10Gi}"
ROUTE_HOST="${CONDITAR_OPENSHIFT_ROUTE_HOST:-}"
SKIP_BUILD=0
OPENSHIFT_SUBMIT="${CONDITAR_OPENSHIFT_SUBMIT:-false}"
OPENSHIFT_DEVICE="${CONDITAR_OPENSHIFT_DEVICE:-cuda:0}"
OPENSHIFT_GPU_COUNT="${CONDITAR_OPENSHIFT_GPU_COUNT:-1}"
OPENSHIFT_CPU_REQUEST="${CONDITAR_OPENSHIFT_CPU_REQUEST:-2}"
OPENSHIFT_MEMORY_REQUEST="${CONDITAR_OPENSHIFT_MEMORY_REQUEST:-16Gi}"
OPENSHIFT_MEMORY_LIMIT="${CONDITAR_OPENSHIFT_MEMORY_LIMIT:-32Gi}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT="${2:-}"; shift 2 ;;
    --create-project)
      CREATE_PROJECT="${2:-}"; shift 2 ;;
    --runtime)
      RUNTIME="${2:-}"; shift 2 ;;
    --runtime-image)
      RUNTIME_IMAGE="${2:-}"; shift 2 ;;
    --submit)
      OPENSHIFT_SUBMIT="true"; shift ;;
    --cpu)
      OPENSHIFT_DEVICE="cpu"
      OPENSHIFT_GPU_COUNT="0"
      OPENSHIFT_CPU_REQUEST="${CONDITAR_OPENSHIFT_CPU_REQUEST:-500m}"
      OPENSHIFT_MEMORY_REQUEST="${CONDITAR_OPENSHIFT_MEMORY_REQUEST:-4Gi}"
      OPENSHIFT_MEMORY_LIMIT="${CONDITAR_OPENSHIFT_MEMORY_LIMIT:-8Gi}"
      shift ;;
    --storage)
      STORAGE="${2:-}"; shift 2 ;;
    --route-host)
      ROUTE_HOST="${2:-}"; shift 2 ;;
    --skip-build)
      SKIP_BUILD=1; shift ;;
    --help|-h)
      usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2 ;;
  esac
done

if [[ "$RUNTIME" != "openshift_mock" && "$RUNTIME" != "openshift_job" ]]; then
  echo "ERROR: --runtime must be openshift_mock or openshift_job." >&2
  exit 2
fi

if ! command -v oc >/dev/null 2>&1; then
  echo "ERROR: oc was not found on PATH. Install the OpenShift CLI and run oc login first." >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 was not found on PATH. Install Python 3, then retry." >&2
  exit 2
fi

if ! oc whoami >/dev/null 2>&1; then
  echo "ERROR: oc is not logged in. Run oc login, then retry." >&2
  exit 2
fi

if [[ -n "$CREATE_PROJECT" ]]; then
  oc new-project "$CREATE_PROJECT" >/dev/null 2>&1 || oc project "$CREATE_PROJECT" >/dev/null
elif [[ -n "$PROJECT" ]]; then
  oc project "$PROJECT" >/dev/null
fi

PROJECT_NAME="$(oc project -q)"
echo "Using OpenShift project: $PROJECT_NAME"

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

previous_image_ref="$(oc get deployment/conditar-gui -o jsonpath='{.spec.template.spec.containers[?(@.name=="gui")].image}' 2>/dev/null || true)"
existing_image_ref="$(oc get istag conditar-gui:latest -o jsonpath='{.image.dockerImageReference}' 2>/dev/null || true)"
current_image_ref="${previous_image_ref:-$existing_image_ref}"

cp -R openshift "$tmpdir/openshift"

python3 - "$tmpdir/openshift" "$RUNTIME" "$RUNTIME_IMAGE" "$STORAGE" "$ROUTE_HOST" "$OPENSHIFT_SUBMIT" "$OPENSHIFT_DEVICE" "$OPENSHIFT_GPU_COUNT" "$OPENSHIFT_CPU_REQUEST" "$OPENSHIFT_MEMORY_REQUEST" "$OPENSHIFT_MEMORY_LIMIT" "$current_image_ref" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
(
    runtime,
    runtime_image,
    storage,
    route_host,
    openshift_submit,
    openshift_device,
    openshift_gpu_count,
    openshift_cpu_request,
    openshift_memory_request,
    openshift_memory_limit,
    current_image_ref,
) = sys.argv[2:13]

config = root / "configmap.yaml"
text = config.read_text()
replacements = {
    "CONDITAR_RUNTIME": runtime,
    "CONDITAR_DOCKER_IMAGE": runtime_image,
    "CONDITAR_OPENSHIFT_SUBMIT": openshift_submit,
    "CONDITAR_OPENSHIFT_DEVICE": openshift_device,
    "CONDITAR_OPENSHIFT_GPU_COUNT": openshift_gpu_count,
    "CONDITAR_OPENSHIFT_CPU_REQUEST": openshift_cpu_request,
    "CONDITAR_OPENSHIFT_MEMORY_REQUEST": openshift_memory_request,
    "CONDITAR_OPENSHIFT_MEMORY_LIMIT": openshift_memory_limit,
}
for key, value in replacements.items():
    text = re.sub(rf'{key}: ".*"', f'{key}: "{value}"', text)
config.write_text(text)

pvc = root / "pvc.yaml"
text = pvc.read_text()
text = re.sub(r"storage: .*", f"storage: {storage}", text)
pvc.write_text(text)

if route_host:
    route = root / "route.yaml"
    text = route.read_text()
    if re.search(r"\n  host: ", text):
        text = re.sub(r"\n  host: .*", f"\n  host: {route_host}", text)
    else:
        text = text.replace("\nspec:\n", f"\nspec:\n  host: {route_host}\n", 1)
    route.write_text(text)

if current_image_ref:
    deployment = root / "deployment.yaml"
    text = deployment.read_text()
    text = re.sub(r"image: conditar-gui:[^\s]+", f"image: {current_image_ref}", text)
    deployment.write_text(text)
PY

oc apply -k "$tmpdir/openshift"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "Starting OpenShift binary build from $(pwd)"
  if ! oc start-build conditar-gui --from-dir=. --follow --wait; then
    if [[ -n "$previous_image_ref" ]]; then
      echo "Build failed; restoring previous GUI image."
      oc set image deployment/conditar-gui "gui=$previous_image_ref" >/dev/null || true
    fi
    exit 1
  fi
else
  echo "Skipping build because --skip-build was provided."
fi

image_ref="$(oc get istag conditar-gui:latest -o jsonpath='{.image.dockerImageReference}' 2>/dev/null || true)"
if [[ -n "$image_ref" ]]; then
  oc set image deployment/conditar-gui "gui=$image_ref" >/dev/null
fi

oc rollout status deployment/conditar-gui

route_url="$(oc get route conditar-gui -o jsonpath='{.spec.host}' 2>/dev/null || true)"
if [[ -n "$route_url" ]]; then
  echo "conDitar GUI: https://$route_url"
else
  echo "Deployment is ready. No Route host was reported; inspect with: oc get route conditar-gui"
fi
