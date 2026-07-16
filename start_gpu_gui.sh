#!/usr/bin/env bash
set -euo pipefail

# Friendly alias for the Slurm GPU launcher.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/start_slurm_gui.sh" "$@"
