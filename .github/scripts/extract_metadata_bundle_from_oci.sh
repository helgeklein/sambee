#!/usr/bin/env bash

set -euo pipefail

readonly SBOM_PREDICATE_TYPE="https://spdx.dev/Document"
readonly PROVENANCE_PREDICATE_PREFIX="https://slsa.dev/provenance/"
readonly OCI_ARTIFACT_ATTESTATION_TYPE="application/vnd.docker.attestation.manifest.v1+json"
readonly OCI_INDEX_MEDIA_TYPES_REGEX='application/vnd\.(docker\.distribution\.manifest\.list|oci\.image\.index)\.v1\+json'

usage() {
  cat <<'EOF' >&2
Usage: extract_metadata_bundle_from_oci.sh \
  --oci-layout <directory> \
  --image-ref <repo@sha256:...> \
  --metadata-repository <repo> \
  --version <version> \
  --revision <git-sha> \
  --source-url <https://...> \
  --output-dir <directory>
EOF
  exit 1
}

oci_layout=""
image_ref=""
metadata_repository=""
version=""
revision=""
source_url=""
output_dir=""

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  echo "$1" >&2
  exit 1
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

platform_to_sbom_path() {
  case "$1" in
    linux/amd64)
      printf 'sbom/linux-amd64.spdx.json\n'
      ;;
    linux/arm64)
      printf 'sbom/linux-arm64.spdx.json\n'
      ;;
    *)
      fail "Unsupported platform for SBOM path mapping: $1"
      ;;
  esac
}

image_config_fingerprint() {
  jq -c '{
    architecture,
    os,
    config: {
      Env: .config.Env,
      Entrypoint: .config.Entrypoint,
      Cmd: .config.Cmd,
      WorkingDir: .config.WorkingDir,
      User: .config.User,
      ExposedPorts: .config.ExposedPorts,
      Volumes: .config.Volumes,
      Labels: .config.Labels
    },
    rootfs: .rootfs.diff_ids
  }'
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
    --metadata-repository)
      metadata_repository="$2"
      shift 2
      ;;
    --version)
      version="$2"
      shift 2
      ;;
    --revision)
      revision="$2"
      shift 2
      ;;
    --source-url)
      source_url="$2"
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

if [[ -z "$oci_layout" || -z "$image_ref" || -z "$metadata_repository" || -z "$version" || -z "$revision" || -z "$source_url" || -z "$output_dir" ]]; then
  usage
fi

if [[ "$image_ref" != *@sha256:* ]]; then
  fail "Image reference must use the form <repo>@sha256:..."
fi

image_name="${image_ref%@*}"
image_digest="${image_ref#*@}"
metadata_tag="$(bash "$script_dir/metadata_bundle_tag.sh" --image-digest "$image_digest")"

mkdir -p "$output_dir/provenance" "$output_dir/sbom"
provenance_path="$output_dir/provenance/intoto.jsonl"
: > "$provenance_path"

remote_index_json="$(crane manifest "$image_ref")"
local_index_json="$(load_layout_index_json)"

declare -A remote_digest_by_platform=()
declare -A local_digest_by_platform=()
declare -A remote_sbom_path_by_platform=()
declare -A platform_has_provenance=()

while IFS=$'\t' read -r platform digest; do
  [[ -n "$platform" ]] || continue
  remote_digest_by_platform["$platform"]="$digest"
  remote_sbom_path_by_platform["$platform"]="$(platform_to_sbom_path "$platform")"
done < <(
  jq -r '
    .manifests[]
    | select((.platform.os // "") != "unknown")
    | select((.platform.architecture // "") != "unknown")
    | [(.platform.os + "/" + .platform.architecture), .digest]
    | @tsv
  ' <<<"$remote_index_json"
)

while IFS=$'\t' read -r platform digest; do
  [[ -n "$platform" ]] || continue
  local_digest_by_platform["$platform"]="$digest"
done < <(
  jq -r '
    .manifests[]
    | select((.platform.os // "") != "unknown")
    | select((.platform.architecture // "") != "unknown")
    | [(.platform.os + "/" + .platform.architecture), .digest]
    | @tsv
  ' <<<"$local_index_json"
)

if [[ ${#remote_digest_by_platform[@]} -eq 0 ]]; then
  fail "Pushed image index does not contain any runnable platform manifests: $image_ref"
fi

if [[ ${#remote_digest_by_platform[@]} -ne ${#local_digest_by_platform[@]} ]]; then
  fail "OCI layout platform set does not match the pushed image index for $image_ref"
fi

for platform in "${!remote_digest_by_platform[@]}"; do
  if [[ -z "${local_digest_by_platform[$platform]:-}" ]]; then
    fail "OCI layout is missing runnable platform $platform for $image_ref"
  fi

  local_manifest_json="$(read_oci_blob_json "${local_digest_by_platform[$platform]}")"
  local_config_digest="$(jq -r '.config.digest // empty' <<<"$local_manifest_json")"
  if [[ -z "$local_config_digest" ]]; then
    fail "OCI layout platform manifest for $platform is missing a config digest"
  fi

  local_config_json="$(read_oci_blob_json "$local_config_digest")"
  remote_config_json="$(crane config "$image_name@${remote_digest_by_platform[$platform]}")"
  local_payload_fingerprint="$(image_config_fingerprint <<<"$local_config_json")"
  remote_payload_fingerprint="$(image_config_fingerprint <<<"$remote_config_json")"

  if [[ "$local_payload_fingerprint" != "$remote_payload_fingerprint" ]]; then
    fail "Local OCI layout runtime config for $platform does not match pushed image runtime config for $image_ref"
  fi
done

platforms_jsonl="$(mktemp)"
trap 'rm -f "$platforms_jsonl"' EXIT

mapfile -t sorted_platforms < <(printf '%s\n' "${!remote_digest_by_platform[@]}" | sort)

for platform in "${sorted_platforms[@]}"; do
  manifest_digest="${remote_digest_by_platform[$platform]}"
  local_manifest_digest="${local_digest_by_platform[$platform]}"
  sbom_path="${remote_sbom_path_by_platform[$platform]}"
  sbom_output_path="$output_dir/$sbom_path"
  mkdir -p "$(dirname "$sbom_output_path")"

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

      jq -e --arg manifest_digest "${local_manifest_digest#sha256:}" '
        any(.subject[]?; (.digest.sha256 // "") == $manifest_digest)
      ' <<<"$attestation_blob_json" >/dev/null

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
          platform_has_provenance["$platform"]=true
          jq -c \
            --arg local_manifest_digest "${local_manifest_digest#sha256:}" \
            --arg remote_manifest_digest "${manifest_digest#sha256:}" \
            '
              .subject = [
                .subject[]?
                | if (.digest.sha256 // "") == $local_manifest_digest then
                    .digest.sha256 = $remote_manifest_digest
                  else
                    .
                  end
              ]
            ' <<<"$attestation_blob_json" >> "$provenance_path"
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

  jq -cn \
    --arg platform "$platform" \
    --arg manifest_digest "$manifest_digest" \
    --arg sbom_path "$sbom_path" \
    '{platform: $platform, manifest_digest: $manifest_digest, sbom_path: $sbom_path}' >> "$platforms_jsonl"
done

checksums_json="$({
  printf 'provenance/intoto.jsonl\tsha256:%s\n' "$(sha256sum "$provenance_path" | awk '{print $1}')"
  for platform in "${sorted_platforms[@]}"; do
    sbom_path="${remote_sbom_path_by_platform[$platform]}"
    printf '%s\tsha256:%s\n' "$sbom_path" "$(sha256sum "$output_dir/$sbom_path" | awk '{print $1}')"
  done
} | jq -Rn '
  [inputs | split("\t") | {(.[0]): .[1]}] | add
')"

platforms_json="$(jq -cs '.' "$platforms_jsonl")"
created="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

jq -n \
  --arg image_repository "$image_name" \
  --arg image_digest "$image_digest" \
  --arg metadata_repository "$metadata_repository" \
  --arg metadata_tag "$metadata_tag" \
  --arg version "$version" \
  --arg revision "$revision" \
  --arg source_url "$source_url" \
  --arg created "$created" \
  --arg predicate_type_prefix "$PROVENANCE_PREDICATE_PREFIX" \
  --argjson platforms "$platforms_json" \
  --argjson checksums "$checksums_json" \
  '{
    schema_version: 1,
    bundle_type: "sambee.image-metadata",
    image_repository: $image_repository,
    image_digest: $image_digest,
    metadata_repository: $metadata_repository,
    metadata_tag: $metadata_tag,
    version: $version,
    revision: $revision,
    source_url: $source_url,
    created: $created,
    platforms: $platforms,
    provenance: {
      path: "provenance/intoto.jsonl",
      predicate_type_prefix: $predicate_type_prefix
    },
    checksums: $checksums
  }' > "$output_dir/metadata.json"
