#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$repo_root/extensions/makerworld-bridge"
output_dir="${1:-$repo_root/.safari-extension-build}"
team_id="${DEVELOPMENT_TEAM:-3KB968X34U}"

command -v xcrun >/dev/null 2>&1 || {
  echo "error: Xcode command-line tools are required" >&2
  exit 1
}
[[ "$team_id" =~ ^[A-Z0-9]{10}$ ]] || {
  echo "error: DEVELOPMENT_TEAM must be a 10-character Apple Team ID" >&2
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

project_file="$output_dir/Workshop MakerWorld Bridge/Workshop MakerWorld Bridge.xcodeproj/project.pbxproj"
[[ -f "$project_file" ]] || {
  echo "error: Safari converter did not create the expected Xcode project" >&2
  exit 1
}
TEAM_ID="$team_id" /usr/bin/perl -0pi -e \
  's/(CODE_SIGN_STYLE = Automatic;\n)(?!\s*DEVELOPMENT_TEAM)/$1\t\t\t\tDEVELOPMENT_TEAM = $ENV{TEAM_ID};\n/g' \
  "$project_file"

echo "Generated Safari extension project in $output_dir"
echo "Apple Development Team: $team_id"
