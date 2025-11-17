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

# Quiet mode - only show summary
QUIET="${QUIET:-0}"

if [ "$QUIET" = "0" ]; then
    echo "Setting up test image directories..."
fi

# Create directory structure
mkdir -p "$IMAGES_DIR"/{cmyk,rgb,special}
mkdir -p "$EXPECTED_DIR"/{cmyk,rgb,special}
mkdir -p "$METADATA_DIR"

# Check if ImageMagick is available (try both 'magick' and 'convert' commands)
MAGICK_CMD=""
if command -v magick &> /dev/null; then
    MAGICK_CMD="magick"
elif command -v convert &> /dev/null; then
    MAGICK_CMD="convert"
else
    echo "❌ ImageMagick not found. Please install ImageMagick to generate test images."
    echo "   sudo apt-get install imagemagick"
    exit 1
fi

if [ "$QUIET" = "0" ]; then
    echo "✓ ImageMagick found ($MAGICK_CMD)"
fi

# Function to create minimal test images for raster formats
create_test_image() {
    local filename="$1"
    local colorspace="$2"
    local color="$3"
    local format="$4"
    
    if [ "$QUIET" = "0" ]; then
        echo "Creating $filename..."
    fi
    
    case "$colorspace" in
        "CMYK")
            $MAGICK_CMD -size 100x100 xc:"$color" -colorspace CMYK "$format:$filename" 2>/dev/null
            ;;
        "RGB"|"sRGB")
            $MAGICK_CMD -size 100x100 xc:"$color" -colorspace sRGB "$format:$filename" 2>/dev/null
            ;;
        "Gray")
            $MAGICK_CMD -size 100x100 xc:"$color" -colorspace Gray "$format:$filename" 2>/dev/null
            ;;
        "Lab")
            $MAGICK_CMD -size 100x100 xc:"$color" -colorspace Lab "$format:$filename" 2>/dev/null
            ;;
    esac
    
    if [ -f "$filename" ]; then
        if [ "$QUIET" = "0" ]; then
            echo "  ✓ Created $(du -h "$filename" | cut -f1) file"
        fi
    else
        echo "  ❌ Failed to create $filename"
        return 1
    fi
}

# Function to create vector files with proper CMYK PostScript code
create_vector_cmyk() {
    local filename="$1"
    local c="$2"  # Cyan 0-1
    local m="$3"  # Magenta 0-1
    local y="$4"  # Yellow 0-1
    local k="$5"  # Black 0-1
    local format="$6"  # "eps" or "ai"
    
    if [ "$QUIET" = "0" ]; then
        echo "Creating $filename with CMYK($c,$m,$y,$k)..."
    fi
    
    # Determine if this is AI or EPS format
    if [[ "$filename" == *.ai ]]; then
        # Adobe Illustrator format (simplified - using standard PostScript)
        # Note: AI files specify artboard size which affects rendering
        cat > "$filename" << 'AIEOF'
%!PS-Adobe-3.0
%%Creator: Adobe Illustrator(R) 24.0
%%AI8_CreatorVersion: 24.0.0
%%For: (Test) ()
%%Title: (CMYK Test Image)
%%CreationDate: 2025-11-17
%%BoundingBox: 0 0 100 100
%%HiResBoundingBox: 0.0000 0.0000 100.0000 100.0000
%%DocumentProcessColors: Cyan Magenta Yellow Black
%%ColorUsage: Color
%%PageSize: 100 100
%%EndComments

%%BeginProlog
<< /PageSize [100 100] >> setpagedevice
%%EndProlog

%%BeginSetup
%%EndSetup

%%Page: 1 1

% Set CMYK colorspace
/DeviceCMYK setcolorspace

% Set fill color
AIEOF
        echo "$c $m $y $k setcolor" >> "$filename"
        cat >> "$filename" << 'AIEOF'

% Draw filled rectangle
newpath
0 0 moveto
100 0 lineto
100 100 lineto
0 100 lineto
closepath
fill

showpage
%%Trailer
%%EOF
AIEOF
    else
        # Standard EPS format
        cat > "$filename" << 'EPSEOF'
%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 100 100
%%Creator: SamBee Test Generator
%%Title: CMYK Test Image
%%CreationDate: 2025-11-17
%%LanguageLevel: 2
%%DocumentData: Clean7Bit
%%ColorUsage: Color
%%DocumentProcessColors: Cyan Magenta Yellow Black
%%EndComments

%%BeginProlog
%%EndProlog

%%BeginSetup
%%EndSetup

%%Page: 1 1

% Set CMYK colorspace and fill color
/DeviceCMYK setcolorspace
EPSEOF
        echo "$c $m $y $k setcolor" >> "$filename"
        cat >> "$filename" << 'EPSEOF'

% Draw filled rectangle covering entire bounding box
newpath
0 0 moveto
100 0 lineto
100 100 lineto
0 100 lineto
closepath
fill

showpage
%%EOF
EPSEOF
    fi
    
    if [ -f "$filename" ]; then
        if [ "$QUIET" = "0" ]; then
            echo "  ✓ Created $(du -h "$filename" | cut -f1) vector file with embedded CMYK"
        fi
    else
        echo "  ❌ Failed to create $filename"
        return 1
    fi
}

# Function to create vector files with RGB PostScript code
create_vector_rgb() {
    local filename="$1"
    local r="$2"  # Red 0-1
    local g="$3"  # Green 0-1
    local b="$4"  # Blue 0-1
    
    if [ "$QUIET" = "0" ]; then
        echo "Creating $filename with RGB($r,$g,$b)..."
    fi
    
    # Determine if this is AI or EPS format
    if [[ "$filename" == *.ai ]]; then
        # Adobe Illustrator format (simplified - using standard PostScript)
        # Note: AI files specify artboard size which affects rendering
        cat > "$filename" << 'AIEOF'
%!PS-Adobe-3.0
%%Creator: Adobe Illustrator(R) 24.0
%%AI8_CreatorVersion: 24.0.0
%%For: (Test) ()
%%Title: (RGB Test Image)
%%CreationDate: 2025-11-17
%%BoundingBox: 0 0 100 100
%%HiResBoundingBox: 0.0000 0.0000 100.0000 100.0000
%%ColorUsage: Color
%%PageSize: 100 100
%%EndComments

%%BeginProlog
<< /PageSize [100 100] >> setpagedevice
%%EndProlog

%%BeginSetup
%%EndSetup

%%Page: 1 1

% Set RGB colorspace
/DeviceRGB setcolorspace

% Set fill color
AIEOF
        echo "$r $g $b setcolor" >> "$filename"
        cat >> "$filename" << 'AIEOF'

% Draw filled rectangle
newpath
0 0 moveto
100 0 lineto
100 100 lineto
0 100 lineto
closepath
fill

showpage
%%Trailer
%%EOF
AIEOF
    else
        # Standard EPS format
        cat > "$filename" << 'EPSEOF'
%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 100 100
%%Creator: SamBee Test Generator
%%Title: RGB Test Image
%%CreationDate: 2025-11-17
%%LanguageLevel: 2
%%DocumentData: Clean7Bit
%%ColorUsage: Color
%%EndComments

%%BeginProlog
%%EndProlog

%%BeginSetup
%%EndSetup

%%Page: 1 1

% Set RGB colorspace and fill color
/DeviceRGB setcolorspace
EPSEOF
        echo "$r $g $b setcolor" >> "$filename"
        cat >> "$filename" << 'EPSEOF'

% Draw filled rectangle covering entire bounding box
newpath
0 0 moveto
100 0 lineto
100 100 lineto
0 100 lineto
closepath
fill

showpage
%%EOF
EPSEOF
    fi
    
    if [ -f "$filename" ]; then
        if [ "$QUIET" = "0" ]; then
            echo "  ✓ Created $(du -h "$filename" | cut -f1) vector file with embedded RGB"
        fi
    else
        echo "  ❌ Failed to create $filename"
        return 1
    fi
}

# Create CMYK test images
if [ "$QUIET" = "0" ]; then
    echo ""
    echo "Creating CMYK test images..."
fi

# CMYK PSD - Cyan color (C=100%, M=0%, Y=0%, K=0%)
create_test_image "$IMAGES_DIR/cmyk/photoshop_cmyk.psd" "CMYK" "cmyk(100,0,0,0)" "psd"

# CMYK TIFF - Magenta color
create_test_image "$IMAGES_DIR/cmyk/tiff_cmyk.tif" "CMYK" "cmyk(0,100,0,0)" "tiff"

# CMYK EPS - Yellow color (using PostScript source code)
# C=0, M=0, Y=100%, K=0 in PostScript (values are 0-1 scale)
create_vector_cmyk "$IMAGES_DIR/cmyk/postscript_cmyk.eps" "0" "0" "1" "0" "eps"

# CMYK AI (Adobe Illustrator format, which is EPS-based) - Black color
# C=0, M=0, Y=0, K=100% in PostScript
create_vector_cmyk "$IMAGES_DIR/cmyk/illustrator_cmyk.ai" "0" "0" "0" "1" "ai"

# Create RGB test images
if [ "$QUIET" = "0" ]; then
    echo ""
    echo "Creating RGB test images..."
fi

# RGB PSD - Cyan color (R=0, G=255, B=255)
create_test_image "$IMAGES_DIR/rgb/photoshop_rgb.psd" "sRGB" "rgb(0,255,255)" "psd"

# RGB TIFF - Magenta color
create_test_image "$IMAGES_DIR/rgb/tiff_rgb.tif" "sRGB" "rgb(255,0,255)" "tiff"

# RGB EPS - Yellow color (using PostScript source code)
# R=1.0, G=1.0, B=0 in PostScript (values are 0-1 scale)
create_vector_rgb "$IMAGES_DIR/rgb/postscript_rgb.eps" "1" "1" "0"

# RGB AI - Red color
# R=1.0, G=0, B=0 in PostScript
create_vector_rgb "$IMAGES_DIR/rgb/illustrator_rgb.ai" "1" "0" "0"

# Create special colorspace images
if [ "$QUIET" = "0" ]; then
    echo ""
    echo "Creating special colorspace test images..."
fi

# Grayscale PSD
create_test_image "$IMAGES_DIR/special/grayscale.psd" "Gray" "gray(128)" "psd"

# Lab TIFF
create_test_image "$IMAGES_DIR/special/lab_color.tif" "Lab" "rgb(100,150,200)" "tiff"

# Create manifest.json
if [ "$QUIET" = "0" ]; then
    echo ""
    echo "Creating manifest.json..."
fi

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

if [ "$QUIET" = "0" ]; then
    echo "✓ Created manifest.json"
fi

# Generate .gitignore for test images
cat > "$TEST_DATA_DIR/.gitignore" << 'EOF'
# Auto-generated test images (regenerated via scripts/setup-test-images.sh)
images/

# Metadata manifest is auto-generated
metadata/manifest.json

# Ignore temporary files
*.tmp
*.cache
diff/
EOF

if [ "$QUIET" = "0" ]; then
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
    echo ""
else
    # Quiet mode - just show summary
    echo "Generated 10 test images ($(du -sh "$IMAGES_DIR" | cut -f1))"
fi
