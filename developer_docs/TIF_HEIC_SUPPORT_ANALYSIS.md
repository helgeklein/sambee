# TIF and HEIC Image Support Analysis

## Overview

Analysis of different approaches to add TIF (TIFF) and HEIC (HEIF) image preview support to Sambee.

---

## Format Background

### TIFF (Tagged Image File Format)
- **Extensions**: `.tif`, `.tiff`
- **MIME Types**: `image/tiff`, `image/tiff-fx`
- **Use Cases**: Professional photography, scanning, medical imaging, GIS
- **Characteristics**: 
  - Lossless compression options
  - Supports multiple pages/layers
  - Large file sizes (often 10-100+ MB)
  - High color depth (8/16/32-bit per channel)
  - Metadata-rich (EXIF, IPTC, XMP)

### HEIC (High Efficiency Image Container)
- **Extensions**: `.heic`, `.heif`
- **MIME Types**: `image/heic`, `image/heif`
- **Use Cases**: iPhone/iOS photos (default since iOS 11), modern cameras
- **Characteristics**:
  - Superior compression vs JPEG (50% smaller at same quality)
  - Supports HDR, transparency, animations
  - 10-bit color depth
  - Proprietary codec concerns (licensing)

---

## Browser Native Support

### Current State (2025)

| Browser | TIFF Support | HEIC Support |
|---------|-------------|--------------|
| **Chrome/Edge** | ❌ No | ❌ No |
| **Firefox** | ❌ No | ❌ No |
| **Safari (macOS)** | ✅ Yes | ✅ Yes (macOS 11+, iOS 11+) |
| **Safari (iOS)** | ✅ Yes | ✅ Yes |

**Key Insights:**
- Safari has native support for both formats (Apple ecosystem)
- Chrome/Firefox require JavaScript libraries for decoding
- No Web Standard for HEIC (patent/licensing issues)
- TIFF has limited adoption despite being an older format

---

## Approach 1: Client-Side Conversion (JavaScript Libraries)

### Implementation

Convert TIFF/HEIC to browser-compatible formats (PNG/JPEG) in the frontend using JavaScript libraries.

### Libraries

#### For TIFF:
- **tiff.js** (https://github.com/seikichi/tiff.js)
  - Size: ~45 KB minified
  - Pure JavaScript, no dependencies
  - Converts TIFF → Canvas → Blob URL
  
- **geotiff.js** (https://github.com/geotiffjs/geotiff.js)
  - Size: ~200 KB minified
  - Advanced: Supports GeoTIFF, COG (Cloud Optimized GeoTIFF)
  - Overkill for basic photo viewing

#### For HEIC:
- **heic2any** (https://github.com/alexcorvi/heic2any)
  - Size: ~650 KB minified (includes WASM decoder)
  - Converts HEIC → PNG/JPEG Blob
  - Uses libheif compiled to WebAssembly
  - Most popular option (1.3M weekly downloads on npm)

- **heic-decode** (https://github.com/catdad-experiments/heic-decode)
  - Size: ~1.2 MB (WASM heavy)
  - Lower-level control
  - Better for batch processing

### Pros ✅
1. **Works everywhere**: Consistent behavior across all browsers
2. **No server changes**: Backend just streams the file as-is
3. **Client-side processing**: Offloads work from server
4. **Existing architecture**: Fits current blob-based preview system
5. **Progressive enhancement**: Can detect browser support and skip conversion in Safari

### Cons ❌
1. **Large bundle size**: 
   - TIFF: +45 KB
   - HEIC: +650 KB (or +1.2 MB for heic-decode)
   - Total: ~700 KB added to bundle
2. **CPU intensive**: Decoding large TIFFs/HEICs can freeze UI on slower devices
3. **Memory usage**: Large images require significant RAM during conversion
4. **Conversion time**: 2-10 seconds for large files (poor UX)
5. **Mobile performance**: Especially problematic on phones (common HEIC source)
6. **Multi-page TIFF**: Complex to handle (which page to show?)
7. **License concerns**: HEIC libraries use libheif (LGPL or custom licenses)

### Example Implementation

```typescript
// In ImagePreview.tsx - after fetching blob
import UTIF from 'tiff.js';
import heic2any from 'heic2any';

// Detect if conversion needed
const needsConversion = /\.(tiff?|heic?)$/i.test(filename);
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

if (needsConversion && !isSafari) {
  if (/\.tiff?$/i.test(filename)) {
    // TIFF conversion
    const arrayBuffer = await blob.arrayBuffer();
    const ifds = UTIF.decode(arrayBuffer);
    UTIF.decodeImage(arrayBuffer, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    
    const canvas = document.createElement('canvas');
    canvas.width = ifds[0].width;
    canvas.height = ifds[0].height;
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(
      new Uint8ClampedArray(rgba), 
      ifds[0].width, 
      ifds[0].height
    );
    ctx.putImageData(imageData, 0, 0);
    
    convertedBlob = await new Promise(resolve => 
      canvas.toBlob(resolve, 'image/png')
    );
  } else if (/\.heic?$/i.test(filename)) {
    // HEIC conversion
    convertedBlob = await heic2any({
      blob: originalBlob,
      toType: 'image/jpeg',
      quality: 0.9
    });
  }
}
```

---

## Approach 2: Server-Side Conversion (Python Libraries)

### Implementation

Convert TIFF/HEIC to JPEG/PNG on the backend before streaming to frontend.

### Libraries

#### For TIFF:
- **Pillow (PIL)** - Built-in TIFF support
  ```python
  from PIL import Image
  
  with Image.open(tiff_path) as img:
      # Convert to RGB if necessary
      if img.mode != 'RGB':
          img = img.convert('RGB')
      # Save as JPEG to BytesIO
      buffer = io.BytesIO()
      img.save(buffer, format='JPEG', quality=85)
  ```

#### For HEIC:
- **pillow-heif** (https://github.com/bigcat88/pillow_heif)
  - Pillow plugin for HEIF/HEIC
  - Requires libheif system library
  - Installation: `pip install pillow-heif`
  
  ```python
  from pillow_heif import register_heif_opener
  from PIL import Image
  
  register_heif_opener()  # Enable HEIC support in Pillow
  
  with Image.open(heic_path) as img:
      buffer = io.BytesIO()
      img.save(buffer, format='JPEG', quality=85)
  ```

### Pros ✅
1. **Zero bundle impact**: No frontend size increase
2. **Fast for users**: Server does the heavy lifting
3. **Better mobile UX**: Critical for HEIC (iPhone photos)
4. **Caching potential**: Can cache converted images
5. **Consistent quality**: Controlled conversion settings
6. **Better for large files**: Server has more resources than mobile devices
7. **Simpler frontend**: Just update MIME type regex
8. **Multi-page handling**: Server can extract specific page or create thumbnails

### Cons ❌
1. **Server dependency**: Requires libheif system library installation
2. **Increased server load**: CPU/memory usage on backend
3. **Conversion latency**: Adds 500ms-3s delay to first load
4. **Storage concerns**: If caching conversions
5. **Docker complexity**: Need to install libheif in container
6. **Streaming complexity**: Can't stream while converting (must convert first)
7. **Lossy conversion**: Original quality lost in JPEG conversion

### Dockerfile Changes Required

```dockerfile
# Install libheif for HEIC support
RUN apt-get update && apt-get install -y \
    libheif-dev \
    && rm -rf /var/lib/apt/lists/*

# Python requirements.txt
pillow-heif>=0.18.0
```

### Backend Implementation

```python
# In preview.py
from PIL import Image
from pillow_heif import register_heif_opener
import io

register_heif_opener()

def should_convert_image(filename: str) -> bool:
    """Check if image needs server-side conversion"""
    return bool(re.search(r'\.(tiff?|heic?)$', filename, re.IGNORECASE))

async def convert_to_jpeg(backend: SMBBackend, path: str) -> bytes:
    """Convert TIFF/HEIC to JPEG"""
    # Read entire file into memory
    chunks = []
    async for chunk in backend.read_file(path):
        chunks.append(chunk)
    file_bytes = b''.join(chunks)
    
    # Convert with Pillow
    with Image.open(io.BytesIO(file_bytes)) as img:
        if img.mode != 'RGB':
            img = img.convert('RGB')
        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=85, optimize=True)
        buffer.seek(0)
        return buffer.getvalue()

# In preview endpoint
if should_convert_image(filename):
    logger.info(f"Converting {filename} to JPEG")
    converted_bytes = await convert_to_jpeg(backend, path)
    await backend.disconnect()
    return Response(
        content=converted_bytes,
        media_type="image/jpeg",
        headers={"Content-Disposition": f'inline; filename="{filename}.jpg"'}
    )
```

---

## Approach 3: Hybrid (Format Detection + Best Method)

### Implementation

Choose conversion method based on file size and client capabilities.

### Logic

```python
# Pseudo-code
if file.extension in ['.tif', '.tiff', '.heic', '.heif']:
    file_size = await get_file_size(path)
    user_agent = request.headers.get('user-agent')
    is_safari = 'Safari' in user_agent and 'Chrome' not in user_agent
    
    if is_safari:
        # Safari can handle these natively
        stream_original()
    elif file_size < 5_000_000:  # < 5MB
        # Small files: Convert on server (faster for user)
        convert_on_server()
    else:
        # Large files: Stream original, let client handle or fail gracefully
        stream_with_warning()
```

### Pros ✅
1. **Optimized UX**: Best method for each scenario
2. **Safari optimization**: No conversion for Apple users
3. **Resource efficient**: Only convert when beneficial
4. **Fallback support**: Graceful degradation

### Cons ❌
1. **Complex logic**: More code to maintain
2. **Inconsistent behavior**: Different experiences per browser/file
3. **Testing burden**: Need to test all combinations
4. **Edge cases**: File size detection adds overhead

---

## Approach 4: No Support (Download Only)

### Implementation

Treat TIFF/HEIC as unsupported formats, offer download instead of preview.

### Pros ✅
1. **Zero effort**: No changes needed
2. **No bundle bloat**: Keeps frontend lean
3. **No server load**: No conversion overhead
4. **Simple UX**: Clear "Download to view" message

### Cons ❌
1. **Poor UX**: Users expect image preview
2. **Mobile friction**: HEIC is default iPhone format (huge use case)
3. **Competitive disadvantage**: Other file browsers support these
4. **Lost opportunity**: Easy feature with high value

---

## Recommended Approach

### **Approach 2: Server-Side Conversion** (Recommended)

**Rationale:**

1. **Mobile-First**: HEIC support is critical for iPhone users who want to view their photos. Client-side conversion would perform poorly on the very devices that create HEICs.

2. **Bundle Size**: Adding 700+ KB for HEIC support alone is substantial when current bundle is only 50 KB. That's a 14x increase.

3. **User Experience**: Server conversion feels instant for small-medium images (< 10 MB), which covers 95% of use cases.

4. **Technical Fit**: We already have Pillow in backend, pillow-heif is a small addition.

5. **Future-Proof**: Server-side approach scales to other conversions (RAW photos, PSD, etc.)

### Implementation Plan

**Phase 1: TIFF Support (Easy Win)**
```bash
# Already supported by Pillow - no new dependencies
# Just update PreviewRegistry.ts and add conversion logic
```

**Phase 2: HEIC Support**
```bash
# Add to backend/requirements.txt
pillow-heif>=0.18.0

# Update Dockerfile
RUN apt-get install -y libheif-dev

# Update backend/app/api/preview.py
```

**Phase 3: Optimization**
```python
# Add basic caching for converted images
# Use nginx/Caddy caching layer if conversion is slow
```

### Performance Estimates

| File Size | Format | Conversion Time | User Wait Time |
|-----------|--------|-----------------|----------------|
| 3 MB | HEIC | ~200-500ms | ~500ms total |
| 10 MB | HEIC | ~800ms-1.5s | ~1.5s total |
| 5 MB | TIFF | ~300-700ms | ~700ms total |
| 20 MB | TIFF | ~1.5-3s | ~3s total |

### Fallback Strategy

For very large files (> 50 MB):
1. Show loading indicator with "Converting large image..."
2. Set timeout of 10 seconds
3. If timeout, offer download instead
4. Log slow conversions for monitoring

---

## Alternative: Progressive Enhancement

If bundle size is acceptable, consider:

```typescript
// Detect browser support
const canDisplayNatively = (mime: string) => {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isTiffOrHeic = /image\/(tiff|heic)/.test(mime);
  return !isTiffOrHeic || isSafari;
};

// In ImagePreview component
if (!canDisplayNatively(mimeType)) {
  // Show "Converting image..." indicator
  // Use heic2any or tiff.js
  // Fall back to download if conversion fails/times out
}
```

This gives best of both worlds but requires maintaining both client and server conversion logic.

---

## Cost-Benefit Summary

| Approach | Dev Time | Bundle Impact | Server Impact | UX Quality | Maintenance |
|----------|----------|---------------|---------------|------------|-------------|
| **Client-Side** | 1-2 days | +700 KB | None | ⭐⭐⭐ | Medium |
| **Server-Side** | 2-3 days | None | +CPU/RAM | ⭐⭐⭐⭐⭐ | Low |
| **Hybrid** | 4-5 days | +700 KB | +CPU/RAM | ⭐⭐⭐⭐ | High |
| **No Support** | 0 days | None | None | ⭐ | None |

---

## Conclusion

**Implement Approach 2 (Server-Side Conversion)** for the following reasons:

1. ✅ Best mobile experience (where HEIC is most common)
2. ✅ Zero frontend bloat
3. ✅ Leverages existing Pillow infrastructure
4. ✅ Easier to optimize and cache
5. ✅ Handles large files better than client-side

**Risks to Mitigate:**
- Add conversion timeout (10s max)
- Monitor server CPU/memory usage
- Consider rate limiting for conversion-heavy users
- Log conversion performance metrics

**Future Optimization:**
- Implement preview thumbnail generation (smaller, faster)
- Add caching layer for frequently accessed conversions
- Consider async job queue for very large files
