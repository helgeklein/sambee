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
metadata_ref="${metadata_repository}:${metadata_tag}"

verify_existing_bundle() {
  local existing_dir
  existing_dir="$(mktemp -d)"
  trap 'rm -rf "$existing_dir"' RETURN

  local descriptor
  descriptor="$(oras manifest fetch --descriptor "$metadata_ref")"
  if [[ "$(jq -r '.artifactType // empty' <<<"$descriptor")" != "$BUNDLE_ARTIFACT_TYPE" ]]; then
    echo "Existing metadata bundle $metadata_ref has an unexpected artifact type." >&2
    return 1
  fi

  oras pull --output "$existing_dir" "$metadata_ref" >/dev/null
  local relative_path
  for relative_path in \
    metadata.json \
    provenance/intoto.jsonl \
    sbom/linux-amd64.spdx.json \
    sbom/linux-arm64.spdx.json
  do
    if [[ ! -f "$existing_dir/$relative_path" ]] || ! cmp --silent "$bundle_dir/$relative_path" "$existing_dir/$relative_path"; then
      echo "Existing metadata bundle $metadata_ref conflicts with the candidate digest; increment Z and publish a new candidate." >&2
      return 1
    fi
  done

  local expected_files actual_files
  expected_files="$(printf '%s\n' metadata.json provenance/intoto.jsonl sbom/linux-amd64.spdx.json sbom/linux-arm64.spdx.json | sort)"
  actual_files="$(find "$existing_dir" -type f -printf '%P\n' | sort)"
  if [[ "$actual_files" != "$expected_files" ]]; then
    echo "Existing metadata bundle $metadata_ref has unexpected files." >&2
    return 1
  fi
}

if oras manifest fetch --descriptor "$metadata_ref" >/dev/null 2>&1; then
  verify_existing_bundle
  echo "Reused verified metadata bundle $metadata_ref"
  exit 0
fi

(
  cd "$bundle_dir"
  oras push "$metadata_ref" \
    --artifact-type "$BUNDLE_ARTIFACT_TYPE" \
    metadata.json:application/json \
    provenance/intoto.jsonl:application/json \
    sbom/linux-amd64.spdx.json:application/spdx+json \
    sbom/linux-arm64.spdx.json:application/spdx+json
)

  verify_existing_bundle
  echo "Published and verified metadata bundle $metadata_ref"
