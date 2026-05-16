#!/usr/bin/env bash

set -euo pipefail

readonly OCI_IMAGE_INDEX_MEDIA_TYPE="application/vnd.oci.image.index.v1+json"

usage() {
  cat <<'EOF' >&2
Usage: verify_candidate_image.sh --image-ref <repo:tag|repo@digest> --expected-description <text> --expected-revision <sha> --expected-version <version> --expected-source <url> --expected-title <text>
EOF
  exit 1
}

image_ref=""
expected_description=""
expected_revision=""
expected_version=""
expected_source=""
expected_title=""

require_match() {
  local actual="$1"
  local expected="$2"
  local label="$3"

  if [[ "$actual" != "$expected" ]]; then
    echo "$label mismatch: expected $expected, got $actual" >&2
    exit 1
  fi
}

extract_config_label() {
  local key="$1"
  jq -r --arg key "$key" '.config.Labels[$key] // empty' <<<"$config_json"
}

extract_index_annotation() {
  local key="$1"
  jq -r --arg key "$key" '.annotations[$key] // empty' <<<"$index_manifest_json"
}

extract_manifest_annotation() {
  local manifest_json="$1"
  local key="$2"
  jq -r --arg key "$key" '.annotations[$key] // empty' <<<"$manifest_json"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-ref)
      image_ref="$2"
      shift 2
      ;;
    --expected-description)
      expected_description="$2"
      shift 2
      ;;
    --expected-revision)
      expected_revision="$2"
      shift 2
      ;;
    --expected-version)
      expected_version="$2"
      shift 2
      ;;
    --expected-source)
      expected_source="$2"
      shift 2
      ;;
    --expected-title)
      expected_title="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

if [[ -z "$image_ref" || -z "$expected_description" || -z "$expected_revision" || -z "$expected_source" || -z "$expected_title" || -z "$expected_version" ]]; then
  usage
fi

config_json="$(crane config "$image_ref")"
index_manifest_json="$(crane manifest "$image_ref")"
resolved_digest="$(crane digest "$image_ref")"

index_media_type="$(jq -r '.mediaType // empty' <<<"$index_manifest_json")"
require_match "$index_media_type" "$OCI_IMAGE_INDEX_MEDIA_TYPE" "Candidate index media type"

if [[ "$image_ref" == *@* ]]; then
  image_name="${image_ref%@*}"
else
  image_name="${image_ref%:*}"
fi

config_description="$(extract_config_label "org.opencontainers.image.description")"
config_revision="$(extract_config_label "org.opencontainers.image.revision")"
config_source="$(extract_config_label "org.opencontainers.image.source")"
config_title="$(extract_config_label "org.opencontainers.image.title")"
config_url="$(extract_config_label "org.opencontainers.image.url")"
config_version="$(extract_config_label "org.opencontainers.image.version")"

index_description="$(extract_index_annotation "org.opencontainers.image.description")"
index_revision="$(extract_index_annotation "org.opencontainers.image.revision")"
index_source="$(extract_index_annotation "org.opencontainers.image.source")"
index_title="$(extract_index_annotation "org.opencontainers.image.title")"
index_url="$(extract_index_annotation "org.opencontainers.image.url")"
index_version="$(extract_index_annotation "org.opencontainers.image.version")"

require_match "$config_description" "$expected_description" "Candidate config description"
require_match "$config_revision" "$expected_revision" "Candidate config revision"
require_match "$config_source" "$expected_source" "Candidate config source"
require_match "$config_title" "$expected_title" "Candidate config title"
require_match "$config_url" "$expected_source" "Candidate config URL"
require_match "$config_version" "$expected_version" "Candidate config version"

require_match "$index_description" "$expected_description" "Candidate index description"
require_match "$index_revision" "$expected_revision" "Candidate index revision"
require_match "$index_source" "$expected_source" "Candidate index source"
require_match "$index_title" "$expected_title" "Candidate index title"
require_match "$index_url" "$expected_source" "Candidate index URL"
require_match "$index_version" "$expected_version" "Candidate index version"

mapfile -t runnable_manifest_digests < <(
  jq -r '
    .manifests[]
    | select((.platform.os // "") != "unknown")
    | select((.platform.architecture // "") != "unknown")
    | .digest
  ' <<<"$index_manifest_json"
)

if [[ ${#runnable_manifest_digests[@]} -eq 0 ]]; then
  echo "Candidate image index does not contain any runnable platform manifests: $image_ref" >&2
  exit 1
fi

for manifest_digest in "${runnable_manifest_digests[@]}"; do
  manifest_ref="${image_name}@${manifest_digest}"
  manifest_json="$(crane manifest "$manifest_ref")"

  manifest_description="$(extract_manifest_annotation "$manifest_json" "org.opencontainers.image.description")"
  manifest_revision="$(extract_manifest_annotation "$manifest_json" "org.opencontainers.image.revision")"
  manifest_source="$(extract_manifest_annotation "$manifest_json" "org.opencontainers.image.source")"
  manifest_title="$(extract_manifest_annotation "$manifest_json" "org.opencontainers.image.title")"
  manifest_url="$(extract_manifest_annotation "$manifest_json" "org.opencontainers.image.url")"
  manifest_version="$(extract_manifest_annotation "$manifest_json" "org.opencontainers.image.version")"

  require_match "$manifest_description" "$expected_description" "Candidate manifest $manifest_digest description"
  require_match "$manifest_revision" "$expected_revision" "Candidate manifest $manifest_digest revision"
  require_match "$manifest_source" "$expected_source" "Candidate manifest $manifest_digest source"
  require_match "$manifest_title" "$expected_title" "Candidate manifest $manifest_digest title"
  require_match "$manifest_url" "$expected_source" "Candidate manifest $manifest_digest URL"
  require_match "$manifest_version" "$expected_version" "Candidate manifest $manifest_digest version"
done

echo "resolved_digest=$resolved_digest" >> "$GITHUB_OUTPUT"
