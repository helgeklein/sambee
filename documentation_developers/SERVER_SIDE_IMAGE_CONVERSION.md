# Server-Side Image Conversion Implementation

## Overview

Sambee supports previewing a broad range of image formats through server-side conversion. Non-browser-native formats (TIFF, HEIC, BMP, ICO, etc.) are automatically converted to JPEG or PNG on the server before streaming to the client.

For a complete list of supported image formats, see `/documentation/VIEWER_SUPPORT.md`.

## Architecture

### Backend Components

#### 1. Image Converter Service (`app/services/image_converter.py`)

Core service that handles image format detection and conversion.

**Key Functions:**
```python
needs_conversion(filename: str) -> bool
    # Checks if a file needs conversion for browser compatibility

convert_image_to_jpeg(
    image_bytes: bytes,
    filename: str,
    quality: int = 85,
    max_dimension: Optional[int] = None
) -> tuple[bytes, str]
    # Converts image to JPEG/PNG with optional downscaling

is_image_file(filename: str) -> bool
    # Checks if file is a supported image format

get_image_info(image_bytes: bytes) -> dict
    # Extracts image metadata without conversion
```

**Features:**
- Automatic format detection from filename
- HEIC/HEIF support via `pillow-heif`
- Transparency preservation for ICO files (converts to PNG)
- Alpha channel handling (composite on white background for JPEG)
- Configurable JPEG quality (default: 85%)
- Optional downscaling to prevent memory issues (default max: 4096px)
- Grayscale preservation

#### 2. Viewer API Updates (`app/api/viewer.py`)

Enhanced viewer endpoint with automatic conversion:

```python
@router.get("/{connection_id}/file", response_model=None)
async def view_file(...)
    # 1. Check if image needs conversion
    # 2. If yes: read entire file, convert, return Response
    # 3. If no: stream file as-is via StreamingResponse
```

**Error Handling:**
- `501 Not Implemented` - HEIC support missing (libheif not installed)
- `422 Unprocessable Entity` - Image conversion failed
- `500 Internal Server Error` - Unexpected conversion error

### Frontend Components

#### 1. Viewer Registry (`frontend/src/components/Preview/ViewerRegistry.ts`)

Updated to recognize server-converted image MIME types:

```typescript
// MIME type pattern now includes:
/^image\/(png|jpeg|jpg|gif|webp|svg\+xml|tiff|heic|heif|bmp|x-ms-bmp|x-icon|vnd\.microsoft\.icon|x-tiff)$/i

// isImageFile() updated to recognize:
/\.(png|jpe?g|gif|webp|svg|tiff?|heic|heif|bmp|dib|ico|avif)$/i
```

#### 2. File Icons (`frontend/src/utils/fileIcons.tsx`)

Added distinct colors for new image formats:
- TIFF: Dark cyan `#0077b6`
- HEIC: Blue `#0096c7`
- ICO: Light cyan `#48cae4`
- AVIF: Light blue `#90e0ef`

#### 3. Browser MIME Type Fallbacks (`frontend/src/pages/Browser.tsx`)

Extended MIME type mapping for client-side detection:
```typescript
tif: "image/tiff",
tiff: "image/tiff",
heic: "image/heic",
heif: "image/heif",
bmp: "image/bmp",
ico: "image/x-icon",
avif: "image/avif"
```

## Dependencies

### Backend
```
pillow==11.0.0           # Core image processing
pillow-heif==0.20.0      # HEIC/HEIF support
```

### System Libraries (Docker)
```dockerfile
libheif-dev              # HEIC/HEIF codec
libjpeg-dev              # JPEG codec
libpng-dev               # PNG codec
libtiff-dev              # TIFF codec
libwebp-dev              # WebP codec
```

## Configuration

### Conversion Settings

Default settings in `image_converter.py`:
- **JPEG Quality**: 85 (good balance of size and quality)
- **Max Dimension**: 4096px (prevents excessive memory usage)
- **PNG for ICO**: Preserves transparency
- **Alpha Handling**: Composite on white background for JPEG

### Customization

To adjust conversion parameters, modify the call in `viewer.py`:

```python
converted_bytes, converted_mime = convert_image_to_jpeg(
    image_bytes,
    filename,
    quality=90,        # Higher quality (larger files)
    max_dimension=2048,  # Smaller max size
)
```

## Performance Characteristics

### Conversion Times (Estimated)

| File Size | Format | Conversion Time | User Wait Time |
|-----------|--------|-----------------|----------------|
| 3 MB      | HEIC   | 200-500ms       | ~500ms total   |
| 10 MB     | HEIC   | 800ms-1.5s      | ~1.5s total    |
| 5 MB      | TIFF   | 300-700ms       | ~700ms total   |
| 20 MB     | TIFF   | 1.5-3s          | ~3s total      |

### Memory Usage

- **Input**: Full file loaded into memory
- **Processing**: Pillow image object (~3x compressed size for RGB)
- **Output**: Converted JPEG/PNG in memory
- **Peak**: ~4x original file size during conversion

**Mitigation**: `max_dimension=4096` limits peak memory usage

### Server Impact

- **CPU**: Moderate spike during conversion (0.5-3s)
- **Memory**: Proportional to image size (see above)
- **I/O**: Two operations (read from SMB, write to response)

## Error Handling

### Missing HEIC Support

If `pillow-heif` is not installed:
```json
{
  "detail": "Image format not supported: HEIC/HEIF requires additional system libraries"
}
```
**HTTP Status**: 501 Not Implemented

### Corrupted Images

If image data is invalid:
```json
{
  "detail": "Failed to convert image: cannot identify image file"
}
```
**HTTP Status**: 422 Unprocessable Entity

### Timeout Protection

For very large files (>50MB), consider adding timeout in future:
```python
import asyncio

try:
    converted = await asyncio.wait_for(
        convert_image_async(...),
        timeout=10.0
    )
except asyncio.TimeoutError:
    # Fall back to download prompt
```

## Testing

### Backend Tests (`tests/test_image_converter.py`)

22 test cases covering:
- Format detection (TIFF, HEIC, BMP, ICO, etc.)
- RGB/RGBA/Grayscale/Palette mode conversion
- Quality settings
- Downscaling with `max_dimension`
- Transparency handling (ICO → PNG)
- Error handling (invalid data, missing HEIC support)
- Image metadata extraction

**Run tests:**
```bash
cd backend
pytest tests/test_image_converter.py -v
```

### Frontend Tests

Existing tests automatically cover new formats:
- MIME type recognition
- Viewer component loading
- Gallery mode with mixed formats

**Run tests:**
```bash
cd frontend
npm run test
```

## Future Enhancements

### 1. Caching Layer

Add Redis or file-based caching for converted images:
```python
cache_key = f"view:{connection_id}:{path}:{mtime}"
if cached := await cache.get(cache_key):
    return Response(content=cached, media_type="image/jpeg")
```

### 2. Async Conversion

Use background workers for large files:
```python
if file_size > 10_000_000:
    job_id = await queue.enqueue(convert_image, path)
    return {"job_id": job_id, "status": "processing"}
```

### 3. Thumbnail Generation

Generate smaller thumbnails for gallery view:
```python
thumbnail = convert_image_to_jpeg(
    image_bytes,
    filename,
    quality=75,
    max_dimension=800  # Small for grid view
)
```

### 4. Multi-Page TIFF

Support page selection:
```python
page = request.query_params.get("page", 0)
# Extract specific page from multi-page TIFF
```

### 5. Progressive JPEG

Enable progressive encoding for faster perceived loading:
```python
img.save(buffer, format="JPEG", quality=85, optimize=True, progressive=True)
```

### 6. Format Statistics

Log conversion metrics for monitoring:
```python
logger.info(
    "Image conversion metrics",
    format=original_format,
    original_size=len(image_bytes),
    converted_size=len(result),
    compression_ratio=len(image_bytes) / len(result),
    duration_ms=duration_ms
)
```

## Troubleshooting

### HEIC Images Not Working

**Symptom**: 501 error when viewing HEIC files

**Solution**: Ensure libheif is installed in Docker container:
```dockerfile
RUN apt-get update && apt-get install -y libheif-dev
```

### Slow Conversion

**Symptom**: Viewing takes >5 seconds

**Possible Causes**:
1. Very large images (>50MB)
2. Slow SMB connection
3. Limited server CPU

**Solutions**:
- Reduce `max_dimension` to 2048 or 1024
- Lower JPEG quality to 75
- Add caching layer
- Use async conversion queue

### Out of Memory

**Symptom**: Server crashes or 500 errors

**Cause**: Multiple large images being converted simultaneously

**Solutions**:
- Reduce `max_dimension`
- Add rate limiting on viewer endpoint
- Increase server memory
- Implement conversion queue with concurrency limit

## Migration Notes

### Existing Installations

No database migrations required. Changes are backward-compatible:
- Browser-native formats continue to stream directly
- New formats are automatically detected and converted
- Frontend gracefully handles both old and new MIME types

### Docker Rebuild Required

After updating, rebuild Docker image to install new dependencies:
```bash
docker-compose build
docker-compose up -d
```

### Development Setup

Install new Python packages:
```bash
cd backend
pip install pillow pillow-heif
```

Install system libraries (Ubuntu/Debian):
```bash
sudo apt-get install -y libheif-dev libjpeg-dev libpng-dev libtiff-dev
```

## Security Considerations

### Image Bomb Protection

Pillow has built-in protection against decompression bombs, but enforce limits:
```python
from PIL import Image
Image.MAX_IMAGE_PIXELS = 178_956_970  # ~4096 x 4096 x 10 layers
```

### Memory Limits

Set `max_dimension` conservatively to prevent memory exhaustion attacks.

### MIME Type Validation

Server validates MIME type from file extension, not relying on client input.

### Conversion Timeout

Consider adding timeout for conversion operations to prevent DoS.

## License Implications

### Pillow (PIL)
- License: HPND (Historical Permission Notice and Disclaimer)
- Commercial use: ✅ Allowed
- Attribution: Not required

### pillow-heif
- License: LGPL-3.0 / custom (depends on libheif build)
- Commercial use: ✅ Allowed (with LGPL compliance)
- Attribution: Recommended

### libheif
- License: LGPL-3.0
- Commercial use: ✅ Allowed
- Distribution: Must provide LGPL notice and source code access for libheif

**Note**: HEIC format itself may have patent licensing requirements in some jurisdictions.

## References

- [Pillow Documentation](https://pillow.readthedocs.io/)
- [pillow-heif GitHub](https://github.com/bigcat88/pillow_heif)
- [HEIF Format Specification](https://nokiatech.github.io/heif/)
- [TIFF Format Specification](https://www.adobe.io/content/dam/udp/en/open/standards/tiff/TIFF6.pdf)
