#!/usr/bin/env bash
set -euo pipefail

readonly manifest_path="${1:-.github/tools/trivy/Dockerfile}"

if [[ ! -f "$manifest_path" ]]; then
  echo "Trivy image manifest not found: $manifest_path" >&2
  exit 1
fi

trivy_image="$({ awk 'toupper($1) == "FROM" { print $2; exit }' "$manifest_path"; } | tr -d '[:space:]')"

if [[ -z "$trivy_image" ]]; then
  echo "Could not resolve Trivy image from: $manifest_path" >&2
  exit 1
fi

printf '%s\n' "$trivy_image"
