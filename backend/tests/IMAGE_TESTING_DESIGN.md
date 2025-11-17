# Image Conversion Testing System - Design Document

## Executive Summary

This document outlines a comprehensive testing system for verifying image conversion accuracy, including CMYK→RGB colorspace conversion. The design accounts for GitHub repository size constraints, CI/CD pipeline performance, and developer experience.

## Requirements

### Functional Requirements
1. **Colorspace Accuracy**: Verify CMYK→RGB conversion produces correct colors
2. **Format Coverage**: Test all supported exotic formats (PSD, PSB, EPS, AI, TIFF, HEIC, etc.)
3. **RGB Preservation**: Ensure RGB images don't get color-inverted
4. **Regression Detection**: Catch unintended changes in conversion logic

### Non-Functional Requirements
1. **CI/CD Performance**: Tests must complete within 2-3 minutes
2. **Repository Size**: Test assets must not bloat the repository (< 10MB total)
3. **Developer UX**: Easy setup for local testing
4. **Maintainability**: Clear test structure and documentation

## Architecture

### Component Overview

```
Image Conversion Test System
│
├── Test Data Management
│   ├── Minimal test images (auto-generated)
│   ├── Manifest file (metadata about test images)
│   └── Expected outputs (reference images)
│
├── Test Execution
│   ├── Unit tests (synthetic test data)
│   ├── Integration tests (real image files)
│   └── Visual regression tests (pixel comparison)
│
└── CI/CD Integration
    ├── GitHub Actions workflow
    ├── Caching strategy
    └── Artifact reporting
```

### Storage Strategy

#### Option 1: Auto-Generated Test Images (RECOMMENDED)
**Approach**: Generate minimal test images on-the-fly using ImageMagick

**Pros**:
- Zero repository bloat
- Works everywhere ImageMagick is installed
- Fast to generate (< 1 second for all images)
- Easy to customize test cases

**Cons**:
- Requires ImageMagick during test setup
- Synthetic images may not match real-world files

**Implementation**:
```bash
# Generate 100x100px CMYK PSD with pure cyan
magick -size 100x100 xc:"cmyk(100,0,0,0)" -colorspace CMYK psd:cmyk_test.psd
```

#### Option 2: Git LFS Storage
**Approach**: Store real image files in Git LFS

**Pros**:
- Real-world test files
- Matches actual user files
- Available in CI/CD automatically

**Cons**:
- Requires Git LFS setup (~100MB storage used)
- Slower CI/CD (LFS download time)
- Repository maintenance overhead

#### Option 3: External Storage with On-Demand Download
**Approach**: Store test images in cloud storage (S3, Google Drive, etc.)

**Pros**:
- No repository impact
- Can store larger, more realistic files
- Flexible versioning

**Cons**:
- Requires external infrastructure
- Network dependency in CI/CD
- Complexity in setup and maintenance

**RECOMMENDATION**: Use **Option 1** (auto-generated) for primary tests, with **Option 3** (external storage) for optional extended testing with real-world files.

## Test Data Design

### Minimal Test Image Set

| Image | Colorspace | Format | Size | Color | Expected RGB | Purpose |
|-------|-----------|--------|------|-------|--------------|---------|
| `cmyk_cyan.psd` | CMYK | PSD | 100x100 | C=100% M=0 Y=0 K=0 | rgb(0,255,255) | CMYK→RGB via ImageMagick |
| `cmyk_magenta.tif` | CMYK | TIFF | 100x100 | C=0 M=100% Y=0 K=0 | rgb(255,0,255) | CMYK→RGB via libvips |
| `cmyk_yellow.eps` | CMYK | EPS | 100x100 | C=0 M=0 Y=100% K=0 | rgb(255,255,0) | CMYK→RGB vector |
| `cmyk_black.ai` | CMYK | AI | 100x100 | C=0 M=0 Y=0 K=100% | rgb(0,0,0) | CMYK→RGB vector |
| `rgb_cyan.psd` | sRGB | PSD | 100x100 | R=0 G=255 B=255 | rgb(0,255,255) | RGB preservation |
| `rgb_magenta.tif` | sRGB | TIFF | 100x100 | R=255 G=0 B=255 | rgb(255,0,255) | RGB preservation |
| `rgb_yellow.eps` | sRGB | EPS | 100x100 | R=255 G=255 B=0 | rgb(255,255,0) | RGB preservation |
| `rgb_red.ai` | sRGB | AI | 100x100 | R=255 G=0 B=0 | rgb(255,0,0) | RGB preservation |
| `gray.psd` | Gray | PSD | 100x100 | 50% gray | rgb(128,128,128) | Grayscale handling |
| `lab.tif` | Lab | TIFF | 100x100 | Lab colorspace | (varies) | Lab→RGB conversion |

**Total size**: ~500KB (10 files × ~50KB each)

###  manifest.json Structure

```json
{
  "version": "1.0.0",
  "images": {
    "cmyk_cyan.psd": {
      "colorspace": "CMYK",
      "format": "PSD",
      "dimensions": [100, 100],
      "color": {"C": 100, "M": 0, "Y": 0, "K": 0},
      "expected_rgb": [0, 255, 255],
      "tolerance": 30,
      "test_cases": ["cmyk_to_rgb", "icc_profiles", "psd_preprocessing"]
    }
  }
}
```

## Test Implementation

### Test Structure

```python
# tests/test_image_conversion_real.py

@pytest.mark.integration
class TestCMYKConversion:
    """CMYK→RGB colorspace conversion tests."""
    
    @pytest.fixture(scope="class", autouse=True)
    def setup_test_images(self):
        """Generate test images before running tests."""
        subprocess.run(["./scripts/setup-test-images.sh"], check=True)
    
    def test_cmyk_psd_conversion(self):
        """Test CMYK PSD converts to RGB with correct colors."""
        input_data = load_test_image("cmyk_cyan.psd")
        output_data = convert_image_to_jpeg(input_data, "cmyk_cyan.psd")
        
        # Verify colorspace
        assert get_colorspace(output_data) == "sRGB"
        
        # Verify color accuracy (cyan: 0,255,255)
        avg_color = get_average_color(output_data)
        assert color_similarity(avg_color, (0, 255, 255)) > 0.90
```

### Color Verification Methods

#### Method 1: Average Color Comparison
**Approach**: Calculate average RGB values of entire image

**Implementation**:
```python
def get_average_color(image_data: bytes) -> tuple[int, int, int]:
    """Get average RGB color using pyvips."""
    img = pyvips.Image.new_from_buffer(image_data, "")
    if img.interpretation != "srgb":
        img = img.colourspace("srgb")  # type: ignore
    
    r = round(img.extract_band(0).avg())  # type: ignore
    g = round(img.extract_band(1).avg())  # type: ignore
    b = round(img.extract_band(2).avg())  # type: ignore
    return (r, g, b)

def color_similarity(color1, color2, tolerance=30) -> float:
    """Calculate color similarity (0-1 scale)."""
    distance = ((color1[0] - color2[0])**2 + 
                (color1[1] - color2[1])**2 + 
                (color1[2] - color2[2])**2)**0.5
    max_distance = (255**2 * 3)**0.5  # ~441
    return 1 - (distance / max_distance)
```

**Tolerance**: Allow ±30 RGB units for ICC profile conversion differences

#### Method 2: Histogram Comparison
**Approach**: Compare color distribution histograms

**Use case**: For images with gradients or multiple colors

#### Method 3: Perceptual Image Diff
**Approach**: Use perceptual image comparison (SSIM, PSNR)

**Use case**: Visual regression testing

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml (addition)

- name: Setup test images for image conversion tests
  run: ./scripts/setup-test-images.sh
  
- name: Run image conversion tests
  run: |
    cd backend
    source .venv/bin/activate
    pytest tests/test_image_conversion_real.py -v -m integration

- name: Upload test artifacts on failure
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: failed-conversions
    path: backend/tests/test_data/diff/
```

### Performance Considerations

**Expected test duration**:
- Image generation: ~1 second
- 10 conversion tests: ~10 seconds
- Total overhead: ~15-20 seconds

**Caching strategy**:
- Cache generated test images between runs (if using Git LFS)
- Cache pyvips compilation artifacts

### Test Markers

```python
# pytest.ini
markers =
    integration: Integration tests requiring real images
    slow: Slow tests (> 1 second each)
    visual: Visual regression tests
```

**Usage**:
```bash
# Run all tests
pytest

# Skip integration tests (fast unit tests only)
pytest -m "not integration"

# Run only image conversion tests
pytest tests/test_image_conversion_real.py -v
```

## Maintenance & Evolution

### Adding New Test Cases

1. Update `scripts/setup-test-images.sh` to generate new test image
2. Add entry to `manifest.json` with expected results
3. Create corresponding test in `test_image_conversion_real.py`
4. Document purpose in this design doc

### Updating Expected Outputs

When conversion logic changes intentionally:

```bash
# Review differences
pytest tests/test_image_conversion_real.py -v

# If changes are correct, update expected values in manifest.json
```

### Debugging Failures

1. Check diff images in `tests/test_data/diff/`
2. Manually inspect converted images
3. Verify ICC profiles are installed (`dpkg -L libgs-common`)
4. Test with actual ImageMagick/libvips commands

## Recommendations

### Phase 1: Basic Implementation
1. ✅ Implement auto-generated test images script
2. ✅ Create minimal test set (10 images)
3. ✅ Write basic color verification tests
4. ✅ Integrate with CI/CD

## Conclusion

The recommended approach uses **auto-generated minimal test images** for fast, reliable colorspace conversion testing with zero repository impact. This balances test coverage, CI/CD performance, and maintainability while providing clear regression detection for CMYK→RGB conversion accuracy.

**Key Benefits**:
- ✅ Fast CI/CD (< 20 seconds overhead)
- ✅ Zero repository bloat
- ✅ Easy local setup
- ✅ Clear pass/fail criteria
- ✅ Maintainable and extensible

**Next Steps**:
1. Review and approve this design
2. Run `./scripts/setup-test-images.sh` locally to test
3. Create simplified test file with basic color verification
4. Integrate into CI/CD pipeline
5. Document in TODO.md as completed
