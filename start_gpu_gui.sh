#!/usr/bin/env bash
set -euo pipefail

# Friendly alias for the OSC GPU launcher.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/start_osc_gui.sh" "$@"
