#!/usr/bin/env bash

set -euo pipefail

readonly ATTESTATION_REFERENCE_TYPE="attestation-manifest"
readonly OCI_ARTIFACT_ATTESTATION_TYPE="application/vnd.docker.attestation.manifest.v1+json"
readonly SBOM_PREDICATE_TYPE="https://spdx.dev/Document"
readonly PROVENANCE_PREDICATE_PREFIX="https://slsa.dev/provenance/"

usage() {
  cat <<'EOF' >&2
Usage: verify_candidate_attestations.sh --image-ref <repo@sha256:...>
EOF
  exit 1
}

image_ref=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-ref)
      image_ref="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

if [[ -z "$image_ref" || "$image_ref" != *@sha256:* ]]; then
  usage
fi

image_name="${image_ref%@*}"
index_manifest_json="$(crane manifest "$image_ref")"

mapfile -t oci_attestation_descriptor_digests < <(
  jq -r '
    .manifests[]
    | select(
        (.platform.os // "") == "unknown"
        and (.platform.architecture // "") == "unknown"
      )
    | .digest
  ' <<<"$index_manifest_json"
)

mapfile -t runnable_manifest_digests < <(
  jq -r --arg reference_type "$ATTESTATION_REFERENCE_TYPE" '
    .manifests[]
    | select(
        (.annotations["vnd.docker.reference.type"] // "") != $reference_type
        and (.platform.os // "") != "unknown"
        and (.platform.architecture // "") != "unknown"
      )
    | .digest
  ' <<<"$index_manifest_json"
)

if [[ ${#runnable_manifest_digests[@]} -eq 0 ]]; then
  echo "Candidate image index does not contain any runnable platform manifests: $image_ref" >&2
  exit 1
fi

for manifest_digest in "${runnable_manifest_digests[@]}"; do
  mapfile -t attestation_manifest_digests < <(
    jq -r --arg manifest_digest "$manifest_digest" --arg reference_type "$ATTESTATION_REFERENCE_TYPE" '
      .manifests[]
      | select((.annotations["vnd.docker.reference.type"] // "") == $reference_type)
      | select((.annotations["vnd.docker.reference.digest"] // "") == $manifest_digest)
      | .digest
    ' <<<"$index_manifest_json"
  )

  for attestation_descriptor_digest in "${oci_attestation_descriptor_digests[@]}"; do
    attestation_manifest_ref="${image_name}@${attestation_descriptor_digest}"
    attestation_manifest_json="$(crane manifest "$attestation_manifest_ref")"

    linked_manifest_digest="$({
      jq -r '
        if (.artifactType // "") == "application/vnd.docker.attestation.manifest.v1+json" then
          .subject.digest // empty
        else
          empty
        end
      ' <<<"$attestation_manifest_json"
    } || true)"

    if [[ "$linked_manifest_digest" == "$manifest_digest" ]]; then
      if [[ ! " ${attestation_manifest_digests[*]} " =~ " ${attestation_descriptor_digest} " ]]; then
        attestation_manifest_digests+=("$attestation_descriptor_digest")
      fi
    fi
  done

  if [[ ${#attestation_manifest_digests[@]} -eq 0 ]]; then
    echo "No attestation manifests found for runnable platform manifest $manifest_digest in $image_ref" >&2
    exit 1
  fi

  found_sbom=false
  found_provenance=false

  for attestation_manifest_digest in "${attestation_manifest_digests[@]}"; do
    attestation_manifest_ref="${image_name}@${attestation_manifest_digest}"
    attestation_manifest_json="$(crane manifest "$attestation_manifest_ref")"

    while IFS=$'\t' read -r layer_digest predicate_type_annotation; do
      if [[ -z "$layer_digest" ]]; then
        continue
      fi

      attestation_blob_json="$(crane blob "$attestation_manifest_ref" "$layer_digest")"

      predicate_type="$predicate_type_annotation"
      if [[ -z "$predicate_type" ]]; then
        predicate_type="$(jq -r '.predicateType // empty' <<<"$attestation_blob_json")"
      fi

      if [[ -z "$predicate_type" ]]; then
        continue
      fi

      jq -e --arg manifest_digest "${manifest_digest#sha256:}" '
        any(.subject[]?; (.digest.sha256 // "") == $manifest_digest)
      ' <<<"$attestation_blob_json" >/dev/null

      case "$predicate_type" in
        "$SBOM_PREDICATE_TYPE")
          found_sbom=true
          ;;
        ${PROVENANCE_PREDICATE_PREFIX}*)
          found_provenance=true
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

  if [[ "$found_provenance" != true ]]; then
    echo "No provenance attestation found for runnable platform manifest $manifest_digest in $image_ref" >&2
    exit 1
  fi

  if [[ "$found_sbom" != true ]]; then
    echo "No SBOM attestation found for runnable platform manifest $manifest_digest in $image_ref" >&2
    exit 1
  fi
done
