#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: promote_container_image.sh --image-name <repo> --source-digest <sha256:...> --tag <name> [--tag <name> ...]
EOF
  exit 1
}

image_name=""
source_digest=""
tags=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-name)
      image_name="$2"
      shift 2
      ;;
    --source-digest)
      source_digest="$2"
      shift 2
      ;;
    --tag)
      tags+=("$2")
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

if [[ -z "$image_name" || -z "$source_digest" || ${#tags[@]} -eq 0 ]]; then
  usage
fi

source_ref="${image_name}@${source_digest}"
resolved_source_digest="$(crane digest "$source_ref")"

if [[ "$resolved_source_digest" != "$source_digest" ]]; then
  echo "Source digest mismatch: expected $source_digest, resolved $resolved_source_digest" >&2
  exit 1
fi

for tag in "${tags[@]}"; do
  target_ref="${image_name}:${tag}"
  crane cp "$source_ref" "$target_ref"
  resolved_target_digest="$(crane digest "$target_ref")"
  if [[ "$resolved_target_digest" != "$source_digest" ]]; then
    echo "Promotion verification failed for $target_ref: expected $source_digest, resolved $resolved_target_digest" >&2
    exit 1
  fi
done
