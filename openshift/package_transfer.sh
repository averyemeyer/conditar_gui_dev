#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! command -v zip >/dev/null 2>&1; then
  echo "ERROR: zip was not found on PATH." >&2
  exit 2
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "ERROR: rsync was not found on PATH." >&2
  exit 2
fi

stamp="${1:-$(date +%Y%m%d)}"
dist_dir="dist"
bundle_name="conditar-gui-openshift-transfer-${stamp}"
package_name="${bundle_name}.zip"
package_path="${dist_dir}/${package_name}"
package_abs="$PWD/$package_path"
tmpdir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

mkdir -p "$dist_dir"
rm -f "$package_path"

mkdir -p "$tmpdir/$bundle_name"
rsync -a ./ "$tmpdir/$bundle_name/" \
  --exclude "dist/" \
  --exclude "job_data/" \
  --exclude ".tool_chest/" \
  --exclude ".conda/" \
  --exclude ".venv/" \
  --exclude "__pycache__/" \
  --exclude "*.pyc" \
  --exclude ".DS_Store" \
  --exclude "QUICK_START_TRANSFER.md"

(
  cd "$tmpdir"
  zip -r "$package_abs" "$bundle_name"
)

echo "$package_path"
