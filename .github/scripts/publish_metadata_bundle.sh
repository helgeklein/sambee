#!/usr/bin/env bash

set -euo pipefail

readonly BUNDLE_ARTIFACT_TYPE="application/vnd.sambee.image-metadata.v1"

usage() {
  cat <<'EOF' >&2
Usage: publish_metadata_bundle.sh --bundle-dir <directory> --metadata-repository <repo> --image-digest <sha256:...>
EOF
  exit 1
}

bundle_dir=""
metadata_repository=""
image_digest=""

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle-dir)
      bundle_dir="$2"
      shift 2
      ;;
    --metadata-repository)
      metadata_repository="$2"
      shift 2
      ;;
    --image-digest)
      image_digest="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

if [[ -z "$bundle_dir" || -z "$metadata_repository" || -z "$image_digest" ]]; then
  usage
fi

for required_path in \
  "$bundle_dir/metadata.json" \
  "$bundle_dir/provenance/intoto.jsonl" \
  "$bundle_dir/sbom/linux-amd64.spdx.json" \
  "$bundle_dir/sbom/linux-arm64.spdx.json"
do
  if [[ ! -f "$required_path" ]]; then
    echo "Bundle file missing: $required_path" >&2
    exit 1
  fi
done

metadata_tag="$(bash "$script_dir/metadata_bundle_tag.sh" --image-digest "$image_digest")"

(
  cd "$bundle_dir"
  oras push "${metadata_repository}:${metadata_tag}" \
    --artifact-type "$BUNDLE_ARTIFACT_TYPE" \
    metadata.json:application/json \
    provenance/intoto.jsonl:application/json \
    sbom/linux-amd64.spdx.json:application/spdx+json \
    sbom/linux-arm64.spdx.json:application/spdx+json
)
