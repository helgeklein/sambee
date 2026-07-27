#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: ensure_candidate_signature.sh \
  --image-ref <repository@sha256:digest> \
  --signature-repository <repository> \
  --github-repository <owner/repo>
EOF
  exit 1
}

image_ref=""
signature_repository=""
github_repository=""

readonly SIGNATURE_VERIFY_ATTEMPTS="${SIGNATURE_VERIFY_ATTEMPTS:-6}"
readonly SIGNATURE_VERIFY_RETRY_DELAY_SECONDS="${SIGNATURE_VERIFY_RETRY_DELAY_SECONDS:-2}"
readonly SIGNATURE_STORAGE_MODE="legacy"
readonly SIGNATURE_NEW_BUNDLE_FORMAT="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-ref) image_ref="$2"; shift 2 ;;
    --signature-repository) signature_repository="$2"; shift 2 ;;
    --github-repository) github_repository="$2"; shift 2 ;;
    *) usage ;;
  esac
done

if [[ -z "$image_ref" || -z "$signature_repository" || -z "$github_repository" || "$image_ref" != *@sha256:* ]]; then
  usage
fi

if ! [[ "$SIGNATURE_VERIFY_ATTEMPTS" =~ ^[1-9][0-9]*$ && "$SIGNATURE_VERIFY_RETRY_DELAY_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "Signature verification retry configuration must use positive attempts and a non-negative whole-second delay." >&2
  usage
fi

expected_identity="https://github.com/$github_repository/.github/workflows/docker-image-preview-publish.yml@refs/heads/main"

verify_signature() {
  COSIGN_REPOSITORY="$signature_repository" cosign verify \
    --certificate-identity "$expected_identity" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    --new-bundle-format "$SIGNATURE_NEW_BUNDLE_FORMAT" \
    "$image_ref" >/dev/null
}

verify_signature_after_signing() {
  local attempt
  for ((attempt = 1; attempt <= SIGNATURE_VERIFY_ATTEMPTS; attempt++)); do
    if verify_signature; then
      return 0
    fi
    if (( attempt < SIGNATURE_VERIFY_ATTEMPTS )); then
      echo "Candidate signature is not visible yet; retrying verification ($attempt/$SIGNATURE_VERIFY_ATTEMPTS)." >&2
      sleep "$SIGNATURE_VERIFY_RETRY_DELAY_SECONDS"
    fi
  done
  return 1
}

if verify_signature; then
  echo "Reused verified candidate signature for $image_ref"
  exit 0
fi

is_missing_signature_error() {
  grep -Eiq 'no signatures (found|associated)' "$1"
}

signature_output="$(mktemp)"
signature_error="$(mktemp)"
trap 'rm -f "$signature_output" "$signature_error"' EXIT

if ! COSIGN_REPOSITORY="$signature_repository" cosign download signature "$image_ref" >"$signature_output" 2>"$signature_error"; then
  if is_missing_signature_error "$signature_error"; then
    : >"$signature_output"
  else
    echo "Unable to inspect existing signatures for $image_ref; refusing to sign." >&2
    cat "$signature_error" >&2
    exit 1
  fi
fi

if [[ -s "$signature_output" ]]; then
  echo "Existing signatures for $image_ref do not satisfy the required GitHub Actions identity policy; refusing to add another signature." >&2
  exit 1
fi

COSIGN_REPOSITORY="$signature_repository" cosign sign \
  --new-bundle-format "$SIGNATURE_NEW_BUNDLE_FORMAT" \
  --registry-referrers-mode "$SIGNATURE_STORAGE_MODE" \
  --yes "$image_ref"

if ! verify_signature_after_signing; then
  echo "Candidate signature for $image_ref did not satisfy the required GitHub Actions identity policy after $SIGNATURE_VERIFY_ATTEMPTS verification attempts." >&2
  exit 1
fi

echo "Published and verified candidate signature for $image_ref"
