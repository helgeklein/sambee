#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: metadata_bundle_tag.sh --image-digest <sha256:...>
EOF
  exit 1
}

image_digest=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-digest)
      image_digest="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

if [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Image digest must use the form sha256:<64 lowercase hex characters>" >&2
  exit 1
fi

printf 'sha256-%s.meta\n' "${image_digest#sha256:}"
