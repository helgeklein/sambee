#!/usr/bin/env bash

set -euo pipefail

readonly OCI_IMAGE_INDEX_MEDIA_TYPE="application/vnd.oci.image.index.v1+json"
readonly DOCKER_MANIFEST_LIST_MEDIA_TYPE="application/vnd.docker.distribution.manifest.list.v2+json"
readonly OCI_IMAGE_MANIFEST_MEDIA_TYPE="application/vnd.oci.image.manifest.v1+json"
readonly DOCKER_IMAGE_MANIFEST_MEDIA_TYPE="application/vnd.docker.distribution.manifest.v2+json"

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
  local config_json_input="$1"
  local key="$2"
  jq -r --arg key "$key" '.config.Labels[$key] // empty' <<<"$config_json_input"
}

extract_annotation() {
  local manifest_json="$1"
  local key="$2"
  jq -r --arg key "$key" '.annotations[$key] // empty' <<<"$manifest_json"
}

require_config_labels() {
  local config_json_input="$1"
  local subject="$2"

  local config_description
  local config_revision
  local config_source
  local config_title
  local config_url
  local config_version

  config_description="$(extract_config_label "$config_json_input" "org.opencontainers.image.description")"
  config_revision="$(extract_config_label "$config_json_input" "org.opencontainers.image.revision")"
  config_source="$(extract_config_label "$config_json_input" "org.opencontainers.image.source")"
  config_title="$(extract_config_label "$config_json_input" "org.opencontainers.image.title")"
  config_url="$(extract_config_label "$config_json_input" "org.opencontainers.image.url")"
  config_version="$(extract_config_label "$config_json_input" "org.opencontainers.image.version")"

  require_match "$config_description" "$expected_description" "$subject description"
  require_match "$config_revision" "$expected_revision" "$subject revision"
  require_match "$config_source" "$expected_source" "$subject source"
  require_match "$config_title" "$expected_title" "$subject title"
  require_match "$config_url" "$expected_source" "$subject URL"
  require_match "$config_version" "$expected_version" "$subject version"
}

require_annotations() {
  local manifest_json="$1"
  local subject="$2"

  local annotation_description
  local annotation_revision
  local annotation_source
  local annotation_title
  local annotation_url
  local annotation_version

  annotation_description="$(extract_annotation "$manifest_json" "org.opencontainers.image.description")"
  annotation_revision="$(extract_annotation "$manifest_json" "org.opencontainers.image.revision")"
  annotation_source="$(extract_annotation "$manifest_json" "org.opencontainers.image.source")"
  annotation_title="$(extract_annotation "$manifest_json" "org.opencontainers.image.title")"
  annotation_url="$(extract_annotation "$manifest_json" "org.opencontainers.image.url")"
  annotation_version="$(extract_annotation "$manifest_json" "org.opencontainers.image.version")"

  require_match "$annotation_description" "$expected_description" "$subject description"
  require_match "$annotation_revision" "$expected_revision" "$subject revision"
  require_match "$annotation_source" "$expected_source" "$subject source"
  require_match "$annotation_title" "$expected_title" "$subject title"
  require_match "$annotation_url" "$expected_source" "$subject URL"
  require_match "$annotation_version" "$expected_version" "$subject version"
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
if [[ "$index_media_type" != "$OCI_IMAGE_INDEX_MEDIA_TYPE" && "$index_media_type" != "$DOCKER_MANIFEST_LIST_MEDIA_TYPE" ]]; then
  echo "Candidate index media type mismatch: expected $OCI_IMAGE_INDEX_MEDIA_TYPE or $DOCKER_MANIFEST_LIST_MEDIA_TYPE, got $index_media_type" >&2
  exit 1
fi

if [[ "$image_ref" == *@* ]]; then
  image_name="${image_ref%@*}"
else
  image_name="${image_ref%:*}"
fi

require_config_labels "$config_json" "Candidate selected platform config"

if [[ "$index_media_type" == "$OCI_IMAGE_INDEX_MEDIA_TYPE" ]]; then
  require_annotations "$index_manifest_json" "Candidate index"
else
  echo "Candidate index is a Docker manifest list; skipping index annotation validation because this media type does not carry OCI annotations." >&2
fi

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
  manifest_media_type="$(jq -r '.mediaType // empty' <<<"$manifest_json")"
  manifest_config_json="$(crane config "$manifest_ref")"

  require_config_labels "$manifest_config_json" "Candidate manifest $manifest_digest config"

  if [[ "$manifest_media_type" == "$OCI_IMAGE_MANIFEST_MEDIA_TYPE" ]]; then
    require_annotations "$manifest_json" "Candidate manifest $manifest_digest"
  elif [[ "$manifest_media_type" == "$DOCKER_IMAGE_MANIFEST_MEDIA_TYPE" ]]; then
    echo "Candidate manifest $manifest_digest is a Docker image manifest; skipping manifest annotation validation because this media type does not carry OCI annotations." >&2
  else
    echo "Candidate manifest $manifest_digest media type mismatch: expected $OCI_IMAGE_MANIFEST_MEDIA_TYPE or $DOCKER_IMAGE_MANIFEST_MEDIA_TYPE, got $manifest_media_type" >&2
    exit 1
  fi
done

echo "resolved_digest=$resolved_digest" >> "$GITHUB_OUTPUT"
