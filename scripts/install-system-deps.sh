#!/bin/bash
# Centralized system dependencies installation script
# Used by: Devcontainer, Dockerfile, GitHub Actions

set -e

# Common packages required for Sambee
# - gcc, pkg-config: Build tools for Python packages
# - libmagic1: File type detection
# - libvips42, libvips-dev: Image processing library
# - libheif1: HEIC/HEIF image format support
# - libjpeg62-turbo, libpng16-16, libtiff6, libwebp7, libgif7, libexif12: Image format libraries
# - graphicsmagick: PSD/PSB preprocessing
SAMBEE_SYSTEM_PACKAGES=(
    gcc
    pkg-config
    libmagic1
    libvips42
    libvips-dev
    libheif1
    libjpeg62-turbo
    libpng16-16
    libtiff6
    libwebp7
    libgif7
    libexif12
    graphicsmagick
)

# Function to install packages
install_packages() {
    echo "Installing Sambee system dependencies..."
    apt-get update
    apt-get install -y "${SAMBEE_SYSTEM_PACKAGES[@]}"
    rm -rf /var/lib/apt/lists/*
    echo "✓ System dependencies installed successfully"
}

# If script is executed (not sourced), run installation
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    install_packages
fi
