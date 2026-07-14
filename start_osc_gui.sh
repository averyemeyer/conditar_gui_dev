#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

export CONDITAR_RUNTIME="${CONDITAR_RUNTIME:-podman}"
export CONDITAR_DOCKER_IMAGE="${CONDITAR_DOCKER_IMAGE:-localhost/conditar-dev:container-dev}"
export CONDITAR_DOCKER_TAR="${CONDITAR_DOCKER_TAR:-/fs/ess/PCON0041/mey200/container_images/localhost_conditar-dev_container-dev-20260710-105038.tar.gz}"
if [[ -z "${CONDITAR_SOURCE_MOUNT:-}" && -d ../conDitar-dev ]]; then
  export CONDITAR_SOURCE_MOUNT="$(cd ../conDitar-dev && pwd)"
fi
export CONDITAR_SLURM_ACCOUNT="${CONDITAR_SLURM_ACCOUNT:-PCON0041}"
export CONDITAR_SLURM_TIME="${CONDITAR_SLURM_TIME:-04:00:00}"
export CONDITAR_SLURM_MEM="${CONDITAR_SLURM_MEM:-32G}"
export CONDITAR_SLURM_CPUS="${CONDITAR_SLURM_CPUS:-4}"
export CONDITAR_SLURM_GPUS="${CONDITAR_SLURM_GPUS:-1}"

echo "Starting conDitar GUI"
echo "Container image: $CONDITAR_DOCKER_IMAGE"
echo "Container archive: $CONDITAR_DOCKER_TAR"
echo "Source mount: ${CONDITAR_SOURCE_MOUNT:-none}"
echo "Runtime: $CONDITAR_RUNTIME"
echo "Slurm defaults: account=$CONDITAR_SLURM_ACCOUNT time=$CONDITAR_SLURM_TIME mem=$CONDITAR_SLURM_MEM cpus=$CONDITAR_SLURM_CPUS gpus=$CONDITAR_SLURM_GPUS"
echo

python3 serve.py --host 127.0.0.1 --port "${PORT:-4173}" --open
