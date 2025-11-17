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
# - libgs-common: Ghostscript ICC color profiles for proper CMYK→RGB conversion
#
# NOTE: ImageMagick 7 installation varies by distro:
# - Debian: 'imagemagick' package provides v7 (uses 'magick' command)
# - Ubuntu: 'imagemagick' package provides v6 (uses 'convert' command)
# We explicitly install v7 packages to ensure consistency across environments
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
    libgs-common
)

# ImageMagick 7 packages (distro-specific)
if grep -q "Ubuntu" /etc/os-release 2>/dev/null; then
    # Ubuntu doesn't have ImageMagick 7 in default repos, use v6
    IMAGEMAGICK_PACKAGES=(imagemagick)
else
    # Debian has ImageMagick 7
    IMAGEMAGICK_PACKAGES=(imagemagick)
fi

# Function to install packages
install_packages() {
    echo "Installing Sambee system dependencies..."
    echo "Using ${LIBJPEG_PKG} for libjpeg-turbo"
    apt-get update
    apt-get install -y "${SAMBEE_SYSTEM_PACKAGES[@]}" "${IMAGEMAGICK_PACKAGES[@]}"
    rm -rf /var/lib/apt/lists/*
    
    # Verify ImageMagick installation and report version
    if command -v magick &> /dev/null; then
        echo "✓ ImageMagick 7 installed (magick command available)"
        magick --version | head -1
    elif command -v convert &> /dev/null; then
        echo "✓ ImageMagick 6 installed (convert command available)"
        convert --version | head -1
    else
        echo "⚠ WARNING: ImageMagick installation could not be verified"
    fi
    
    echo "✓ System dependencies installed successfully"
}

# If script is executed (not sourced), run installation
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    install_packages
fi
