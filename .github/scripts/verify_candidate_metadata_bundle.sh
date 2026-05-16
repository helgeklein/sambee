#!/usr/bin/env bash

set -euo pipefail

readonly SBOM_PREDICATE_TYPE="https://spdx.dev/Document"
readonly PROVENANCE_PREDICATE_PREFIX="https://slsa.dev/provenance/"
readonly BUNDLE_TYPE="sambee.image-metadata"

usage() {
  cat <<'EOF' >&2
Usage: verify_candidate_metadata_bundle.sh \
  --image-ref <repo@sha256:...> \
  --metadata-repository <repo> \
  --expected-version <version> \
  --expected-revision <git-sha> \
  --expected-source <https://...>
EOF
  exit 1
}

image_ref=""
metadata_repository=""
expected_version=""
expected_revision=""
expected_source=""

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  echo "$1" >&2
  exit 1
}

require_match() {
  local actual="$1"
  local expected="$2"
  local label="$3"

  if [[ "$actual" != "$expected" ]]; then
    fail "$label mismatch: expected $expected, got $actual"
  fi
}

platform_to_sbom_path() {
  case "$1" in
    linux/amd64)
      printf 'sbom/linux-amd64.spdx.json\n'
      ;;
    linux/arm64)
      printf 'sbom/linux-arm64.spdx.json\n'
      ;;
    *)
      fail "Unsupported platform in candidate image index: $1"
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-ref)
      image_ref="$2"
      shift 2
      ;;
    --metadata-repository)
      metadata_repository="$2"
      shift 2
      ;;
    --expected-version)
      expected_version="$2"
      shift 2
      ;;
    --expected-revision)
      expected_revision="$2"
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

if [[ -z "$image_ref" || -z "$metadata_repository" || -z "$expected_version" || -z "$expected_revision" || -z "$expected_source" ]]; then
  usage
fi

if [[ "$image_ref" != *@sha256:* ]]; then
  fail "Image reference must use the form <repo>@sha256:..."
fi

image_name="${image_ref%@*}"
image_digest="${image_ref#*@}"
metadata_tag="$(bash "$script_dir/metadata_bundle_tag.sh" --image-digest "$image_digest")"
bundle_ref="${metadata_repository}:${metadata_tag}"

bundle_dir="$(mktemp -d)"
trap 'rm -rf "$bundle_dir"' EXIT

oras pull "$bundle_ref" --output "$bundle_dir" >/dev/null

metadata_path="$bundle_dir/metadata.json"
provenance_path="$bundle_dir/provenance/intoto.jsonl"
amd64_sbom_path="$bundle_dir/sbom/linux-amd64.spdx.json"
arm64_sbom_path="$bundle_dir/sbom/linux-arm64.spdx.json"

for required_path in "$metadata_path" "$provenance_path" "$amd64_sbom_path" "$arm64_sbom_path"; do
  if [[ ! -f "$required_path" ]]; then
    fail "Metadata bundle is missing required file: ${required_path#$bundle_dir/}"
  fi
done

metadata_json="$(cat "$metadata_path")"

jq -e '.schema_version == 1' <<<"$metadata_json" >/dev/null || fail "metadata.json schema_version must equal 1"

bundle_type="$(jq -r '.bundle_type // empty' <<<"$metadata_json")"
require_match "$bundle_type" "$BUNDLE_TYPE" "Bundle type"
require_match "$(jq -r '.image_repository // empty' <<<"$metadata_json")" "$image_name" "Image repository"
require_match "$(jq -r '.image_digest // empty' <<<"$metadata_json")" "$image_digest" "Image digest"
require_match "$(jq -r '.metadata_repository // empty' <<<"$metadata_json")" "$metadata_repository" "Metadata repository"
require_match "$(jq -r '.metadata_tag // empty' <<<"$metadata_json")" "$metadata_tag" "Metadata tag"
require_match "$(jq -r '.version // empty' <<<"$metadata_json")" "$expected_version" "Version"
require_match "$(jq -r '.revision // empty' <<<"$metadata_json")" "$expected_revision" "Revision"
require_match "$(jq -r '.source_url // empty' <<<"$metadata_json")" "$expected_source" "Source URL"
require_match "$(jq -r '.provenance.path // empty' <<<"$metadata_json")" "provenance/intoto.jsonl" "Provenance path"
require_match "$(jq -r '.provenance.predicate_type_prefix // empty' <<<"$metadata_json")" "$PROVENANCE_PREDICATE_PREFIX" "Provenance predicate prefix"

declare -A expected_manifest_by_platform=()
declare -A expected_sbom_path_by_platform=()
declare -A seen_provenance_by_digest=()

while IFS=$'\t' read -r platform digest; do
  [[ -n "$platform" ]] || continue
  expected_manifest_by_platform["$platform"]="$digest"
  expected_sbom_path_by_platform["$platform"]="$(platform_to_sbom_path "$platform")"
done < <(
  crane manifest "$image_ref" | jq -r '
    .manifests[]
    | select((.platform.os // "") != "unknown")
    | select((.platform.architecture // "") != "unknown")
    | [(.platform.os + "/" + .platform.architecture), .digest]
    | @tsv
  '
)

if [[ ${#expected_manifest_by_platform[@]} -eq 0 ]]; then
  fail "Candidate image index does not contain any runnable platform manifests: $image_ref"
fi

declare -A metadata_manifest_by_platform=()
while IFS=$'\t' read -r platform digest sbom_path; do
  [[ -n "$platform" ]] || continue
  if [[ -n "${metadata_manifest_by_platform[$platform]:-}" ]]; then
    fail "metadata.json contains duplicate platform entry: $platform"
  fi
  metadata_manifest_by_platform["$platform"]="$digest"

  expected_sbom_path="${expected_sbom_path_by_platform[$platform]:-}"
  if [[ -z "$expected_sbom_path" ]]; then
    fail "metadata.json contains unexpected platform entry: $platform"
  fi

  require_match "$sbom_path" "$expected_sbom_path" "SBOM path for $platform"
done < <(
  jq -r '.platforms[] | [.platform, .manifest_digest, .sbom_path] | @tsv' <<<"$metadata_json"
)

if [[ ${#metadata_manifest_by_platform[@]} -ne ${#expected_manifest_by_platform[@]} ]]; then
  fail "metadata.json platform entries do not match the runnable platforms in $image_ref"
fi

for platform in "${!expected_manifest_by_platform[@]}"; do
  if [[ -z "${metadata_manifest_by_platform[$platform]:-}" ]]; then
    fail "metadata.json is missing platform entry $platform"
  fi

  require_match "${metadata_manifest_by_platform[$platform]}" "${expected_manifest_by_platform[$platform]}" "Manifest digest for $platform"
done

while IFS=$'\t' read -r relative_path expected_checksum; do
  [[ -n "$relative_path" ]] || continue
  absolute_path="$bundle_dir/$relative_path"

  if [[ ! -f "$absolute_path" ]]; then
    fail "Checksum entry references missing bundle file: $relative_path"
  fi

  actual_checksum="sha256:$(sha256sum "$absolute_path" | awk '{print $1}')"
  require_match "$actual_checksum" "$expected_checksum" "Checksum for $relative_path"
done < <(
  jq -r '.checksums | to_entries[] | [.key, .value] | @tsv' <<<"$metadata_json"
)

for sbom_path in "$amd64_sbom_path" "$arm64_sbom_path"; do
  jq -e '(.spdxVersion // "") | startswith("SPDX-")' "$sbom_path" >/dev/null || fail "SBOM file is not valid SPDX JSON: ${sbom_path#$bundle_dir/}"
done

while IFS= read -r statement_line || [[ -n "$statement_line" ]]; do
  [[ -n "$statement_line" ]] || continue

  statement_json="$(jq -c '.' <<<"$statement_line")"
  predicate_type="$(jq -r '.predicateType // empty' <<<"$statement_json")"
  if [[ "$predicate_type" != ${PROVENANCE_PREDICATE_PREFIX}* ]]; then
    fail "Unexpected provenance predicate type in provenance/intoto.jsonl: $predicate_type"
  fi

  mapfile -t subject_digests < <(jq -r '.subject[]?.digest.sha256 // empty' <<<"$statement_json")
  if [[ ${#subject_digests[@]} -eq 0 ]]; then
    fail "Provenance statement is missing subject digests"
  fi

  for subject_digest_suffix in "${subject_digests[@]}"; do
    full_digest="sha256:${subject_digest_suffix}"
    matching_platform=""

    for platform in "${!expected_manifest_by_platform[@]}"; do
      if [[ "${expected_manifest_by_platform[$platform]}" == "$full_digest" ]]; then
        matching_platform="$platform"
        seen_provenance_by_digest["$full_digest"]=true
        break
      fi
    done

    if [[ -z "$matching_platform" ]]; then
      fail "Provenance statement references an unexpected subject digest: $full_digest"
    fi
  done
done < "$provenance_path"

for platform in "${!expected_manifest_by_platform[@]}"; do
  digest="${expected_manifest_by_platform[$platform]}"
  if [[ "${seen_provenance_by_digest[$digest]:-false}" != true ]]; then
    fail "No provenance statement found for platform $platform in provenance/intoto.jsonl"
  fi
done
