# Image Preprocessing Architecture

This document describes the preprocessing system used to handle image formats that libvips cannot process natively (e.g., PSD, PSB).

## Overview

**Design Philosophy**: Use libvips for everything it can handle natively. Only preprocess when absolutely necessary.

The preprocessor acts as a bridge between external conversion tools (GraphicsMagick, ImageMagick) and our libvips-based image conversion pipeline.

```
┌─────────────┐
│ PSD/PSB File│
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│   Preprocessor      │ GraphicsMagick/ImageMagick
│   (if needed)       │ Converts to PNG/TIFF
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│   libvips           │ Standard conversion pipeline
│   Converter         │ PNG/TIFF → JPEG/PNG
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ Browser-ready Image │
└─────────────────────┘
```

## Architecture

### Components

#### 1. PreprocessorInterface (Abstract Base Class)
- Defines the contract all preprocessors must follow
- Provides common validation and temp file handling
- Enforces max file size (100MB) and timeout (30s) limits

**Key Methods**:
- `convert_to_intermediate(input_path, output_format)` - Main conversion method
- `check_availability()` - Verify tool is installed
- `validate_input(input_path)` - Security and sanity checks

#### 2. GraphicsMagickPreprocessor
**Recommended preprocessor** for PSD/PSB files.

**Advantages**:
- 2-3x faster than ImageMagick for typical PSD files
- ~50% lower memory usage (150MB vs 300MB for 10MB PSD)
- Smaller attack surface (simpler, more focused tool)
- More stable command-line interface

**Supported Formats**: PSD, PSB

**Command**:
```bash
gm convert -flatten -quality 85 input.psd[0] output.png
```

#### 3. ImageMagickPreprocessor
**Fallback preprocessor** for complex PSD files or when GraphicsMagick is unavailable.

**Advantages**:
- Better support for complex PSD features (adjustment layers, smart objects)
- More actively maintained
- Better font rendering

**Disadvantages**:
- Slower (2-3x) than GraphicsMagick
- Higher memory usage
- Larger attack surface (more CVEs historically)

**Supported Formats**: PSD, PSB

**Command** (v7):
```bash
magick -flatten -quality 85 input.psd[0] output.png
```

**Command** (v6):
```bash
convert -flatten -quality 85 input.psd[0] output.png
```

#### 4. PreprocessorFactory
Creates preprocessor instances based on configuration.

**Configuration** (via `PREPROCESSOR` environment variable):
- `"auto"` (default): Auto-detect, prefers GraphicsMagick → ImageMagick
- `"graphicsmagick"`: Use GraphicsMagick only (fails if not installed)
- `"imagemagick"`: Use ImageMagick only (fails if not installed)

**Usage**:
```python
preprocessor = PreprocessorFactory.create()  # Auto-detect
preprocessor = PreprocessorFactory.create("graphicsmagick")  # Explicit
```

### Integration with Image Converter

The preprocessing is integrated directly into `convert_image_to_jpeg()`:

```python
def convert_image_to_jpeg(image_bytes, filename, quality=85, max_dimension=None):
    extension = get_extension(filename)
    
    # Check if preprocessing needed (PSD/PSB)
    if extension in {'psd', 'psb'}:
        # Save to temp file
        temp_input = write_temp_file(image_bytes, extension)
        
        # Preprocess to PNG
        preprocessor = PreprocessorFactory.create()
        temp_png = preprocessor.convert_to_intermediate(temp_input)
        
        # Read preprocessed PNG
        image_bytes = read_file(temp_png)
        
        # Cleanup temp files
        cleanup(temp_input, temp_png)
    
    # Standard libvips processing
    vips_image = pyvips.Image.new_from_buffer(image_bytes, "")
    # ... rest of conversion pipeline
```

**Key Points**:
- Preprocessing is transparent to the caller
- Temp files are cleaned up in a `finally` block
- Errors are caught and re-raised as `ValueError` with clear messages
- Logging tracks preprocessing operations

## Security Considerations

### Input Validation
All preprocessors validate:
1. **File exists**: Prevents path traversal
2. **File size**: Max 100MB (prevents DoS)
3. **Extension**: Only supported formats (prevents abuse)

### Subprocess Execution
- **Timeout**: 30 seconds max (prevents hangs)
- **No shell**: Uses `subprocess.run()` with list arguments (prevents injection)
- **Error capture**: stderr captured for debugging, not exposed to users
- **Path sanitization**: Uses `Path` objects, not string concatenation

### Temporary Files
- **Secure creation**: Uses `tempfile.mkstemp()` with restrictive permissions
- **Cleanup**: Always cleaned up in `finally` blocks
- **Unique names**: Prevents race conditions

## Performance

### Benchmarks (10MB PSD file)

| Tool              | Time  | Memory | Output Size |
|-------------------|-------|--------|-------------|
| GraphicsMagick    | 1-2s  | 150MB  | 2.1MB PNG   |
| ImageMagick 7     | 2-3s  | 300MB  | 2.1MB PNG   |

### Optimization Strategies
1. **Lazy preprocessing**: Only preprocess when absolutely needed
2. **Streaming**: Use temp files, not in-memory buffers
3. **Caching**: Consider caching preprocessed results (future enhancement)
4. **Format selection**: PNG for intermediate (better quality, universal support)

## Error Handling

### Error Types
- `FileNotFoundError`: Input file doesn't exist
- `ValueError`: Invalid input (size, format, corrupt data)
- `PreprocessorError`: Tool unavailable or conversion failed
- `ImportError`: Required tool not installed (raised by factory)

### Error Messages
All errors include actionable information:
```python
# Tool not available
"GraphicsMagick is not installed or not accessible. Install with: apt-get install graphicsmagick"

# Timeout
"Conversion timed out after 30 seconds. File may be too complex or corrupted."

# Conversion failure
"GraphicsMagick conversion failed: unable to open image: `test.psd'"
```

## Adding New Preprocessor Tools

To add support for a new tool (e.g., Ghostscript for PDF):

1. **Create preprocessor class**:
```python
class GhostscriptPreprocessor(PreprocessorInterface):
    SUPPORTED_FORMATS = {"pdf", "eps", "ps"}
    
    def check_availability(self) -> bool:
        # Check if gs command exists
        ...
    
    def convert_to_intermediate(self, input_path, output_format="png"):
        # Run gs command
        ...
```

2. **Update factory**:
```python
elif preprocessor_type == "ghostscript":
    gs = GhostscriptPreprocessor()
    if not gs.check_availability():
        raise PreprocessorError("Ghostscript not available")
    return gs
```

3. **Update Dockerfile**:
```dockerfile
RUN apt-get install -y ghostscript
```

4. **Update image converter**:
```python
needs_preprocessing = extension.lstrip('.') in {'psd', 'psb', 'pdf', 'eps'}
```

5. **Add tests**:
```python
class TestGhostscriptPreprocessor:
    def test_convert_pdf_to_png(self):
        ...
```

## Testing

### Unit Tests
See `tests/test_preprocessor.py` for comprehensive test coverage:
- Tool availability detection
- Input validation
- Successful conversions
- Error handling (missing tool, corrupt file, timeout)
- Temp file cleanup
- Factory auto-detection

### Manual Testing
```bash
# Test with real PSD file
cd backend
python -c "
from app.services.preprocessor import PreprocessorFactory
from pathlib import Path

preprocessor = PreprocessorFactory.create()
output = preprocessor.convert_to_intermediate(Path('test.psd'))
print(f'Created: {output}')
"
```

## Future Enhancements

### Potential Improvements
1. **Caching**: Cache preprocessed results to avoid repeated conversions
2. **Format detection**: Auto-detect format from magic bytes, not just extension
3. **Layer selection**: Allow selecting specific PSD layers
4. **Progress tracking**: Report progress for large files
5. **Parallel processing**: Preprocess multiple files concurrently
6. **Quality control**: Verify output quality (e.g., resolution, color depth)

### Additional Formats
Consider adding preprocessors for:
- **PDF/AI/EPS**: Ghostscript (vector graphics)
- **RAW**: dcraw, LibRaw (camera raw formats)
- **DNG**: Adobe DNG Converter
- **SVG**: librsvg (if better quality needed than libvips)

## Troubleshooting

### Problem: "GraphicsMagick is not installed"
**Solution**: Install GraphicsMagick
```bash
apt-get install graphicsmagick
```

### Problem: "Conversion timed out after 30 seconds"
**Possible causes**:
1. File is extremely complex (many layers, effects)
2. File is corrupted
3. System is under heavy load

**Solutions**:
- Increase timeout: Modify `TIMEOUT_SECONDS` in preprocessor
- Simplify PSD: Flatten layers in Photoshop before saving
- Check file integrity: Try opening in Photoshop

### Problem: "GraphicsMagick conversion failed"
**Debugging steps**:
1. Check logs for detailed error message
2. Try manual conversion: `gm convert test.psd test.png`
3. Verify file is valid PSD: `file test.psd`
4. Check GraphicsMagick version: `gm version`

### Problem: Preprocessed images have wrong colors
**Possible causes**:
- Color space conversion issue
- Missing color profile

**Solutions**:
- Ensure color profiles are embedded in PSD
- Use `-colorspace sRGB` flag in conversion command
- Verify output with: `identify -verbose output.png | grep Colorspace`

## Configuration Reference

### Environment Variables
- `PREPROCESSOR`: Tool selection (`auto`, `graphicsmagick`, `imagemagick`)

### Preprocessor Settings
- `MAX_FILE_SIZE`: 100MB (100 * 1024 * 1024 bytes)
- `TIMEOUT_SECONDS`: 30 seconds
- `SUPPORTED_FORMATS`: `{"psd", "psb"}`

### Conversion Parameters
- **Format**: PNG (intermediate format)
- **Quality**: 85 (JPEG quality when PNG converted to JPEG)
- **Flatten**: Yes (merge all layers)
- **Layer**: `[0]` (composite/flattened layer)

## References

### GraphicsMagick
- Homepage: http://www.graphicsmagick.org/
- Documentation: http://www.graphicsmagick.org/convert.html
- PSD Support: http://www.graphicsmagick.org/formats.html#PSD

### ImageMagick
- Homepage: https://imagemagick.org/
- Documentation: https://imagemagick.org/script/convert.php
- PSD Support: https://imagemagick.org/script/formats.php#PSD

### Related Documentation
- [Adding New File Types](ADDING_NEW_FILE_TYPES.md)
- [Server-Side Image Conversion](SERVER_SIDE_IMAGE_CONVERSION.md)
- [File Type Registry (Backend)](FILE_TYPE_REGISTRY_BACKEND.md)
