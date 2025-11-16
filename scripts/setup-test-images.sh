#!/bin/bash
# Download or generate test images for image conversion testing
# This script ensures we have minimal test images for CMYK/RGB conversion testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_DATA_DIR="$PROJECT_ROOT/backend/tests/test_data"
IMAGES_DIR="$TEST_DATA_DIR/images"
EXPECTED_DIR="$TEST_DATA_DIR/expected"
METADATA_DIR="$TEST_DATA_DIR/metadata"

echo "Setting up test image directories..."

# Create directory structure
mkdir -p "$IMAGES_DIR"/{cmyk,rgb,special}
mkdir -p "$EXPECTED_DIR"/{cmyk,rgb,special}
mkdir -p "$METADATA_DIR"

# Check if ImageMagick is available
if ! command -v magick &> /dev/null; then
    echo "❌ ImageMagick not found. Please install ImageMagick to generate test images."
    echo "   sudo apt-get install imagemagick"
    exit 1
fi

echo "✓ ImageMagick found"

# Function to create minimal test images
create_test_image() {
    local filename="$1"
    local colorspace="$2"
    local color="$3"
    local format="$4"
    
    echo "Creating $filename..."
    
    case "$colorspace" in
        "CMYK")
            magick -size 100x100 xc:"$color" -colorspace CMYK "$format:$filename"
            ;;
        "RGB"|"sRGB")
            magick -size 100x100 xc:"$color" -colorspace sRGB "$format:$filename"
            ;;
        "Gray")
            magick -size 100x100 xc:"$color" -colorspace Gray "$format:$filename"
            ;;
        "Lab")
            magick -size 100x100 xc:"$color" -colorspace Lab "$format:$filename"
            ;;
    esac
    
    if [ -f "$filename" ]; then
        echo "  ✓ Created $(du -h "$filename" | cut -f1) file"
    else
        echo "  ❌ Failed to create $filename"
        return 1
    fi
}

# Create CMYK test images
echo ""
echo "Creating CMYK test images..."

# CMYK PSD - Cyan color (C=100%, M=0%, Y=0%, K=0%)
create_test_image "$IMAGES_DIR/cmyk/photoshop_cmyk.psd" "CMYK" "cmyk(100,0,0,0)" "psd"

# CMYK TIFF - Magenta color
create_test_image "$IMAGES_DIR/cmyk/tiff_cmyk.tif" "CMYK" "cmyk(0,100,0,0)" "tiff"

# CMYK EPS - Yellow color
create_test_image "$IMAGES_DIR/cmyk/postscript_cmyk.eps" "CMYK" "cmyk(0,0,100,0)" "eps"

# CMYK AI (saved as EPS format) - Black color
create_test_image "$IMAGES_DIR/cmyk/illustrator_cmyk.ai" "CMYK" "cmyk(0,0,0,100)" "eps"

# Create RGB test images
echo ""
echo "Creating RGB test images..."

# RGB PSD - Cyan color (R=0, G=255, B=255)
create_test_image "$IMAGES_DIR/rgb/photoshop_rgb.psd" "sRGB" "rgb(0,255,255)" "psd"

# RGB TIFF - Magenta color
create_test_image "$IMAGES_DIR/rgb/tiff_rgb.tif" "sRGB" "rgb(255,0,255)" "tiff"

# RGB EPS - Yellow color
create_test_image "$IMAGES_DIR/rgb/postscript_rgb.eps" "sRGB" "rgb(255,255,0)" "eps"

# RGB AI - Red color
create_test_image "$IMAGES_DIR/rgb/illustrator_rgb.ai" "sRGB" "rgb(255,0,0)" "eps"

# Create special colorspace images
echo ""
echo "Creating special colorspace test images..."

# Grayscale PSD
create_test_image "$IMAGES_DIR/special/grayscale.psd" "Gray" "gray(128)" "psd"

# Lab TIFF
create_test_image "$IMAGES_DIR/special/lab_color.tif" "Lab" "rgb(100,150,200)" "tiff"

# Create manifest.json
echo ""
echo "Creating manifest.json..."

cat > "$METADATA_DIR/manifest.json" << 'EOF'
{
  "version": "1.0.0",
  "created": "auto-generated",
  "description": "Test image assets for colorspace conversion testing",
  "images": {
    "cmyk/photoshop_cmyk.psd": {
      "colorspace": "CMYK",
      "format": "PSD",
      "width": 100,
      "height": 100,
      "color": "cyan (C=100%, M=0%, Y=0%, K=0%)",
      "expected_rgb": "rgb(0, 255, 255)",
      "test_cases": ["cmyk_to_rgb_conversion", "icc_profile_handling"]
    },
    "cmyk/tiff_cmyk.tif": {
      "colorspace": "CMYK",
      "format": "TIFF",
      "width": 100,
      "height": 100,
      "color": "magenta (C=0%, M=100%, Y=0%, K=0%)",
      "expected_rgb": "rgb(255, 0, 255)",
      "test_cases": ["cmyk_to_rgb_conversion", "libvips_colorspace"]
    },
    "cmyk/postscript_cmyk.eps": {
      "colorspace": "CMYK",
      "format": "EPS",
      "width": 100,
      "height": 100,
      "color": "yellow (C=0%, M=0%, Y=100%, K=0%)",
      "expected_rgb": "rgb(255, 255, 0)",
      "test_cases": ["cmyk_to_rgb_conversion", "vector_rendering"]
    },
    "cmyk/illustrator_cmyk.ai": {
      "colorspace": "CMYK",
      "format": "AI",
      "width": 100,
      "height": 100,
      "color": "black (C=0%, M=0%, Y=0%, K=100%)",
      "expected_rgb": "rgb(0, 0, 0)",
      "test_cases": ["cmyk_to_rgb_conversion", "vector_rendering"]
    },
    "rgb/photoshop_rgb.psd": {
      "colorspace": "sRGB",
      "format": "PSD",
      "width": 100,
      "height": 100,
      "color": "cyan (R=0, G=255, B=255)",
      "expected_rgb": "rgb(0, 255, 255)",
      "test_cases": ["rgb_preservation", "no_color_inversion"]
    },
    "rgb/tiff_rgb.tif": {
      "colorspace": "sRGB",
      "format": "TIFF",
      "width": 100,
      "height": 100,
      "color": "magenta (R=255, G=0, B=255)",
      "expected_rgb": "rgb(255, 0, 255)",
      "test_cases": ["rgb_preservation", "libvips_handling"]
    },
    "rgb/postscript_rgb.eps": {
      "colorspace": "sRGB",
      "format": "EPS",
      "width": 100,
      "height": 100,
      "color": "yellow (R=255, G=255, B=0)",
      "expected_rgb": "rgb(255, 255, 0)",
      "test_cases": ["rgb_preservation", "vector_rendering"]
    },
    "rgb/illustrator_rgb.ai": {
      "colorspace": "sRGB",
      "format": "AI",
      "width": 100,
      "height": 100,
      "color": "red (R=255, G=0, B=0)",
      "expected_rgb": "rgb(255, 0, 0)",
      "test_cases": ["rgb_preservation", "no_color_inversion"]
    },
    "special/grayscale.psd": {
      "colorspace": "Gray",
      "format": "PSD",
      "width": 100,
      "height": 100,
      "color": "50% gray",
      "expected_rgb": "rgb(128, 128, 128)",
      "test_cases": ["grayscale_handling"]
    },
    "special/lab_color.tif": {
      "colorspace": "Lab",
      "format": "TIFF",
      "width": 100,
      "height": 100,
      "color": "Lab colorspace",
      "test_cases": ["lab_to_rgb_conversion"]
    }
  }
}
EOF

echo "✓ Created manifest.json"

# Generate .gitignore for test images
cat > "$TEST_DATA_DIR/.gitignore" << 'EOF'
# Test images are tracked with Git LFS
# Ignore temporary files
*.tmp
*.cache
diff/
EOF

echo "✓ Created .gitignore"

# Summary
echo ""
echo "=========================================="
echo "Test Image Setup Complete!"
echo "=========================================="
echo ""
echo "Created directories:"
echo "  - $IMAGES_DIR/cmyk (4 files)"
echo "  - $IMAGES_DIR/rgb (4 files)"
echo "  - $IMAGES_DIR/special (2 files)"
echo ""
echo "Total test images: 10"
echo "Total size: $(du -sh "$IMAGES_DIR" | cut -f1)"
echo ""
echo "Next steps:"
echo "  1. Review test images in $IMAGES_DIR"
echo "  2. Run image conversion tests: pytest tests/test_image_conversion_real.py"
echo "  3. Consider setting up Git LFS for efficient storage"
echo ""
echo "Git LFS setup (optional):"
echo "  git lfs track 'backend/tests/test_data/images/**'"
echo "  git lfs track 'backend/tests/test_data/expected/**'"
echo "  git add .gitattributes"
echo ""
