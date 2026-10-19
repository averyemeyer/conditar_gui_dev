#!/usr/bin/env bash
set -euo pipefail

GUI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

oc() {
  case "$1 ${2:-}" in
    "whoami ") printf 'test-user\n' ;;
    "project -q") printf 'test-project\n' ;;
    "get deployment/conditar-gui"|"get istag") return 1 ;;
    "get route") printf 'conditar.example.test\n' ;;
    "apply -k")
      cp "$3/configmap.yaml" "$OC_MOCK_CAPTURE/configmap.yaml"
      cp "$3/deployment.yaml" "$OC_MOCK_CAPTURE/deployment.yaml"
      ;;
    "set image"|"rollout status") : ;;
    *) printf 'Unexpected oc call: %s\n' "$*" >&2; return 1 ;;
  esac
}
export -f oc

mkdir -p "$TEST_ROOT/cpu" "$TEST_ROOT/gpu"
export OC_MOCK_CAPTURE="$TEST_ROOT/cpu"
"$GUI_DIR/openshift/deploy.sh" > "$TEST_ROOT/cpu.log"
grep -q 'CONDITAR_RUNTIME: "openshift_job"' "$TEST_ROOT/cpu/configmap.yaml"
grep -q 'CONDITAR_OPENSHIFT_SUBMIT: "true"' "$TEST_ROOT/cpu/configmap.yaml"
grep -q 'CONDITAR_OPENSHIFT_DEVICE: "cpu"' "$TEST_ROOT/cpu/configmap.yaml"
grep -q 'CONDITAR_OPENSHIFT_GPU_COUNT: "0"' "$TEST_ROOT/cpu/configmap.yaml"
grep -q 'docker.io/osuninglab/conditar-dev-gui@sha256:' "$TEST_ROOT/cpu/deployment.yaml"
grep -q 'Runtime: OpenShift Jobs (real generator submissions)' "$TEST_ROOT/cpu.log"

export OC_MOCK_CAPTURE="$TEST_ROOT/gpu"
"$GUI_DIR/openshift/deploy.sh" --gpu > "$TEST_ROOT/gpu.log"
grep -q 'CONDITAR_RUNTIME: "openshift_job"' "$TEST_ROOT/gpu/configmap.yaml"
grep -q 'CONDITAR_OPENSHIFT_DEVICE: "cuda:0"' "$TEST_ROOT/gpu/configmap.yaml"
grep -q 'CONDITAR_OPENSHIFT_GPU_COUNT: "1"' "$TEST_ROOT/gpu/configmap.yaml"

echo "OpenShift deploy defaults passed"
