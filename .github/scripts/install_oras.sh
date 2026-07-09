#!/usr/bin/env bash

set -euo pipefail

readonly ORAS_VERSION="1.3.2"
readonly ORAS_BASE_URL="https://github.com/oras-project/oras/releases/download/v${ORAS_VERSION}"

usage() {
  cat <<'EOF' >&2
Usage: install_oras.sh [install-dir]
EOF
  exit 1
}

if [[ $# -gt 1 ]]; then
  usage
fi

install_dir="${1:-$HOME/.local/bin}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ORAS installation is only supported on Linux runners in this repository" >&2
  exit 1
fi

os="linux"

case "$(uname -m)" in
  x86_64|amd64)
    arch="amd64"
    checksum="9229ccc6d17bb282039ad4a69abb16dcb887a5bce567c075d731d9b3c7ad8eaf"
    ;;
  aarch64|arm64)
    checksum="8db4a223bd6034deff198e791ea7cb3af0840df25b7e9f370e2f1f3fd20d389b"
    ;;
  *)
    echo "Unsupported architecture for ORAS installation: $(uname -m)" >&2
    exit 1
    ;;
esac

archive_name="oras_${ORAS_VERSION}_${os}_${arch}.tar.gz"
download_url="${ORAS_BASE_URL}/${archive_name}"

mkdir -p "$install_dir"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

curl --fail --silent --show-error --location "$download_url" --output "$temp_dir/$archive_name"
printf '%s  %s\n' "$checksum" "$temp_dir/$archive_name" | sha256sum --check --status
tar -xzf "$temp_dir/$archive_name" -C "$install_dir" oras

version_output="$($install_dir/oras version)"
resolved_version="$(printf '%s\n' "$version_output" | awk -F': *' '/^Version:/ {print $2}')"
if [[ "$resolved_version" != "$ORAS_VERSION" ]]; then
  echo "Installed ORAS version mismatch: expected $ORAS_VERSION, got ${resolved_version:-unknown}" >&2
  exit 1
fi

echo "$install_dir"
