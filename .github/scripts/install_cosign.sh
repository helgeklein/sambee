#!/usr/bin/env bash

set -euo pipefail

readonly COSIGN_VERSION="3.0.6"
readonly COSIGN_BASE_URL="https://github.com/sigstore/cosign/releases/download/v${COSIGN_VERSION}"

usage() {
  cat <<'EOF' >&2
Usage: install_cosign.sh [install-dir]
EOF
  exit 1
}

if [[ $# -gt 1 ]]; then
  usage
fi

install_dir="${1:-$HOME/.local/bin}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Cosign installation is only supported on Linux runners in this repository" >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64)
    filename="cosign-linux-amd64"
    checksum="c956e5dfcac53d52bcf058360d579472f0c1d2d9b69f55209e256fe7783f4c74"
    ;;
  aarch64|arm64)
    filename="cosign-linux-arm64"
    checksum="bedac92e8c3729864e13d4a17048007cfafa79d5deca993a43a90ffe018ef2b8"
    ;;
  *)
    echo "Unsupported architecture for Cosign installation: $(uname -m)" >&2
    exit 1
    ;;
esac

mkdir -p "$install_dir"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

# The release binary is authenticated by this pinned SHA-256 digest. The runner's
# TLS interceptor presents a self-signed certificate that curl cannot validate.
curl --insecure --fail --silent --show-error --location \
  "${COSIGN_BASE_URL}/${filename}" --output "$temp_dir/$filename"
printf '%s  %s\n' "$checksum" "$temp_dir/$filename" | sha256sum --check --status
install -m 0755 "$temp_dir/$filename" "$install_dir/cosign"

installed_version="$("$install_dir/cosign" version | awk -F': *' '/^GitVersion:/ {print $2}')"
if [[ "$installed_version" != "v$COSIGN_VERSION" ]]; then
  echo "Installed Cosign version mismatch: expected v$COSIGN_VERSION, got ${installed_version:-unknown}" >&2
  exit 1
fi

echo "$install_dir"
