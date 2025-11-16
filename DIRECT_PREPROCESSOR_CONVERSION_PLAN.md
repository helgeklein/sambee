# Plan: Direct Preprocessor to Target Format Conversion

## Current Architecture Analysis

### Current Flow (Inefficient - Double Conversion)
```
PSD file → ImageMagick → PNG (temp) → libvips → JPEG/PNG (final) → Browser
           [Preprocessor]              [image_converter.py]
```

**Problems:**
1. **Double conversion**: ImageMagick converts PSD→PNG, then libvips converts PNG→JPEG
2. **Wasted I/O**: Intermediate PNG written to disk, then read back
3. **Wasted CPU**: PNG compression/decompression is unnecessary overhead
4. **Quality loss**: Each conversion step can introduce artifacts

### Proposed Flow (Efficient - Direct Conversion)
```
PSD file → ImageMagick → JPEG/PNG (final) → Browser
           [Preprocessor with target format awareness]
```

**Benefits:**
1. **Single conversion**: ImageMagick directly outputs browser-ready format
2. **Reduced I/O**: No intermediate file, direct to final format
3. **Lower CPU**: Skip unnecessary PNG encoding/decoding
4. **Better quality**: One conversion step = less quality degradation
5. **Faster**: Approximately 30-50% time savings expected

---

## Current Settings Audit

### Conversion Settings Locations (Before - Scattered)

1. **preprocessor.py - ImageMagickPreprocessor**
   - Hardcoded: `quality = "85"` (line 394)
   - Hardcoded: Output format = "png" (default parameter)

2. **preprocessor.py - GraphicsMagickPreprocessor**
   - Hardcoded: `quality = "85"` (line ~219)
   - Hardcoded: Output format = "png" (default parameter)

3. **image_converter.py - convert_image_to_jpeg()**
   - Parameter: `quality: int = 85` (line 53)
   - Hardcoded: `Q=quality` for JPEG (line 173)
   - Hardcoded: `optimize_coding=True` (line 174)
   - Hardcoded: `compression=6` for PNG (line 180)
   - Hardcoded: `keep=0` for metadata removal (lines 176, 181)

4. **preview.py - API endpoint**
   - Hardcoded: `quality=85` when calling convert_image_to_jpeg (line 116)

**Problem**: Settings duplicated in 4 different places!

---

## Solution Design

### 1. Create Centralized Configuration (Single Source of Truth)

**New file**: `backend/app/core/image_settings.py`

```python
"""
Single source of truth for all image conversion settings.

These settings apply to both:
- Direct conversions (libvips)
- Preprocessed conversions (ImageMagick/GraphicsMagick → target format)
"""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class ImageConversionSettings:
    """Image conversion settings for browser delivery."""
    
    # JPEG settings
    jpeg_quality: int = 85  # 1-100, balance quality vs file size
    jpeg_optimize_coding: bool = True  # Optimize Huffman tables
    jpeg_progressive: bool = False  # Standard (not progressive) JPEG
    
    # PNG settings
    png_compression: int = 6  # 0-9, balance speed vs compression
    
    # Common settings
    strip_metadata: bool = True  # Remove EXIF/IPTC for privacy & size
    color_space: str = "srgb"  # Web standard color space
    
    # Alpha channel handling
    jpeg_background: tuple[int, int, int] = (255, 255, 255)  # White


# Single instance - import this everywhere
IMAGE_SETTINGS = ImageConversionSettings()


def get_imagemagick_jpeg_args(settings: ImageConversionSettings = IMAGE_SETTINGS) -> list[str]:
    """
    Get ImageMagick command arguments for JPEG output.
    
    Returns:
        List of command arguments (e.g., ['-quality', '85', '-strip'])
    """
    args = [
        "-quality", str(settings.jpeg_quality),
    ]
    if settings.strip_metadata:
        args.append("-strip")
    return args


def get_imagemagick_png_args(settings: ImageConversionSettings = IMAGE_SETTINGS) -> list[str]:
    """
    Get ImageMagick command arguments for PNG output.
    
    Returns:
        List of command arguments (e.g., ['-quality', '92', '-strip'])
    """
    args = [
        # PNG quality in ImageMagick: compression level (0-100 maps to zlib 0-9)
        # 92 = zlib level 6 (our default)
        "-quality", "92",
    ]
    if settings.strip_metadata:
        args.append("-strip")
    return args


def get_libvips_jpeg_kwargs(settings: ImageConversionSettings = IMAGE_SETTINGS) -> dict:
    """
    Get libvips jpegsave_buffer() keyword arguments.
    
    Returns:
        Dict of kwargs for pyvips image.jpegsave_buffer()
    """
    return {
        "Q": settings.jpeg_quality,
        "optimize_coding": settings.jpeg_optimize_coding,
        "keep": 0 if settings.strip_metadata else 1,  # VIPS_FOREIGN_KEEP_NONE
        "interlace": settings.jpeg_progressive,
    }


def get_libvips_png_kwargs(settings: ImageConversionSettings = IMAGE_SETTINGS) -> dict:
    """
    Get libvips pngsave_buffer() keyword arguments.
    
    Returns:
        Dict of kwargs for pyvips image.pngsave_buffer()
    """
    return {
        "compression": settings.png_compression,
        "keep": 0 if settings.strip_metadata else 1,  # VIPS_FOREIGN_KEEP_NONE
    }
```

### 2. Update Preprocessor Interface

**Changes to `backend/app/services/preprocessor.py`:**

```python
# Add to imports
from app.core.image_settings import (
    IMAGE_SETTINGS,
    get_imagemagick_jpeg_args,
    get_imagemagick_png_args,
)

class PreprocessorInterface(ABC):
    """Abstract base class for image preprocessors."""
    
    @abstractmethod
    def convert_to_final_format(
        self, 
        input_path: Path, 
        output_format: str = "jpeg"
    ) -> Path:
        """
        Convert exotic format directly to browser-ready final format.
        
        Always applies browser-optimized settings from IMAGE_SETTINGS.
        
        Args:
            input_path: Path to input file
            output_format: Target format (png, jpeg)
        
        Returns:
            Path to browser-ready output file
        """
        pass
```

### 3. Update ImageMagickPreprocessor

**Key changes:**
- Rename method to `convert_to_final_format`
- Always use centralized settings
- Build command with settings helpers

```python
def convert_to_final_format(
    self, 
    input_path: Path, 
    output_format: str = "jpeg"
) -> Path:
    """Convert PSD/PSB directly to browser-ready format using ImageMagick."""
    
    # ... validation code stays same ...
    
    # Build ImageMagick command
    command = [
        command_name,
        f"{input_path}[0]",  # Input file
        "-flatten",          # Flatten layers
    ]
    
    # Add browser-optimized settings from centralized config
    if output_format in {"jpeg", "jpg"}:
        command.extend(get_imagemagick_jpeg_args())
    elif output_format == "png":
        command.extend(get_imagemagick_png_args())
    
    command.append(str(output_path))
    
    # ... execution code stays same ...
```

### 4. Update GraphicsMagickPreprocessor

**Same pattern as ImageMagick:**
- Rename method to `convert_to_final_format`
- Always use centralized settings
- Note: GraphicsMagick has slightly different syntax but same concept

### 5. Update image_converter.py

**Simplified approach - direct conversion for preprocessed files:**

```python
def convert_image_to_jpeg(
    image_bytes: bytes,
    filename: str,
    max_dimension: Optional[int] = None,
) -> tuple[bytes, str]:
    """Convert image to browser-ready format."""
    
    extension = f".{filename.lower().rsplit('.', 1)[-1]}" if "." in filename else ""
    needs_preprocessing = PreprocessorRegistry.requires_preprocessing(extension)
    
    if needs_preprocessing:
        # Direct conversion to final format - NO libvips needed!
        
        # Determine target format (PSD/PSB don't have alpha, always JPEG)
        target_format = "jpeg"
        
        # Save to temp file
        fd, temp_input = tempfile.mkstemp(suffix=extension, prefix="sambee_input_")
        os.write(fd, image_bytes)
        os.close(fd)
        temp_input_path = Path(temp_input)
        
        try:
            # Get preprocessor
            preprocessor = PreprocessorRegistry.get_preprocessor_for_format(extension)
            
            # Convert DIRECTLY to final browser-ready format
            output_file = preprocessor.convert_to_final_format(
                temp_input_path,
                output_format=target_format
            )
            
            # Read final bytes
            with open(output_file, "rb") as f:
                result_bytes = f.read()
            
            # Cleanup
            temp_input_path.unlink()
            output_file.unlink()
            
            mime_type = f"image/{target_format}"
            
            logger.info(
                f"Direct conversion: {filename} → {mime_type} "
                f"({len(image_bytes) / 1024:.0f} → {len(result_bytes) / 1024:.0f} KB)"
            )
            
            return result_bytes, mime_type
            
        except Exception:
            # Cleanup and re-raise
            if temp_input_path.exists():
                temp_input_path.unlink()
            raise
    
    # libvips path for non-preprocessed files
    # Updated to use IMAGE_SETTINGS
```

**Note on resizing:**
- If `max_dimension` is provided for a PSD/PSB file, we can add ImageMagick resize arguments
- Or fall back to libvips path (convert to intermediate, then resize with libvips)
- Start simple: ignore resizing for preprocessed files in v1, add later if needed

### 6. Update preview.py

**Remove quality parameter:**

```python
# No import needed - settings used internally

# Later in code:
converted_bytes, converted_mime = convert_image_to_jpeg(
    image_bytes,
    filename,
    # No quality parameter - uses IMAGE_SETTINGS automatically
)
```

---

## Implementation Steps

### Phase 1: Setup (No Breaking Changes)
1. ✅ Create `backend/app/core/image_settings.py`
2. ✅ Add comprehensive unit tests for settings helpers
3. ✅ Update imports in existing files (passive - just importing)

### Phase 2: Update Preprocessors
4. ✅ Update `PreprocessorInterface` - rename to `convert_to_final_format()`
5. ✅ Update `ImageMagickPreprocessor.convert_to_final_format()`
   - Rename method from `convert_to_intermediate()`
   - Use settings helpers for command building
   - Always apply browser-optimized settings
6. ✅ Update `GraphicsMagickPreprocessor.convert_to_final_format()`
   - Same changes as ImageMagick
7. ✅ Update preprocessor tests to use new method name

### Phase 3: Update image_converter.py
8. ✅ Implement direct conversion path for preprocessed files
9. ✅ Update libvips path to use `IMAGE_SETTINGS`
10. ✅ Add integration tests comparing old vs new flow

### Phase 4: Update API Layer
11. ✅ Remove quality parameter from `preview.py`
12. ✅ Run end-to-end tests

### Phase 5: Validation & Documentation
13. ✅ Performance benchmarks (old vs new)
14. ✅ Update documentation
15. ✅ Add migration notes

---

## Testing Strategy

### Unit Tests

**test_image_settings.py** (NEW)
```python
def test_jpeg_args_default():
    """Verify default JPEG arguments."""
    args = get_imagemagick_jpeg_args()
    assert "-quality" in args
    assert "85" in args
    assert "-strip" in args

def test_png_args_default():
    """Verify default PNG arguments."""
    args = get_imagemagick_png_args()
    assert "-quality" in args
    assert "92" in args  # Maps to compression 6
```

**test_preprocessor.py** (UPDATE)
```python
def test_imagemagick_final_format_jpeg():
    """ImageMagick should apply browser settings for JPEG output."""
    preprocessor = ImageMagickPreprocessor()
    # Test convert_to_final_format()
    # Verify -quality 85 -strip present in command

def test_imagemagick_final_format_png():
    """ImageMagick should apply browser settings for PNG output."""
    preprocessor = ImageMagickPreprocessor()
    # Test convert_to_final_format()
    # Verify PNG quality settings present
```

**test_image_converter.py** (UPDATE)
```python
def test_direct_psd_conversion():
    """PSD should convert directly to JPEG without libvips."""
    # Load sample PSD
    # Call convert_image_to_jpeg(psd_bytes, "test.psd")
    # Verify result is valid JPEG
    # Verify settings from IMAGE_SETTINGS were applied
    # Verify no intermediate file was created
```

### Integration Tests

**test_e2e_scenarios.py** (UPDATE)
```python
def test_psd_preview_performance():
    """Measure PSD preview generation time."""
    # Test both old and new flow
    # Verify new flow is faster
    # Verify output quality is acceptable
```

### Performance Benchmarks

Run with real PSD files:
- Small PSD (5 MB)
- Medium PSD (20 MB)
- Large PSD (100 MB)

Measure:
- Total conversion time
- Memory usage
- Output file size
- Visual quality (SSIM comparison)

Expected improvements:
- **Time**: 30-50% faster
- **Memory**: 20-30% less peak usage
- **Quality**: Same or better (fewer conversion steps)

---

## Breaking Changes (No Backward Compatibility Required)

### API Changes
- ❌ `convert_image_to_jpeg()` signature simplified
  - **REMOVED**: `quality` parameter (now uses IMAGE_SETTINGS)
  - Callers must update to remove quality argument
  
### Internal Changes
- ❌ `convert_to_intermediate()` method renamed to `convert_to_final_format()`
  - All internal calls must be updated
  - Always outputs browser-ready format (no intermediate mode)

### Benefits of Breaking Changes
- ✅ Simpler, cleaner API
- ✅ No confusion about intermediate vs final
- ✅ Single code path to maintain
- ✅ Settings always centralized

### Configuration
- ✅ Settings in code (IMAGE_SETTINGS)
- ✅ Optional: Add environment variable override later if needed

---

## Rollout Plan

### Development
1. Implement all changes atomically
2. Update all tests
3. Verify performance improvements
4. Deploy directly (no feature flag needed - breaking changes acceptable)

### Monitoring
- Add metrics for:
  - Conversion duration (before/after)
  - Error rates
  - Output file sizes
  - Memory usage

### Rollback Strategy
- Git revert if critical issues found
- Atomic commits make rollback clean
- All changes in single branch for easy revert

---

## Documentation Updates

### Developer Docs
- Update `PREPROCESSOR_REGISTRY.md`
- Add `IMAGE_SETTINGS.md` with configuration guide
- Update architecture diagrams

### Code Comments
- Add docstrings explaining `target_is_final` parameter
- Document settings in `image_settings.py`

---

## Security Considerations

### No New Attack Surface
- Same ImageMagick commands, just different flags
- Still validating input formats
- Still timeout protection
- Still file size limits

### Metadata Stripping
- `-strip` flag removes EXIF/IPTC
- Privacy benefit: no GPS, camera info leaked
- Size benefit: smaller files

---

## Alternative Approaches Considered

### Alternative 1: Always use libvips
**Rejected**: libvips doesn't support PSD natively, that's why we have preprocessors

### Alternative 2: Keep double conversion
**Rejected**: Inefficient, wastes resources

### Alternative 3: Maintain backward compatibility
**Rejected**: User confirmed not needed, simplifies implementation

### Alternative 4: Use environment variables for all settings
**Rejected**: Code-based defaults are clearer, easier to test

---

## Success Criteria

1. ✅ All tests updated and passing
2. ✅ Direct conversion implemented and tested
3. ✅ Performance improvement: 30%+ faster for PSD files
4. ✅ Memory improvement: 20%+ less peak usage
5. ✅ No quality degradation (SSIM ≥ 0.98)
6. ✅ Single source of truth for settings
7. ✅ Cleaner, simpler API (no backward compatibility baggage)

---

## Timeline Estimate

- **Phase 1** (Setup): 1.5 hours
- **Phase 2** (Preprocessors): 2 hours (simpler without backward compat)
- **Phase 3** (image_converter): 2 hours (simpler API)
- **Phase 4** (API layer): 0.5 hours (just remove parameter)
- **Phase 5** (Validation): 1.5 hours

**Total**: ~7.5 hours of development + testing (reduced from 11 hours)

---

## Risk Assessment

### Low Risk
- ✅ Breaking changes acceptable (confirmed by user)
- ✅ Well-defined scope
- ✅ Comprehensive test coverage
- ✅ Easy rollback via git revert

### Medium Risk
- ⚠️ ImageMagick version differences (v6 vs v7)
  - **Mitigation**: Already handling this in `_get_command()`
- ⚠️ GraphicsMagick syntax differences
  - **Mitigation**: Test with both tools

### No High Risks Identified

---

## Questions to Resolve

1. **Q**: Should we support WebP output format in future?
   - **A**: Yes, design allows easy addition via `get_imagemagick_webp_args()`

2. **Q**: What if user wants different quality settings?
   - **A**: Can add to ImageConversionSettings or expose in API

3. **Q**: Handle resizing in ImageMagick vs libvips?
   - **A**: Start simple - if `max_dimension` provided, use libvips path
            Later optimization: add resize to ImageMagick command

---

## Conclusion

This plan provides:
- ✅ **Single source of truth** for conversion settings
- ✅ **Significant performance improvement** (30-50% faster)
- ✅ **Reduced complexity** (one conversion step instead of two)
- ✅ **Simpler API** (no backward compatibility overhead)
- ✅ **Easy maintenance** (centralized configuration)
- ✅ **Better quality** (fewer conversion steps)
- ✅ **Faster implementation** (~7.5 hours vs 11 hours)

**Key Simplifications from No Backward Compatibility:**
- Method renamed: `convert_to_intermediate()` → `convert_to_final_format()`
- Always browser-optimized (no intermediate mode)
- Quality parameter removed from API
- Single code path (no feature flags)

**Recommendation**: Proceed with implementation following the phased approach.
