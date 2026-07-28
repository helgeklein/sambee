#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF' >&2
Usage: promote_staged_container_image.sh \
  --source-image <repository> --source-digest <sha256:...> \
  --target-image <repository> --target-tag <immutable-tag>
EOF
  exit 1
}

source_image=""
source_digest=""
target_image=""
target_tag=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-image) source_image="$2"; shift 2 ;;
    --source-digest) source_digest="$2"; shift 2 ;;
    --target-image) target_image="$2"; shift 2 ;;
    --target-tag) target_tag="$2"; shift 2 ;;
    *) usage ;;
  esac
done

if [[ -z "$source_image" || -z "$source_digest" || -z "$target_image" || -z "$target_tag" ]]; then
  usage
fi

if ! [[ "$source_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Source digest must be a sha256 digest: $source_digest" >&2
  exit 1
fi

source_ref="$source_image@$source_digest"
target_ref="$target_image:$target_tag"
resolved_source_digest="$(crane digest "$source_ref")"
if [[ "$resolved_source_digest" != "$source_digest" ]]; then
  echo "Staging source digest mismatch: expected $source_digest, resolved $resolved_source_digest" >&2
  exit 1
fi

if resolved_target_digest="$(crane digest "$target_ref" 2>/dev/null)"; then
  if [[ "$resolved_target_digest" != "$source_digest" ]]; then
    echo "Immutable final marker conflict for $target_ref: expected $source_digest, resolved $resolved_target_digest" >&2
    exit 1
  fi
else
  crane cp --no-clobber "$source_ref" "$target_ref"
fi

resolved_target_digest="$(crane digest "$target_ref")"
if [[ "$resolved_target_digest" != "$source_digest" ]]; then
  echo "Final marker digest mismatch for $target_ref: expected $source_digest, resolved $resolved_target_digest" >&2
  exit 1
fi

normalize_runnable_descriptors() {
  python3 -c '
import json
import sys

manifest = json.load(sys.stdin)
descriptors = []
for descriptor in manifest.get("manifests", []):
    platform = descriptor.get("platform") or {}
    if platform.get("os") in (None, "unknown"):
        continue
    if platform.get("architecture") in (None, "unknown"):
        continue
    descriptors.append(
        {
            "digest": descriptor.get("digest"),
            "mediaType": descriptor.get("mediaType"),
            "platform": platform,
        }
    )

print(json.dumps(sorted(descriptors, key=lambda descriptor: descriptor["digest"]), separators=(",", ":"), sort_keys=True))
'
}

source_descriptors="$(crane manifest "$source_ref" | normalize_runnable_descriptors)"
target_descriptors="$(crane manifest "$target_image@$source_digest" | normalize_runnable_descriptors)"
if [[ "$source_descriptors" != "$target_descriptors" ]]; then
  echo "Final marker platform descriptors differ from the verified staging index." >&2
  exit 1
fi
