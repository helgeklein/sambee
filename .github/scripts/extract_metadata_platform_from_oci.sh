#!/usr/bin/env bash

set -euo pipefail

readonly SBOM_PREDICATE_TYPE="https://spdx.dev/Document"
readonly PROVENANCE_PREDICATE_PREFIX="https://slsa.dev/provenance/"

usage() {
  cat <<'EOF' >&2
Usage: extract_metadata_platform_from_oci.sh \
  --oci-layout <directory> \
  --image-ref <repo@sha256:...> \
  --platform <linux/amd64|linux/arm64> \
  --output-dir <directory>
EOF
  exit 1
}

oci_layout=""
image_ref=""
platform=""
output_dir=""

fail() {
  echo "$1" >&2
  exit 1
}

platform_to_id() {
  case "$1" in
    linux/amd64)
      printf 'linux-amd64\n'
      ;;
    linux/arm64)
      printf 'linux-arm64\n'
      ;;
    *)
      fail "Unsupported platform: $1"
      ;;
  esac
}

platform_to_sbom_path() {
  printf 'sbom/%s.spdx.json\n' "$(platform_to_id "$1")"
}

read_oci_blob_json() {
  local digest="$1"
  local blob_path="$oci_layout/blobs/sha256/${digest#sha256:}"

  if [[ ! -f "$blob_path" ]]; then
    fail "OCI layout blob not found for digest $digest"
  fi

  cat "$blob_path"
}

load_layout_index_json() {
  local top_level_index_json
  local root_digest
  local root_json

  if [[ ! -f "$oci_layout/index.json" ]]; then
    fail "OCI layout index.json not found: $oci_layout/index.json"
  fi

  top_level_index_json="$(cat "$oci_layout/index.json")"

  if jq -e '.manifests[]? | select(.platform != null)' <<<"$top_level_index_json" >/dev/null; then
    printf '%s\n' "$top_level_index_json"
    return
  fi

  root_digest="$(jq -r '.manifests[0].digest // empty' <<<"$top_level_index_json")"
  if [[ -z "$root_digest" ]]; then
    fail "OCI layout index.json does not contain a root manifest digest"
  fi

  root_json="$(read_oci_blob_json "$root_digest")"
  if ! jq -e '.manifests[]? | select(.platform != null)' <<<"$root_json" >/dev/null; then
    fail "Unable to resolve a runnable image index from OCI layout $oci_layout"
  fi

  printf '%s\n' "$root_json"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --oci-layout)
      oci_layout="$2"
      shift 2
      ;;
    --image-ref)
      image_ref="$2"
      shift 2
      ;;
    --platform)
      platform="$2"
      shift 2
      ;;
    --output-dir)
      output_dir="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

if [[ -z "$oci_layout" || -z "$image_ref" || -z "$platform" || -z "$output_dir" ]]; then
  usage
fi

if [[ "$image_ref" != *@sha256:* ]]; then
  fail "Image reference must use the form <repo>@sha256:..."
fi

platform_id="$(platform_to_id "$platform")"
sbom_path="$(platform_to_sbom_path "$platform")"
image_name="${image_ref%@*}"

mkdir -p "$output_dir/platforms" "$output_dir/provenance" "$output_dir/sbom"
sbom_output_path="$output_dir/$sbom_path"
provenance_output_path="$output_dir/provenance/$platform_id.intoto.jsonl"
: > "$provenance_output_path"

remote_index_json="$(crane manifest "$image_ref")"
local_index_json="$(load_layout_index_json)"

remote_manifest_digest="$(jq -r --arg platform "$platform" '
  .manifests[]
  | select(((.platform.os // "") + "/" + (.platform.architecture // "")) == $platform)
  | .digest
' <<<"$remote_index_json")"

if [[ -z "$remote_manifest_digest" ]]; then
  fail "Pushed image index does not contain platform $platform: $image_ref"
fi

mapfile -t local_manifest_digests < <(
  jq -r --arg platform "$platform" '
    .manifests[]
    | select(((.platform.os // "") + "/" + (.platform.architecture // "")) == $platform)
    | .digest
  ' <<<"$local_index_json"
)

if [[ ${#local_manifest_digests[@]} -ne 1 ]]; then
  fail "Expected exactly one local runnable manifest for $platform in $oci_layout, got ${#local_manifest_digests[@]}"
fi

local_manifest_digest="${local_manifest_digests[0]}"

mapfile -t attestation_manifest_digests < <(
  jq -r --arg manifest_digest "$local_manifest_digest" '
    .manifests[]
    | select((.annotations["vnd.docker.reference.type"] // "") == "attestation-manifest")
    | select((.annotations["vnd.docker.reference.digest"] // "") == $manifest_digest)
    | .digest
  ' <<<"$local_index_json"
)

mapfile -t subject_linked_attestation_digests < <(
  jq -r '
    .manifests[]
    | select((.platform.os // "") == "unknown")
    | select((.platform.architecture // "") == "unknown")
    | .digest
  ' <<<"$local_index_json"
)

for attestation_descriptor_digest in "${subject_linked_attestation_digests[@]}"; do
  attestation_manifest_json="$(read_oci_blob_json "$attestation_descriptor_digest")"
  linked_manifest_digest="$(jq -r '
    if (.artifactType // "") == "application/vnd.docker.attestation.manifest.v1+json" then
      .subject.digest // empty
    else
      empty
    end
  ' <<<"$attestation_manifest_json")"

  if [[ "$linked_manifest_digest" == "$local_manifest_digest" ]]; then
    if [[ ! " ${attestation_manifest_digests[*]} " =~ " ${attestation_descriptor_digest} " ]]; then
      attestation_manifest_digests+=("$attestation_descriptor_digest")
    fi
  fi
done

if [[ ${#attestation_manifest_digests[@]} -eq 0 ]]; then
  fail "No attestation manifests found for platform $platform in OCI layout $oci_layout"
fi

sbom_count=0
provenance_count=0

for attestation_manifest_digest in "${attestation_manifest_digests[@]}"; do
  attestation_manifest_json="$(read_oci_blob_json "$attestation_manifest_digest")"

  while IFS=$'\t' read -r layer_digest predicate_type_annotation; do
    [[ -n "$layer_digest" ]] || continue

    attestation_blob_json="$(read_oci_blob_json "$layer_digest")"
    predicate_type="$predicate_type_annotation"
    if [[ -z "$predicate_type" ]]; then
      predicate_type="$(jq -r '.predicateType // empty' <<<"$attestation_blob_json")"
    fi

    if [[ -z "$predicate_type" ]]; then
      continue
    fi

    case "$predicate_type" in
      "$SBOM_PREDICATE_TYPE")
        sbom_count=$((sbom_count + 1))
        if [[ "$sbom_count" -gt 1 ]]; then
          fail "Multiple SBOM attestations found for platform $platform in OCI layout $oci_layout"
        fi
        jq -e '(.predicate.spdxVersion // "") | startswith("SPDX-")' <<<"$attestation_blob_json" >/dev/null || fail "SBOM attestation for platform $platform does not contain an SPDX JSON predicate"
        jq '.predicate' <<<"$attestation_blob_json" > "$sbom_output_path"
        ;;
      ${PROVENANCE_PREDICATE_PREFIX}*)
        provenance_count=$((provenance_count + 1))
        jq -c \
          --arg remote_manifest_digest "${remote_manifest_digest#sha256:}" \
          --arg subject_name "$image_name@$remote_manifest_digest" \
          '
            .subject = (
              if ((.subject // []) | length) > 0 then
                [
                  .subject[]?
                  | if type == "object" then
                      .digest.sha256 = $remote_manifest_digest
                    else
                      {name: tostring, digest: {sha256: $remote_manifest_digest}}
                    end
                ]
              else
                [{name: $subject_name, digest: {sha256: $remote_manifest_digest}}]
              end
            )
          ' <<<"$attestation_blob_json" >> "$provenance_output_path"
        ;;
    esac
  done < <(
    jq -r '
      .layers[]
      | select(.mediaType == "application/vnd.in-toto+json")
      | [
          .digest,
          (.annotations["in-toto.io/predicate-type"] // "")
        ]
      | @tsv
    ' <<<"$attestation_manifest_json"
  )
done

if [[ "$sbom_count" -ne 1 ]]; then
  fail "Expected exactly one SBOM attestation for platform $platform in OCI layout $oci_layout"
fi

if [[ "$provenance_count" -lt 1 ]]; then
  fail "Expected at least one provenance attestation for platform $platform in OCI layout $oci_layout"
fi

jq -n \
  --arg platform "$platform" \
  --arg manifest_digest "$remote_manifest_digest" \
  --arg sbom_path "$sbom_path" \
  --arg provenance_path "provenance/$platform_id.intoto.jsonl" \
  '{platform: $platform, manifest_digest: $manifest_digest, sbom_path: $sbom_path, provenance_path: $provenance_path}' \
  > "$output_dir/platforms/$platform_id.json"
