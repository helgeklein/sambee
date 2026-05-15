#!/usr/bin/env bash

set -euo pipefail

INSTALL_DIR="${1:-$HOME/.local/bin}"
SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TOOL_MANIFEST="$SCRIPT_DIR/../tools/crane/go.mod"
TOOL_MANIFEST_DIR="$(dirname "$TOOL_MANIFEST")"

if ! command -v go >/dev/null 2>&1; then
	echo "Go is required to install crane. Run this script from a workflow that sets up Go first." >&2
	exit 1
fi

if [[ ! -f "$TOOL_MANIFEST" ]]; then
	echo "Crane tool manifest not found: $TOOL_MANIFEST" >&2
	exit 1
fi

CRANE_VERSION="$(
	cd "$TOOL_MANIFEST_DIR"
	GOWORK=off go list -m -f '{{if eq .Path "github.com/google/go-containerregistry"}}{{.Version}}{{end}}' all | grep -E '^[^[:space:]]+$' | tail -n 1
)"

if [[ -z "$CRANE_VERSION" ]]; then
	echo "Failed to resolve the pinned crane version from $TOOL_MANIFEST" >&2
	exit 1
fi

mkdir -p "$INSTALL_DIR"

GOWORK=off GOBIN="$INSTALL_DIR" go install "github.com/google/go-containerregistry/cmd/crane@${CRANE_VERSION}"

resolved_version="$("$INSTALL_DIR/crane" version)"
if [[ "$resolved_version" != "${CRANE_VERSION#v}" ]]; then
	echo "Installed crane version mismatch: expected ${CRANE_VERSION#v}, got $resolved_version" >&2
	exit 1
fi

echo "$INSTALL_DIR"
