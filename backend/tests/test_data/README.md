# Test Image Assets

## Overview

This directory contains real image files for testing image conversion and colorspace handling. These images are used to verify that our conversion pipeline correctly handles various image formats and colorspace configurations.

## Directory Structure

```
test_data/
├── README.md              # This file
├── images/                # Actual test images
│   ├── cmyk/             # CMYK colorspace images
│   ├── rgb/              # RGB/sRGB colorspace images
│   └── special/          # Other colorspaces (Lab, Grayscale, etc.)
├── expected/             # Expected conversion outputs (reference images)
│   ├── cmyk/
│   ├── rgb/
│   └── special/
└── metadata/             # Image metadata for verification
    └── manifest.json     # Central manifest with image properties

```

## Image Categories

### CMYK Images
Images in CMYK colorspace, commonly used in print workflows:
- `cmyk/photoshop_cmyk.psd` - Adobe Photoshop CMYK document
- `cmyk/illustrator_cmyk.ai` - Adobe Illustrator CMYK artwork
- `cmyk/postscript_cmyk.eps` - Encapsulated PostScript CMYK
- `cmyk/tiff_cmyk.tif` - TIFF with CMYK colorspace

### RGB Images
Images in RGB/sRGB colorspace:
- `rgb/photoshop_rgb.psd` - Adobe Photoshop RGB document
- `rgb/illustrator_rgb.ai` - Adobe Illustrator RGB artwork
- `rgb/postscript_rgb.eps` - Encapsulated PostScript RGB
- `rgb/tiff_rgb.tif` - TIFF with RGB colorspace

### Special Colorspaces
Images with other colorspace configurations:
- `special/lab_color.tif` - TIFF with Lab colorspace
- `special/grayscale.psd` - Grayscale PSD file
- `special/indexed_color.tif` - Indexed color TIFF

## Storage Strategy

Due to GitHub repository size constraints and CI/CD performance, we use a hybrid storage approach:

### 1. Git LFS (Large File Storage)
- **Purpose**: Store binary test images efficiently
- **Size limit**: ~100MB total for all test assets
- **Files tracked**: All images in `test_data/images/` and `test_data/expected/`
- **Benefits**: 
  - Keeps repository clone fast
  - Supports large binary files
  - Available in CI/CD pipelines

### 2. On-Demand Download
- **Purpose**: Download test images only when needed
- **Implementation**: `scripts/download-test-images.sh`
- **Source**: Dedicated test assets repository or cloud storage
- **Cache**: Downloaded images cached in CI/CD to avoid repeated downloads

## Manifest Format

`metadata/manifest.json` contains metadata for all test images:

```json
{
  "images": {
    "cmyk/photoshop_cmyk.psd": {
      "colorspace": "CMYK",
      "format": "PSD",
      "width": 1920,
      "height": 1080,
      "layers": 5,
      "expected_output": {
        "format": "PNG",
        "colorspace": "sRGB",
        "checksum": "sha256:abc123..."
      },
      "test_cases": [
        "cmyk_to_rgb_conversion",
        "icc_profile_handling",
        "layer_flattening"
      ]
    }
  }
}
```

## Test Implementation

Tests use pytest fixtures to load test images:

```python
@pytest.fixture
def test_image_cmyk_psd():
    """Load CMYK PSD test image."""
    return load_test_image("cmyk/photoshop_cmyk.psd")

def test_cmyk_psd_conversion(test_image_cmyk_psd):
    """Test CMYK PSD converts to RGB without color inversion."""
    result = convert_image(test_image_cmyk_psd, "png")
    assert_colorspace(result, "sRGB")
    assert_visual_similarity(result, expected_output, threshold=0.95)
```

## Creating Test Images

To create minimal test images for CMYK/RGB testing:

### ImageMagick Commands

```bash
# Create a small CMYK PSD (100x100px with CMYK color swatch)
magick -size 100x100 xc:"cmyk(100,0,0,0)" -colorspace CMYK psd:cmyk_test.psd

# Create a small RGB PSD (100x100px with RGB color swatch)
magick -size 100x100 xc:"rgb(0,255,255)" -colorspace sRGB psd:rgb_test.psd

# Create CMYK TIFF
magick -size 100x100 xc:"cmyk(100,0,0,0)" -colorspace CMYK tiff:cmyk_test.tif

# Create CMYK EPS
magick -size 100x100 xc:"cmyk(100,0,0,0)" -colorspace CMYK eps:cmyk_test.eps
```

### Photoshop/Illustrator
For more realistic test files:
1. Open Photoshop/Illustrator
2. Create new document with specific colorspace (CMYK or RGB)
3. Add simple geometric shapes with primary colors
4. Save as PSD/AI/EPS

## Size Optimization

To keep repository size small:
- **Minimal dimensions**: 100x100px or 200x200px maximum
- **Simple content**: Solid colors, gradients, geometric shapes
- **No unnecessary layers**: Flatten where possible
- **Compression**: Enable compression for PSD/TIFF formats

## CI/CD Integration

### GitHub Actions Workflow

```yaml
- name: Download test images
  run: ./scripts/download-test-images.sh
  
- name: Cache test images
  uses: actions/cache@v4
  with:
    path: backend/tests/test_data/images
    key: test-images-${{ hashFiles('backend/tests/test_data/metadata/manifest.json') }}
```

### Local Development

```bash
# Download test images (one-time setup)
./scripts/download-test-images.sh

# Run image conversion tests
pytest tests/test_image_conversion_real.py -v

# Run with coverage
pytest tests/test_image_conversion_real.py --cov=app/services
```

## Visual Regression Testing

For visual quality verification:

1. **Generate reference images**: First run creates expected outputs
2. **Compare subsequent runs**: Pixel-wise or perceptual comparison
3. **Threshold**: Allow minor differences (e.g., 95% similarity)
4. **Diff images**: Generate diff images showing changes

## Maintenance

### Adding New Test Images

1. Create/obtain test image
2. Optimize size (max 100x100px, simple content)
3. Add to appropriate category folder
4. Update `manifest.json` with metadata
5. Generate expected output
6. Create test case in `test_image_conversion_real.py`
7. Update this README

### Updating Expected Outputs

When conversion logic changes intentionally:

```bash
# Regenerate all expected outputs
pytest tests/test_image_conversion_real.py --regenerate-expected

# Review diff images
ls test_data/expected/diff/

# Commit updated expected outputs if correct
git add test_data/expected/
git commit -m "Update expected outputs for improved conversion"
```

## Performance Considerations

- **Test duration**: Image conversion tests may take 30-60 seconds
- **Parallel execution**: Use pytest-xdist for parallel test execution
- **Skip in unit tests**: Mark as integration tests, skip in fast unit test runs
- **CI/CD caching**: Cache downloaded images and expected outputs

## Troubleshooting

### Test Images Not Found

```bash
# Re-download test images
rm -rf backend/tests/test_data/images
./scripts/download-test-images.sh
```

### Conversion Failures

Check logs for:
- Missing ICC profiles (install `libgs-common`)
- Missing ImageMagick/GraphicsMagick
- Insufficient memory for large images
- Timeout issues (increase timeout in tests)

### Visual Differences

If tests fail due to visual differences:
1. Check diff images in `test_data/expected/diff/`
2. Verify conversion logic hasn't regressed
3. If intentional change, regenerate expected outputs
4. Review color accuracy with color picker tool

## References

- [ImageMagick Color Management](https://imagemagick.org/script/color-management.php)
- [libvips Colorspace Handling](https://www.libvips.org/API/current/libvips-colour.html)
- [ICC Color Profiles](http://www.color.org/icc_specs2.xalter)
- [CMYK to RGB Conversion](https://en.wikipedia.org/wiki/CMYK_color_model#Conversion)
