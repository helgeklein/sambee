#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: verify_candidate_image.sh --image-ref <repo:tag|repo@digest> --expected-revision <sha> --expected-version <version> --expected-source <url>
EOF
  exit 1
}

image_ref=""
expected_revision=""
expected_version=""
expected_source=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-ref)
      image_ref="$2"
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
    *)
      usage
      ;;
  esac
done

if [[ -z "$image_ref" || -z "$expected_revision" || -z "$expected_version" || -z "$expected_source" ]]; then
  usage
fi

config_json="$(crane config "$image_ref")"
resolved_digest="$(crane digest "$image_ref")"

revision="$(jq -r '.config.Labels["org.opencontainers.image.revision"] // empty' <<<"$config_json")"
version="$(jq -r '.config.Labels["org.opencontainers.image.version"] // empty' <<<"$config_json")"
source="$(jq -r '.config.Labels["org.opencontainers.image.source"] // empty' <<<"$config_json")"

if [[ "$revision" != "$expected_revision" ]]; then
  echo "Candidate revision mismatch: expected $expected_revision, got $revision" >&2
  exit 1
fi

if [[ "$version" != "$expected_version" ]]; then
  echo "Candidate version mismatch: expected $expected_version, got $version" >&2
  exit 1
fi

if [[ "$source" != "$expected_source" ]]; then
  echo "Candidate source mismatch: expected $expected_source, got $source" >&2
  exit 1
fi

echo "resolved_digest=$resolved_digest" >> "$GITHUB_OUTPUT"
