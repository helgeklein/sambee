#!/bin/bash
# Centralized system dependencies installation script
# Used by: Devcontainer, Dockerfile, GitHub Actions

set -e

# Detect if we're on Ubuntu or Debian to use the correct libjpeg package
if grep -q "Ubuntu" /etc/os-release 2>/dev/null; then
    LIBJPEG_PKG="libjpeg-turbo8"
else
    LIBJPEG_PKG="libjpeg62-turbo"
fi

# Common packages required for Sambee (runtime dependencies only)
# - libmagic1: File type detection (python-magic)
# - libvips42: Image processing library (pyvips runtime)
# - libheif1: HEIC/HEIF image format support
# - libjpeg-turbo8/libjpeg62-turbo: JPEG library (Ubuntu/Debian naming difference)
# - libpng16-16, libtiff6, libwebp7, libgif7, libexif12: Image format libraries
# - imagemagick: PSD/PSB preprocessing (provides 'imagemagick' on Ubuntu, 'imagemagick-7.q16' on Debian)
SAMBEE_SYSTEM_PACKAGES=(
    libmagic1
    libvips42
    libheif1
    "${LIBJPEG_PKG}"
    libpng16-16
    libtiff6
    libwebp7
    libgif7
    libexif12
    imagemagick
)

# Function to install packages
install_packages() {
    echo "Installing Sambee system dependencies..."
    echo "Using ${LIBJPEG_PKG} for libjpeg-turbo"
    apt-get update
    apt-get install -y "${SAMBEE_SYSTEM_PACKAGES[@]}"
    rm -rf /var/lib/apt/lists/*
    echo "✓ System dependencies installed successfully"
}

# If script is executed (not sourced), run installation
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    install_packages
fi
