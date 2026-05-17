#!/usr/bin/env bash

set -euo pipefail

readonly PROVENANCE_PREDICATE_PREFIX="https://slsa.dev/provenance/"

usage() {
  cat <<'EOF' >&2
Usage: assemble_metadata_bundle.sh \
  --input-dir <directory> \
  --image-ref <repo@sha256:...> \
  --metadata-repository <repo> \
  --version <version> \
  --revision <git-sha> \
  --source-url <https://...> \
  --output-dir <directory>
EOF
  exit 1
}

input_dir=""
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input-dir)
      input_dir="$2"
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

if [[ -z "$input_dir" || -z "$image_ref" || -z "$metadata_repository" || -z "$version" || -z "$revision" || -z "$source_url" || -z "$output_dir" ]]; then
  usage
fi

if [[ "$image_ref" != *@sha256:* ]]; then
  fail "Image reference must use the form <repo>@sha256:..."
fi

image_name="${image_ref%@*}"
image_digest="${image_ref#*@}"
metadata_tag="$(bash "$script_dir/metadata_bundle_tag.sh" --image-digest "$image_digest")"

platforms_dir="$input_dir/platforms"
if [[ ! -d "$platforms_dir" ]]; then
  fail "Platform metadata directory not found: $platforms_dir"
fi

mapfile -t platform_metadata_files < <(find "$platforms_dir" -type f -name '*.json' | sort)
if [[ ${#platform_metadata_files[@]} -eq 0 ]]; then
  fail "No platform metadata files found in $platforms_dir"
fi

remote_index_json="$(crane manifest "$image_ref")"

mkdir -p "$output_dir/provenance" "$output_dir/sbom"
provenance_path="$output_dir/provenance/intoto.jsonl"
: > "$provenance_path"

platforms_jsonl="$(mktemp)"
trap 'rm -f "$platforms_jsonl"' EXIT

for platform_metadata_file in "${platform_metadata_files[@]}"; do
  platform_json="$(cat "$platform_metadata_file")"
  platform="$(jq -r '.platform // empty' <<<"$platform_json")"
  manifest_digest="$(jq -r '.manifest_digest // empty' <<<"$platform_json")"
  sbom_path="$(jq -r '.sbom_path // empty' <<<"$platform_json")"
  platform_provenance_path="$(jq -r '.provenance_path // empty' <<<"$platform_json")"

  if [[ -z "$platform" || -z "$manifest_digest" || -z "$sbom_path" || -z "$platform_provenance_path" ]]; then
    fail "Platform metadata is incomplete: $platform_metadata_file"
  fi

  remote_manifest_digest="$(jq -r --arg platform "$platform" '
    .manifests[]
    | select(((.platform.os // "") + "/" + (.platform.architecture // "")) == $platform)
    | .digest
  ' <<<"$remote_index_json")"

  if [[ "$remote_manifest_digest" != "$manifest_digest" ]]; then
    fail "Platform $platform manifest digest mismatch: expected $remote_manifest_digest, got $manifest_digest"
  fi

  if [[ ! -f "$input_dir/$sbom_path" ]]; then
    fail "SBOM file referenced by platform metadata is missing: $input_dir/$sbom_path"
  fi

  if [[ ! -f "$input_dir/$platform_provenance_path" ]]; then
    fail "Provenance file referenced by platform metadata is missing: $input_dir/$platform_provenance_path"
  fi

  mkdir -p "$(dirname "$output_dir/$sbom_path")"
  cp "$input_dir/$sbom_path" "$output_dir/$sbom_path"
  cat "$input_dir/$platform_provenance_path" >> "$provenance_path"

  jq -cn \
    --arg platform "$platform" \
    --arg manifest_digest "$manifest_digest" \
    --arg sbom_path "$sbom_path" \
    '{platform: $platform, manifest_digest: $manifest_digest, sbom_path: $sbom_path}' >> "$platforms_jsonl"
done

remote_platform_count="$(jq '[.manifests[] | select((.platform.os // "") != "unknown") | select((.platform.architecture // "") != "unknown")] | length' <<<"$remote_index_json")"
if [[ "${#platform_metadata_files[@]}" -ne "$remote_platform_count" ]]; then
  fail "Platform metadata count ${#platform_metadata_files[@]} does not match pushed image platform count $remote_platform_count"
fi

checksums_json="$({
  printf 'provenance/intoto.jsonl\tsha256:%s\n' "$(sha256sum "$provenance_path" | awk '{print $1}')"
  while IFS= read -r sbom_path; do
    printf '%s\tsha256:%s\n' "$sbom_path" "$(sha256sum "$output_dir/$sbom_path" | awk '{print $1}')"
  done < <(jq -r '.sbom_path' "$platforms_jsonl" | sort)
} | jq -Rn '
  [inputs | split("\t") | {(.[0]): .[1]}] | add
')"

platforms_json="$(jq -cs 'sort_by(.platform)' "$platforms_jsonl")"
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
