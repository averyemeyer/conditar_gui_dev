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
bundle_name="conditar-gui-openshift-release-${stamp}"
package_name="${bundle_name}.zip"
package_path="${dist_dir}/${package_name}"
package_abs="$PWD/$package_path"
checksum_path="${package_abs}.sha256"
tmpdir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

mkdir -p "$dist_dir"
rm -f "$package_path" "$checksum_path"

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

if command -v shasum >/dev/null 2>&1; then
  (
    cd "$dist_dir"
    shasum -a 256 "$package_name" > "${package_name}.sha256"
  )
elif command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$dist_dir"
    sha256sum "$package_name" > "${package_name}.sha256"
  )
else
  echo "WARNING: no sha256 tool found; checksum file was not created." >&2
fi

echo "$package_path"
if [[ -f "$checksum_path" ]]; then
  echo "${package_path}.sha256"
fi
