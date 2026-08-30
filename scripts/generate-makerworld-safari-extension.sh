#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$repo_root/extensions/makerworld-bridge"
output_dir="${1:-$repo_root/.safari-extension-build}"

command -v xcrun >/dev/null 2>&1 || {
  echo "error: Xcode command-line tools are required" >&2
  exit 1
}

mkdir -p "$output_dir"

xcrun safari-web-extension-converter "$source_dir" \
  --project-location "$output_dir" \
  --app-name "Workshop MakerWorld Bridge" \
  --bundle-identifier "com.nintek.workshop.makerworld-bridge" \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

echo "Generated Safari extension project in $output_dir"
