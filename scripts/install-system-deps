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
# - ghostscript: PostScript/PDF interpreter (required for EPS, AI, PS, PDF processing via ImageMagick)
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
    ghostscript
    libgs-common
    wget
)

# Install ImageMagick 7 from official AppImage
install_imagemagick7() {
    INSTALL_DIR="/opt/imagemagick"
    
    # Check if ImageMagick is already installed (from cache)
    if [ -x "$INSTALL_DIR/usr/bin/magick" ] && [ -x /usr/local/bin/magick ]; then
        echo "ImageMagick 7 already installed (restored from cache)"
        return
    fi
    
    echo "Installing ImageMagick 7 from AppImage..."
    
    # Download and extract ImageMagick AppImage
    # Note: AppImages require FUSE which isn't available in containers,
    # so we extract the contents and use the binaries directly
    MAGICK_URL="https://imagemagick.org/archive/binaries/magick"
    CACHE_DIR="/tmp/imagemagick-appimage"
    
    # Check if cached AppImage exists
    if [ -f "$CACHE_DIR/magick.appimage" ]; then
        echo "Using cached ImageMagick AppImage..."
        cp "$CACHE_DIR/magick.appimage" /tmp/magick.appimage
    else
        # Download AppImage to temp location
        cd /tmp
        if ! wget -q "$MAGICK_URL" -O magick.appimage; then
            echo "Failed to download ImageMagick AppImage, falling back to package manager"
            apt-get install -y imagemagick
            return
        fi
        
        # Cache the downloaded AppImage for future runs
        mkdir -p "$CACHE_DIR"
        cp magick.appimage "$CACHE_DIR/magick.appimage"
    fi
    
    # Extract AppImage contents
    cd /tmp
    chmod +x magick.appimage
    ./magick.appimage --appimage-extract >/dev/null 2>&1
    
    # Move extracted contents to install directory
    rm -rf "$INSTALL_DIR"
    mv squashfs-root "$INSTALL_DIR"
    rm magick.appimage
    
    # Create wrapper script that sets up ImageMagick environment
    cat > /usr/local/bin/magick << 'EOF'
#!/bin/bash
MAGICK_HOME="/opt/imagemagick/usr"
export MAGICK_CONFIGURE_PATH="$MAGICK_HOME/lib/ImageMagick-7.1.2/config-Q16:$MAGICK_HOME/lib/ImageMagick-7.1.2/config-Q16HDRI:$MAGICK_HOME/share/ImageMagick-7:$MAGICK_HOME/etc/ImageMagick-7"
export LD_LIBRARY_PATH="$MAGICK_HOME/lib:$MAGICK_HOME/lib/ImageMagick-7.1.2/modules-Q16HDRI/coders${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$MAGICK_HOME/bin/magick" "$@"
EOF
    chmod +x /usr/local/bin/magick
    
    # Create symlinks for legacy command names
    ln -sf /usr/local/bin/magick /usr/local/bin/convert
    ln -sf /usr/local/bin/magick /usr/local/bin/identify
    ln -sf /usr/local/bin/magick /usr/local/bin/mogrify
    ln -sf /usr/local/bin/magick /usr/local/bin/composite
    ln -sf /usr/local/bin/magick /usr/local/bin/montage
    
    # Verify installation
    if /usr/local/bin/magick --version 2>/dev/null | head -1; then
        echo "✓ ImageMagick 7 installed successfully from AppImage"
    else
        echo "❌ ImageMagick 7 installation failed, falling back to package manager"
        rm -rf "$INSTALL_DIR" /usr/local/bin/magick
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
