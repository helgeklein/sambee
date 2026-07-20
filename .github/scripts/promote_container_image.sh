#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: promote_container_image.sh --image-name <repo> --source-digest <sha256:...> --tag <name> [--tag <name> ...] [--immutable]
EOF
  exit 1
}

image_name=""
source_digest=""
tags=()
immutable=false

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
    --immutable)
      immutable=true
      shift
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
  if [[ "$immutable" == true ]]; then
    if resolved_target_digest="$(crane digest "$target_ref" 2>/dev/null)"; then
      if [[ "$resolved_target_digest" != "$source_digest" ]]; then
        echo "Immutable tag conflict for $target_ref: expected $source_digest, resolved $resolved_target_digest" >&2
        exit 1
      fi
      continue
    fi
  fi

  if ! crane cp "$source_ref" "$target_ref"; then
    echo "Failed while updating mutable pointer $target_ref from verified digest $source_digest. Inspect $target_ref before retrying; its final registry state is unknown." >&2
    exit 1
  fi
  if ! resolved_target_digest="$(crane digest "$target_ref")"; then
    echo "Unable to verify mutable pointer $target_ref after updating it. Inspect $target_ref before retrying." >&2
    exit 1
  fi
  if [[ "$resolved_target_digest" != "$source_digest" ]]; then
    echo "Mutable pointer verification failed for $target_ref: expected $source_digest, resolved $resolved_target_digest. No immutable artifact was changed." >&2
    exit 1
  fi
done
