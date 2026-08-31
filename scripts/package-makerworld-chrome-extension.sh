#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$repo_root/extensions/makerworld-bridge"
output_arg="${1:-$repo_root/.chrome-extension-build/workshop-makerworld-bridge.zip}"

command -v zip >/dev/null 2>&1 || {
  echo "error: zip is required to package the Chrome extension" >&2
  exit 1
}

mkdir -p "$(dirname "$output_arg")"
output_dir="$(cd "$(dirname "$output_arg")" && pwd)"
archive="$output_dir/$(basename "$output_arg")"
rm -f "$archive"

(
  cd "$source_dir"
  zip -q "$archive" \
    manifest.json \
    background.js \
    content-workshop.js \
    content-makerworld.js \
    makerworld-client.js \
    popup.html \
    popup.css \
    popup.js \
    icons/icon-16.png \
    icons/icon-32.png \
    icons/icon-48.png \
    icons/icon-128.png
)

echo "Packaged Chrome extension at $archive"
