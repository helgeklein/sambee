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
    wget
)

# Install ImageMagick 7 from official binaries
install_imagemagick7() {
    echo "Installing ImageMagick 7..."
    
    # Download and extract ImageMagick 7 binary for Linux
    MAGICK_TARBALL="ImageMagick-x86_64-pc-linux-gnu.tar.gz"
    MAGICK_URL="https://imagemagick.org/archive/binaries/${MAGICK_TARBALL}"
    INSTALL_DIR="/opt/imagemagick"
    
    # Download to temp location
    cd /tmp
    if ! wget -q "$MAGICK_URL" -O imagemagick.tar.gz; then
        echo "Failed to download ImageMagick, falling back to package manager"
        apt-get install -y imagemagick
        return
    fi
    
    # Extract to /opt
    mkdir -p "$INSTALL_DIR"
    tar -xzf imagemagick.tar.gz -C "$INSTALL_DIR" --strip-components=1
    rm imagemagick.tar.gz
    
    # Create symlinks in /usr/local/bin
    ln -sf "$INSTALL_DIR/bin/magick" /usr/local/bin/magick
    ln -sf /usr/local/bin/magick /usr/local/bin/convert
    ln -sf /usr/local/bin/magick /usr/local/bin/identify
    ln -sf /usr/local/bin/magick /usr/local/bin/mogrify
    ln -sf /usr/local/bin/magick /usr/local/bin/composite
    ln -sf /usr/local/bin/magick /usr/local/bin/montage
    
    # Set up library path
    echo "$INSTALL_DIR/lib" > /etc/ld.so.conf.d/imagemagick.conf
    ldconfig
    
    # Verify installation
    if /usr/local/bin/magick --version 2>/dev/null | head -1; then
        echo "✓ ImageMagick 7 installed successfully"
    else
        echo "❌ ImageMagick 7 installation failed, falling back to package manager"
        rm -rf "$INSTALL_DIR"
        apt-get install -y imagemagick
    fi
}

# Function to install packages
install_packages() {
    echo "Installing Sambee system dependencies..."
    echo "Using ${LIBJPEG_PKG} for libjpeg-turbo"
    apt-get update
    apt-get install -y "${SAMBEE_SYSTEM_PACKAGES[@]}"
    
    # Install ImageMagick 7
    install_imagemagick7
    
    rm -rf /var/lib/apt/lists/*
    echo "✓ All system dependencies installed successfully"
}

# If script is executed (not sourced), run installation
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    install_packages
fi
