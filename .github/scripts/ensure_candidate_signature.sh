#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: ensure_candidate_signature.sh --image-ref <repository@sha256:digest> --github-repository <owner/repo>
EOF
  exit 1
}

image_ref=""
github_repository=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-ref) image_ref="$2"; shift 2 ;;
    --github-repository) github_repository="$2"; shift 2 ;;
    *) usage ;;
  esac
done

if [[ -z "$image_ref" || -z "$github_repository" || "$image_ref" != *@sha256:* ]]; then
  usage
fi

expected_identity="https://github.com/$github_repository/.github/workflows/docker-image-preview-publish.yml@refs/heads/main"

verify_signature() {
  cosign verify \
    --certificate-identity "$expected_identity" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    "$image_ref" >/dev/null
}

if verify_signature; then
  echo "Reused verified candidate signature for $image_ref"
  exit 0
fi

signature_output="$(mktemp)"
signature_error="$(mktemp)"
trap 'rm -f "$signature_output" "$signature_error"' EXIT

if ! cosign download signature "$image_ref" >"$signature_output" 2>"$signature_error"; then
  echo "Unable to inspect existing signatures for $image_ref; refusing to sign." >&2
  cat "$signature_error" >&2
  exit 1
fi

if [[ -s "$signature_output" ]]; then
  echo "Existing signatures for $image_ref do not satisfy the required GitHub Actions identity policy; refusing to add another signature." >&2
  exit 1
fi

cosign sign --yes "$image_ref"

if ! verify_signature; then
  echo "Candidate signature for $image_ref did not satisfy the required GitHub Actions identity policy after signing." >&2
  exit 1
fi

echo "Published and verified candidate signature for $image_ref"
