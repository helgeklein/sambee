#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: verify_published_candidate_image.sh \
  --image-name <repository> --metadata-repository <repository> \
  [--candidate-digest <sha256:...>] \
  --expected-description <text> --expected-revision <sha> \
  --expected-version <version> --expected-source <url> --expected-title <text> \
  --expected-build-tag <build-vX.Y.Z> --github-repository <owner/repo>
EOF
  exit 1
}

image_name=""
metadata_repository=""
candidate_digest=""
expected_description=""
expected_revision=""
expected_version=""
expected_source=""
expected_title=""
expected_build_tag=""
github_repository=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-name) image_name="$2"; shift 2 ;;
    --metadata-repository) metadata_repository="$2"; shift 2 ;;
    --candidate-digest) candidate_digest="$2"; shift 2 ;;
    --expected-description) expected_description="$2"; shift 2 ;;
    --expected-revision) expected_revision="$2"; shift 2 ;;
    --expected-version) expected_version="$2"; shift 2 ;;
    --expected-source) expected_source="$2"; shift 2 ;;
    --expected-title) expected_title="$2"; shift 2 ;;
    --expected-build-tag) expected_build_tag="$2"; shift 2 ;;
    --github-repository) github_repository="$2"; shift 2 ;;
    *) usage ;;
  esac
done

if [[ -z "$image_name" || -z "$metadata_repository" || -z "$expected_description" || -z "$expected_revision" || -z "$expected_version" || -z "$expected_source" || -z "$expected_title" || -z "$expected_build_tag" || -z "$github_repository" ]]; then
  usage
fi

if [[ -n "$candidate_digest" ]]; then
  resolved_candidate_digest="$(crane digest "$image_name@$candidate_digest")"
  if [[ "$resolved_candidate_digest" != "$candidate_digest" ]]; then
    echo "Candidate digest mismatch: expected $candidate_digest, resolved $resolved_candidate_digest" >&2
    exit 1
  fi
else
  candidate_ref="$image_name:$expected_build_tag"
  candidate_digest="$(crane digest "$candidate_ref")"
fi
candidate_ref_by_digest="$image_name@$candidate_digest"

bash "$(dirname "${BASH_SOURCE[0]}")/verify_candidate_image.sh" \
  --image-ref "$candidate_ref_by_digest" \
  --expected-description "$expected_description" \
  --expected-revision "$expected_revision" \
  --expected-version "$expected_version" \
  --expected-source "$expected_source" \
  --expected-title "$expected_title" \
  --expected-build-tag "$expected_build_tag"

bash "$(dirname "${BASH_SOURCE[0]}")/verify_candidate_metadata_bundle.sh" \
  --image-ref "$candidate_ref_by_digest" \
  --metadata-repository "$metadata_repository" \
  --expected-version "$expected_version" \
  --expected-revision "$expected_revision" \
  --expected-source "$expected_source"

expected_identity="https://github.com/$github_repository/.github/workflows/docker-image-preview-publish.yml@refs/heads/main"
cosign verify \
  --certificate-identity "$expected_identity" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "$candidate_ref_by_digest" >/dev/null

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "resolved_digest=$candidate_digest" >> "$GITHUB_OUTPUT"
else
  printf '%s\n' "$candidate_digest"
fi
