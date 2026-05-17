#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: write_docker_image_metadata_outputs.sh \
  --created <rfc3339> \
  --description <text> \
  --ref-name <ref> \
  --revision <git-sha> \
  --source-url <url> \
  --title <text> \
  --version <version> \
  [--annotation-platform <linux/arch>] \
  [--image-name <repo>] \
  [--tag <tag>]
EOF
  exit 1
}

created=""
description=""
ref_name=""
revision=""
source_url=""
title=""
version=""
annotation_platform=""
image_name=""
tag=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --created)
      created="$2"
      shift 2
      ;;
    --description)
      description="$2"
      shift 2
      ;;
    --ref-name)
      ref_name="$2"
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
    --title)
      title="$2"
      shift 2
      ;;
    --version)
      version="$2"
      shift 2
      ;;
    --annotation-platform)
      annotation_platform="$2"
      shift 2
      ;;
    --image-name)
      image_name="$2"
      shift 2
      ;;
    --tag)
      tag="$2"
      shift 2
      ;;
    *)
      usage
      ;;
  esac
done

if [[ -z "$created" || -z "$description" || -z "$ref_name" || -z "$revision" || -z "$source_url" || -z "$title" || -z "$version" ]]; then
  usage
fi

if [[ -n "$tag" && -z "$image_name" ]]; then
  usage
fi

output_path="${GITHUB_OUTPUT:-}"
if [[ -z "$output_path" ]]; then
  echo "GITHUB_OUTPUT is not set" >&2
  exit 1
fi

metadata_entries=(
  "org.opencontainers.image.created=$created"
  "org.opencontainers.image.description=$description"
  "org.opencontainers.image.licenses=MIT"
  "org.opencontainers.image.ref.name=$ref_name"
  "org.opencontainers.image.revision=$revision"
  "org.opencontainers.image.source=$source_url"
  "org.opencontainers.image.title=$title"
  "org.opencontainers.image.url=$source_url"
  "org.opencontainers.image.version=$version"
)

annotation_scopes=(
  "index"
  "manifest"
  "manifest[linux/amd64]"
  "manifest[linux/arm64]"
)

if [[ -n "$annotation_platform" ]]; then
  annotation_scopes=(
    "manifest"
    "manifest[$annotation_platform]"
  )
fi

{
  if [[ -n "$tag" ]]; then
    echo 'tags<<EOF'
    echo "$image_name:$tag"
    echo 'EOF'
  fi

  echo 'labels<<EOF'
  printf '%s\n' "${metadata_entries[@]}"
  echo 'EOF'

  echo 'annotations<<EOF'
  for scope in "${annotation_scopes[@]}"; do
    for entry in "${metadata_entries[@]}"; do
      printf '%s:%s\n' "$scope" "$entry"
    done
  done
  echo 'EOF'
} >> "$output_path"
