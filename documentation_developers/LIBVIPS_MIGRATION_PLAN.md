# Migration Plan: Pillow to libvips (pyvips)

## Executive Summary

**Goal**: Migrate from Pillow/Pillow-SIMD to libvips (via pyvips) for improved performance and memory efficiency in server-side image conversion.

**Expected Improvements**:
- 5-10x faster conversion times
- 60-70% lower memory usage
- Better handling of large images (>50MB)
- Native multi-threading support
- Streaming processing capabilities

**Timeline**: 2-3 weeks (development + testing + deployment)

**Risk Level**: Medium (complete API change, requires thorough testing)

---

## Table of Contents

1. [Current Architecture](#current-architecture)
2. [New Architecture with libvips](#new-architecture-with-libvips)
3. [Migration Phases](#migration-phases)
4. [Detailed Implementation](#detailed-implementation)
5. [Testing Strategy](#testing-strategy)
6. [Rollback Plan](#rollback-plan)
7. [Performance Benchmarks](#performance-benchmarks)

---

## Current Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│                    Preview API                          │
│              (app/api/preview.py)                       │
│                                                         │
│  1. Checks if file needs conversion                    │
│  2. Reads entire file from SMB into memory             │
│  3. Calls image_converter service                      │
│  4. Returns converted bytes as Response                │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│            Image Converter Service                      │
│        (app/services/image_converter.py)                │
│                                                         │
│  • Uses Pillow (PIL.Image)                             │
│  • pillow-heif for HEIC/HEIF support                   │
│  • Format detection by file extension                  │
│  • Synchronous processing                              │
│  • Full image loaded in memory                         │
│                                                         │
│  Functions:                                            │
│  - needs_conversion(filename) -> bool                  │
│  - convert_image_to_jpeg(bytes, ...) -> (bytes, mime)  │
│  - is_image_file(filename) -> bool                     │
│  - get_image_info(bytes) -> dict                       │
└─────────────────────────────────────────────────────────┘
```

### Current Flow

```
User Request
    ↓
Preview API receives request
    ↓
Check if conversion needed (by extension)
    ↓
Read file from SMB (chunks → full bytes)
    ↓
PIL.Image.open(BytesIO(image_bytes))
    ↓
Decode entire image into memory
    ↓
Color mode conversion (RGBA→RGB, etc.)
    ↓
Alpha compositing (white background)
    ↓
Resize if needed (thumbnail)
    ↓
Encode to JPEG/PNG
    ↓
Return Response(bytes)
```

### Memory Profile (Current)

For a 10MB TIFF file:
```
SMB Read:        10 MB (bytes in memory)
Image Decode:   ~30 MB (RGB pixel data)
Processing:     ~35 MB (conversion buffers)
JPEG Encode:    ~40 MB (peak)
Response:        ~3 MB (JPEG output)

Peak Memory: ~40 MB per conversion
```

### Current Limitations

1. **Blocking I/O**: Synchronous processing blocks FastAPI event loop
2. **Memory Spikes**: 4x file size peak memory usage
3. **Single-threaded**: Can't utilize multiple CPU cores
4. **Eager Loading**: Must load entire image before processing
5. **No Streaming**: Can't process images larger than available RAM
6. **GIL Contention**: Python GIL limits concurrent conversions

---

## New Architecture with libvips

### Overview

libvips is a demand-driven, streaming image processing library optimized for server workloads. It processes images in small tiles, keeping memory usage low and enabling parallel processing.

### Key Architectural Changes

```
┌─────────────────────────────────────────────────────────┐
│                    Preview API                          │
│              (app/api/preview.py)                       │
│                                                         │
│  1. Checks if file needs conversion                    │
│  2. Reads file from SMB (can stream or buffer)         │
│  3. Calls vips_converter service                       │
│  4. Returns converted bytes as Response                │
│                                                         │
│  NEW: Option for async processing pool                 │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│            Vips Converter Service                       │
│        (app/services/vips_converter.py)                 │
│                                                         │
│  • Uses pyvips (libvips Python bindings)               │
│  • Native HEIC support (if libvips built with libheif) │
│  • Format detection by magic bytes + extension         │
│  • Multi-threaded processing (automatic)               │
│  • Streaming/tiled processing                          │
│  • Lazy evaluation (operation pipelines)               │
│                                                         │
│  Functions:                                            │
│  - needs_conversion(filename) -> bool                  │
│  - convert_image(bytes, ...) -> (bytes, mime)          │
│  - is_image_file(filename) -> bool                     │
│  - get_image_info(bytes) -> dict                       │
│  - convert_image_stream(...) -> Iterator[bytes]  [NEW] │
└─────────────────────────────────────────────────────────┘
```

### New Processing Flow

```
User Request
    ↓
Preview API receives request
    ↓
Check if conversion needed
    ↓
Read file from SMB
    ↓
pyvips.Image.new_from_buffer(bytes, "")
    │
    ├─> Lazy loading: metadata only, no pixel decode yet
    │
    ↓
Build operation pipeline:
    │
    ├─> If has alpha: flatten(background=[255,255,255])
    ├─> If oversized: thumbnail_image(max_dimension)
    └─> Output: jpegsave_buffer(Q=85)
    │
    ↓
Execute pipeline (on-demand):
    │
    ├─> Reads image in tiles (e.g., 128x128 chunks)
    ├─> Processes each tile through pipeline
    ├─> Multi-threaded tile processing
    └─> Streams to output buffer
    │
    ↓
Return Response(bytes)
```

### Memory Profile (libvips)

For a 10MB TIFF file:
```
SMB Read:        10 MB (bytes in memory)
Image Decode:    ~2 MB (tiled, only active tiles)
Processing:      ~3 MB (tile buffers)
JPEG Encode:     ~5 MB (streaming encoder)
Response:        ~3 MB (JPEG output)

Peak Memory: ~12 MB per conversion (70% reduction!)
```

### libvips Architectural Advantages

#### 1. **Demand-Driven Processing**

```
Traditional (Pillow):
┌──────────┐    ┌──────────┐    ┌──────────┐
│  Load    │───>│ Process  │───>│  Save    │
│ (10 MB)  │    │ (40 MB)  │    │  (3 MB)  │
└──────────┘    └──────────┘    └──────────┘
     All at once in memory

libvips:
┌──────────┐    ┌──────────┐    ┌──────────┐
│Load Tile │───>│ Process  │───>│Save Tile │
│ (128 KB) │    │ (256 KB) │    │ (64 KB)  │
└──────────┘    └──────────┘    └──────────┘
     ↑                                ↓
     └────────── Loop tiles ──────────┘
     Only active tiles in memory
```

#### 2. **Lazy Evaluation**

```python
# Operations are queued, not executed immediately
image = pyvips.Image.new_from_buffer(data, "")  # No decode yet
image = image.flatten(background=[255, 255, 255])  # Pipeline step 1
image = image.thumbnail_image(4096)               # Pipeline step 2
output = image.jpegsave_buffer(Q=85)             # NOW execute pipeline

# libvips optimizes the pipeline before execution:
# - Combines operations where possible
# - Eliminates redundant steps
# - Chooses optimal tile size
```

#### 3. **Multi-threaded Execution**

```
Pillow (single-threaded):
CPU Core 1: [████████████████████████████] Processing
CPU Core 2: [                            ] Idle
CPU Core 3: [                            ] Idle
CPU Core 4: [                            ] Idle

libvips (multi-threaded):
CPU Core 1: [████████] Tile 1,3,5,7
CPU Core 2: [████████] Tile 2,4,6,8
CPU Core 3: [████████] Tile 9,11,13,15
CPU Core 4: [████████] Tile 10,12,14,16
```

#### 4. **Format Support Architecture**

libvips uses a loader/saver plugin system:

```
Format Detection:
    1. Check magic bytes (file signature)
    2. Fallback to file extension
    3. Try loaders in priority order

Available Loaders (depends on build):
    - tiffload:     TIFF files
    - heifload:     HEIC/HEIF (if libheif present)
    - pngload:      PNG files
    - jpegload:     JPEG files
    - webpload:     WebP files
    - magickload:   Via ImageMagick (fallback)

Saver Selection:
    - jpegsave_buffer: For JPEG output
    - pngsave_buffer:  For PNG output
    - Automatic optimization built-in
```

---

## Migration Phases

### Phase 1: Preparation & Research (Week 1)

**Goals**: Set up environment, verify format support, create proof of concept

#### Tasks:

1. **Environment Setup**
   - [ ] Build libvips with HEIC support in dev container
   - [ ] Install pyvips in development environment
   - [ ] Verify all 20 image formats are supported
   - [ ] Document any missing format support

2. **Format Compatibility Testing**
   ```bash
   # Test each format with libvips
   vips -l | grep -E "(heif|tiff|png|jpeg|webp|bmp)"
   ```

3. **Create Proof of Concept**
   - [ ] Create `app/services/vips_converter_poc.py`
   - [ ] Implement basic conversion for 3-4 formats

4. **Docker Configuration**
   - [ ] Update Dockerfile with libvips dependencies
   - [ ] Create build script for libvips with HEIC support
   - [ ] Test Docker build process

**Deliverables**:
- Working pyvips in dev container
- Format compatibility matrix
- Performance benchmark results
- Updated Dockerfile (draft)

---

### Phase 2: Implementation (Week 2)

**Goals**: Implement full vips_converter service with feature parity

#### Tasks:

1. **Create New Service Module**

   **File**: `app/services/vips_converter.py`

   ```python
   """
   Image conversion service using libvips for high-performance processing.
   
   Provides streaming, tiled processing with lower memory usage than Pillow.
   """
   
   import io
   from typing import Any, Optional
   import pyvips
   
   # Format detection constants (same as Pillow version)
   FORMATS_REQUIRING_CONVERSION = { ... }
   BROWSER_NATIVE_FORMATS = { ... }
   
   # Check libvips capabilities
   def _check_format_support():
       """Verify libvips has required format loaders."""
       loaders = pyvips.get_suffixes()
       # Check for critical formats
       
   def needs_conversion(filename: str) -> bool:
       """Same interface as Pillow version."""
       
   def convert_image(
       image_bytes: bytes,
       filename: str,
       quality: int = 85,
       max_dimension: Optional[int] = None,
   ) -> tuple[bytes, str]:
       """
       Convert image using libvips.
       
       Uses tiled processing for memory efficiency.
       Multi-threaded automatically.
       """
       
   def get_image_info(image_bytes: bytes) -> dict[str, Any]:
       """Extract metadata without full decode."""
   ```

2. **Implement Core Functions**

   - [ ] `needs_conversion()` - Same logic, new implementation
   - [ ] `convert_image()` - Main conversion with vips pipeline
   - [ ] `is_image_file()` - Format detection
   - [ ] `get_image_info()` - Metadata extraction
   - [ ] `_handle_transparency()` - Alpha channel compositing
   - [ ] `_resize_if_needed()` - Smart downscaling

3. **Handle Special Cases**

   - [ ] ICO files with transparency → PNG
   - [ ] Grayscale preservation
   - [ ] RGBA → RGB conversion with white background
   - [ ] Palette mode images
   - [ ] Multi-page TIFF (first page only)

4. **Error Handling**

   - [ ] Missing format loaders (e.g., HEIC)
   - [ ] Corrupted images
   - [ ] Unsupported color spaces
   - [ ] Memory exhaustion (large images)
   - [ ] Timeout protection

5. **Configuration Management**

   ```python
   # app/core/config.py additions
   class Settings(BaseSettings):
       # ... existing settings ...
       
       # Image processing
       IMAGE_CONVERSION_QUALITY: int = 85
       IMAGE_MAX_DIMENSION: int = 4096
       IMAGE_PROCESSOR: str = "vips"  # "pillow" or "vips"
       VIPS_CONCURRENCY: int = 4  # Max threads for vips
       VIPS_CACHE_MAX: int = 100  # MB for vips operation cache
   ```

**Deliverables**:
- Complete `vips_converter.py` module
- Configuration settings
- Error handling coverage
- Code documentation

---

### Phase 3: Testing (Week 2-3)

**Goals**: Comprehensive testing to ensure feature parity and reliability

#### Test Strategy:

1. **Unit Tests**

   **File**: `tests/test_vips_converter.py`

   ```python
   """Comprehensive tests for vips_converter service."""
   
   class TestFormatDetection:
       """Test format detection matches Pillow behavior."""
       
   class TestImageConversion:
       """Test conversion for all 20 formats."""
       
       def test_convert_tiff_to_jpeg(self):
       def test_convert_heic_to_jpeg(self):
       def test_convert_bmp_to_jpeg(self):
       def test_convert_ico_with_transparency(self):
       # ... one test per format
       
   class TestColorModeHandling:
       """Test RGB, RGBA, grayscale, palette modes."""
       
   class TestResizing:
       """Test downscaling with max_dimension."""
       
   class TestEdgeCases:
       """Test error conditions and special cases."""
       
       def test_corrupted_image_raises_error(self):
       def test_very_large_image(self):
       def test_animated_gif_uses_first_frame(self):
       def test_multipage_tiff_uses_first_page(self):
   ```

2. **Integration Tests**

   **File**: `tests/test_preview_vips_integration.py`

   ```python
   """Test preview API with vips converter."""
   
   async def test_preview_tiff_file_converted(self):
       """Test full flow: SMB → conversion → response."""
       
   async def test_preview_heic_file_converted(self):
       """Test HEIC conversion with real file."""
       
   async def test_concurrent_conversions(self):
       """Test multiple simultaneous conversions."""
   ```

4. **Format Compatibility Matrix**

   Create test suite that validates ALL formats:

   | Format | Extension | Test File | Vips Loader | Status |
   |--------|-----------|-----------|-------------|--------|
   | TIFF   | .tif      | test.tif  | tiffload    | ✅     |
   | HEIC   | .heic     | test.heic | heifload    | ⚠️ *   |
   | BMP    | .bmp      | test.bmp  | magickload  | ✅     |
   | ICO    | .ico      | test.ico  | magickload  | ✅     |
   | ...    | ...       | ...       | ...         | ...    |

   *Requires libvips built with libheif

5. **Regression Testing**

   - [ ] All existing Pillow tests pass with vips
   - [ ] Ensure no breaking changes to API responses

**Deliverables**:
- Complete test suite (>90% coverage)
- Format compatibility report
- Performance benchmark report
- Regression test results

---

### Phase 4: Integration & Feature Flag (Week 3)

**Goals**: Integrate vips_converter (no need to switch back to Pillow)

#### Tasks:

1. **Update Preview API**

   **File**: `app/api/preview.py`

2. **Environment Configuration**

   ```bash
   # .env
   IMAGE_PROCESSOR=vips      # or "pillow" for rollback
   IMAGE_CONVERSION_QUALITY=85
   IMAGE_MAX_DIMENSION=4096
   VIPS_CONCURRENCY=4
   VIPS_CACHE_MAX=100
   ```

**Deliverables**:
- Converter factory implementation
- Updated preview API
- Configuration settings
- Feature flag capability (optional)

---

### Phase 5: Docker & Deployment (Week 3)

**Goals**: Production-ready Docker configuration with libvips

#### Tasks:

1. **Update Dockerfile**

   **File**: `Dockerfile`

   ```dockerfile
   # Multi-stage build for production
   FROM python:3.13-slim AS builder
   
   # Install build dependencies and libvips
   RUN apt-get update && apt-get install -y \
       build-essential \
       pkg-config \
       libvips-dev \
       libvips-tools \
       libheif-dev \
       libjpeg-dev \
       libpng-dev \
       libtiff-dev \
       libwebp-dev \
       libgif-dev \
       libexif-dev \
       && rm -rf /var/lib/apt/lists/*
   
   # Install Python dependencies
   WORKDIR /build
   COPY backend/requirements.txt .
   RUN pip install --prefix=/install --no-cache-dir -r requirements.txt
   
   # Stage 2: Runtime image
   FROM python:3.13-slim
   
   # Install runtime dependencies (no build tools)
   RUN apt-get update && apt-get install -y \
       libmagic1 \
       libvips42 \
       libheif1 \
       libjpeg62-turbo \
       libpng16-16 \
       libtiff6 \
       libwebp7 \
       libgif7 \
       libexif12 \
       && rm -rf /var/lib/apt/lists/*
   
   # Copy installed Python packages
   COPY --from=builder /install /usr/local
   
   # ... rest of Dockerfile ...
   ```

2. **Verify libvips Capabilities**

   Add health check to verify HEIC support:

   ```python
   # app/core/health.py
   
   def check_vips_capabilities():
       """Verify libvips has required format support."""
       import pyvips
       
       loaders = pyvips.get_suffixes()
       
       return {
           "heic_support": ".heic" in loaders,
           "tiff_support": ".tiff" in loaders,
           "webp_support": ".webp" in loaders,
           "available_loaders": loaders,
       }
   ```

3. **Update Development Container**

   **File**: `.devcontainer/Dockerfile`

   ```dockerfile
   FROM mcr.microsoft.com/devcontainers/python:3.13
   
   # Install libvips and development tools
   RUN apt-get update && apt-get install -y \
       build-essential \
       libvips-dev \
       libvips-tools \
       libheif-dev \
       ... \
       && apt-get clean
   ```

4. **Build & Test Docker Image**

   ```bash
   # Build production image
   docker build -t sambee:vips .
   
   # Test format support
   docker run --rm sambee:vips python -c \
       "import pyvips; print(pyvips.get_suffixes())"
   
   # Verify HEIC support
   docker run --rm sambee:vips vips -l | grep heif
   ```

5. **Documentation Updates**

   - [ ] Update README with libvips requirements
   - [ ] Document environment variables
   - [ ] Add troubleshooting guide
   - [ ] Update performance expectations

**Deliverables**:
- Production Dockerfile with libvips
- Dev container configuration
- Build verification scripts
- Deployment documentation

---

## Detailed Implementation

### Core Conversion Function (libvips)

```python
def convert_image(
    image_bytes: bytes,
    filename: str,
    quality: int = 85,
    max_dimension: Optional[int] = None,
) -> tuple[bytes, str]:
    """
    Convert an image to JPEG/PNG format using libvips.
    
    Uses streaming, tiled processing for memory efficiency.
    Automatically multi-threaded.
    
    Args:
        image_bytes: Raw image file bytes
        filename: Original filename (for format detection)
        quality: JPEG quality (1-100, default 85)
        max_dimension: Optional max width/height for downscaling
        
    Returns:
        Tuple of (converted_bytes, mime_type)
        
    Raises:
        ValueError: If image cannot be converted
        ImportError: If required format loader not available
    """
    extension = _get_extension(filename)
    
    try:
        # Load image (lazy - only metadata read at this point)
        # The "" tells vips to auto-detect format from buffer
        image = pyvips.Image.new_from_buffer(image_bytes, "")
        
        # Determine output format based on transparency
        has_alpha = image.hasalpha()
        if extension == ".ico" and has_alpha:
            output_format = "png"
            mime_type = "image/png"
        else:
            output_format = "jpeg"
            mime_type = "image/jpeg"
        
        # Build processing pipeline (operations queued, not executed yet)
        
        # Step 1: Handle transparency
        if has_alpha and output_format == "jpeg":
            # Flatten alpha channel onto white background
            # This composites the image over a white background
            image = image.flatten(background=[255, 255, 255])
        
        # Step 2: Resize if needed
        if max_dimension and max(image.width, image.height) > max_dimension:
            # thumbnail_image maintains aspect ratio
            # Uses high-quality interpolation (lanczos3 by default)
            image = image.thumbnail_image(max_dimension, height=max_dimension)
        
        # Step 3: Convert to output format
        # Pipeline executes NOW when we call save
        if output_format == "jpeg":
            output_bytes = image.jpegsave_buffer(
                Q=quality,                    # JPEG quality
                optimize_coding=True,         # Optimize Huffman tables
                strip=True,                   # Remove metadata (smaller files)
                interlace=False,              # Progressive JPEG (optional)
            )
        else:  # PNG
            output_bytes = image.pngsave_buffer(
                compression=6,                # PNG compression level
                strip=True,                   # Remove metadata
            )
        
        # Convert pyvips buffer to bytes
        return bytes(output_bytes), mime_type
        
    except pyvips.Error as e:
        error_msg = str(e)
        
        # Check for missing loader
        if "VipsJpeg: unable to open" in error_msg or "no loader" in error_msg:
            raise ImportError(
                f"Image format {extension} not supported. "
                f"libvips may be missing required loader."
            )
        
        # Generic conversion error
        raise ValueError(f"Failed to convert image: {error_msg}") from e
        
    except Exception as e:
        raise ValueError(f"Unexpected error during conversion: {str(e)}") from e
```

### Advanced Features

#### 1. Streaming Conversion (for very large images)

```python
def convert_image_stream(
    file_path: str,
    quality: int = 85,
    max_dimension: Optional[int] = None,
) -> Iterator[bytes]:
    """
    Convert image with streaming output.
    
    Useful for very large images or network streaming.
    Yields chunks as they're processed.
    """
    import tempfile
    
    # Load from file (more efficient than buffer for large files)
    image = pyvips.Image.new_from_file(file_path)
    
    # Build pipeline
    if image.hasalpha():
        image = image.flatten(background=[255, 255, 255])
    
    if max_dimension and max(image.width, image.height) > max_dimension:
        image = image.thumbnail_image(max_dimension, height=max_dimension)
    
    # Save to temporary file with streaming
    with tempfile.NamedTemporaryFile(suffix=".jpg") as tmp:
        image.jpegsave(tmp.name, Q=quality, optimize_coding=True)
        
        # Read and yield in chunks
        tmp.seek(0)
        while chunk := tmp.read(8192):
            yield chunk
```

#### 2. Concurrent Processing Pool

```python
from concurrent.futures import ThreadPoolExecutor
import asyncio

class VipsConverterPool:
    """
    Thread pool for concurrent vips conversions.
    
    libvips is thread-safe and releases GIL for most operations.
    """
    
    def __init__(self, max_workers: int = 4):
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
    
    async def convert_async(
        self,
        image_bytes: bytes,
        filename: str,
        quality: int = 85,
        max_dimension: Optional[int] = None,
    ) -> tuple[bytes, str]:
        """
        Async wrapper for convert_image.
        
        Runs conversion in thread pool to avoid blocking event loop.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            self.executor,
            convert_image,
            image_bytes,
            filename,
            quality,
            max_dimension,
        )

# Usage in preview.py
converter_pool = VipsConverterPool(max_workers=4)

@router.get("/{connection_id}/file")
async def preview_file(...):
    if needs_conversion(filename):
        # Non-blocking conversion
        converted_bytes, mime = await converter_pool.convert_async(
            image_bytes,
            filename,
            quality=85,
            max_dimension=4096,
        )
```

#### 3. Caching Layer

```python
import hashlib
from pathlib import Path

class ConversionCache:
    """
    File-based cache for converted images.
    
    Caches conversions to avoid repeated processing.
    """
    
    def __init__(self, cache_dir: Path, max_size_mb: int = 1000):
        self.cache_dir = cache_dir
        self.max_size_mb = max_size_mb
        cache_dir.mkdir(parents=True, exist_ok=True)
    
    def get_cache_key(self, image_bytes: bytes, params: dict) -> str:
        """Generate cache key from image and parameters."""
        hasher = hashlib.sha256()
        hasher.update(image_bytes)
        hasher.update(str(params).encode())
        return hasher.hexdigest()
    
    def get(self, key: str) -> Optional[bytes]:
        """Retrieve cached conversion."""
        cache_file = self.cache_dir / f"{key}.jpg"
        if cache_file.exists():
            return cache_file.read_bytes()
        return None
    
    def set(self, key: str, data: bytes):
        """Store conversion in cache."""
        cache_file = self.cache_dir / f"{key}.jpg"
        cache_file.write_bytes(data)
        # TODO: Implement cache size management

# Usage
cache = ConversionCache(Path("/app/data/conversion_cache"))

def convert_with_cache(image_bytes: bytes, filename: str, **params):
    cache_key = cache.get_cache_key(image_bytes, params)
    
    # Check cache
    cached = cache.get(cache_key)
    if cached:
        return cached, "image/jpeg"
    
    # Convert and cache
    result, mime = convert_image(image_bytes, filename, **params)
    cache.set(cache_key, result)
    return result, mime
```

---

## Testing Strategy

### Test Categories

1. **Functional Tests** - Feature parity with Pillow
2. **Performance Tests** - Speed and memory benchmarks
3. **Stress Tests** - Large files, concurrent load
4. **Regression Tests** - Ensure no breaking changes
5. **Integration Tests** - Full API flow

### Critical Test Cases

```python
# tests/test_vips_converter.py

class TestVipsConverter:
    """Comprehensive test suite for libvips converter."""
    
    # Format Support Tests
    def test_all_20_formats_convert(self):
        """Verify all 20 image formats can be converted."""
        formats = [
            ("test.tif", "tiff"),
            ("test.heic", "heic"),
            ("test.bmp", "bmp"),
            # ... all 20 formats
        ]
        for filename, format_name in formats:
            test_data = create_test_image(format_name)
            result, mime = convert_image(test_data, filename)
            assert len(result) > 0
            assert mime in ("image/jpeg", "image/png")
    
    # Color Mode Tests
    def test_rgba_to_rgb_white_background(self):
        """RGBA images composited on white background."""
        rgba_data = create_rgba_test_image()
        result, _ = convert_image(rgba_data, "test.png")
        
        # Verify no transparency in output
        output_img = pyvips.Image.new_from_buffer(result, "")
        assert not output_img.hasalpha()
    
    # Resize Tests
    def test_large_image_downscaled(self):
        """Images >4096px are downscaled."""
        large_img = create_test_image(size=(8000, 6000))
        result, _ = convert_image(large_img, "test.tif", max_dimension=4096)
        
        output = pyvips.Image.new_from_buffer(result, "")
        assert max(output.width, output.height) <= 4096
    
    # Performance Tests
    @pytest.mark.benchmark
    def test_conversion_faster_than_pillow(self, benchmark_image):
        """libvips should be faster than Pillow."""
        import time
        
        # Time vips conversion
        start = time.time()
        vips_result, _ = convert_image(benchmark_image, "test.tif")
        vips_time = time.time() - start
        
        # Time pillow conversion (import from image_converter)
        start = time.time()
        pillow_result, _ = pillow_convert(benchmark_image, "test.tif")
        pillow_time = time.time() - start
        
        # Should be at least 3x faster
        assert vips_time < pillow_time / 3
    
    # Memory Tests
    def test_memory_usage_lower(self):
        """Peak memory should be significantly lower."""
        import tracemalloc
        
        large_image = create_test_image(size=(5000, 5000))
        
        tracemalloc.start()
        convert_image(large_image, "test.tif")
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        
        # Peak should be < 50MB for 5000x5000 image
        assert peak < 50 * 1024 * 1024
    
    # Error Handling Tests
    def test_corrupted_image_raises_value_error(self):
        """Corrupted images raise ValueError."""
        with pytest.raises(ValueError, match="Failed to convert"):
            convert_image(b"not an image", "test.jpg")
    
    def test_missing_heic_loader_raises_import_error(self):
        """Missing HEIC loader raises ImportError."""
        # Mock pyvips to simulate missing heif support
        with patch_missing_heif_loader():
            heic_data = b"fake heic data"
            with pytest.raises(ImportError, match="not supported"):
                convert_image(heic_data, "test.heic")
```

---

## Dependencies & Requirements

### System Libraries (Docker)

```dockerfile
# Production requirements
libvips42          # libvips runtime (v8.14+)
libheif1           # HEIC/HEIF support
libjpeg62-turbo    # JPEG codec
libpng16-16        # PNG codec
libtiff6           # TIFF codec
libwebp7           # WebP codec
libgif7            # GIF codec
libexif12          # EXIF metadata

# Build-time only
libvips-dev        # Development headers
libheif-dev        # HEIC development headers
```

### Python Packages

```txt
# requirements.txt additions
pyvips==2.2.1      # Python bindings for libvips

# Keep for fallback/comparison
pillow==11.0.0     # Optional: keep for fallback mode
```

### Version Compatibility

- **libvips**: >= 8.14 (for best performance)
- **pyvips**: >= 2.2.0
- **libheif**: >= 1.12 (for HEIC support)
- **Python**: >= 3.10

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Missing HEIC support in libvips | Medium | High | Build libvips with libheif, test in CI |
| Performance regression for some formats | Low | Medium | Comprehensive benchmarks, feature flag |
| Memory usage higher than expected | Low | Medium | Stress testing, monitoring |
| Compatibility issues with Docker Hub | Medium | High | Test multi-platform builds |
| Breaking changes in API behavior | Low | High | Extensive regression testing |
| Learning curve for team | Medium | Low | Documentation, code examples |

---

## Success Criteria

Migration is considered successful when:

- ✅ All 20 image formats convert correctly
- ✅ Visual output matches Pillow quality
- ✅ All existing tests pass
- ✅ Performance improves by >3x
- ✅ Memory usage reduces by >50%
- ✅ Production runs stable for 1 week
- ✅ No user-reported issues with image previews
- ✅ Docker builds work on amd64 and arm64

---

## Timeline Summary

| Week | Phase | Key Deliverables |
|------|-------|------------------|
| 1 | Preparation | POC, format testing, Docker setup |
| 2 | Implementation | Full vips_converter, tests, integration |
| 3 | Deployment | Production Dockerfile, feature flag, rollout |

**Total: 2-3 weeks** from start to production deployment

---

## Appendix A: libvips Configuration

### Optimal vips Settings

```python
# app/core/config.py

# Configure libvips behavior
import pyvips

# Set concurrency (number of worker threads)
pyvips.concurrency_set(4)  # Use 4 threads

# Set operation cache size (in MB)
pyvips.cache_set_max(100)  # 100MB cache

# Set maximum number of cached operations
pyvips.cache_set_max_operations(500)

# Set maximum number of open files
pyvips.cache_set_max_files(100)
```

### Performance Tuning

```python
def optimize_for_server():
    """Optimize libvips for server workloads."""
    import pyvips
    
    # Increase cache for better performance with repeated operations
    pyvips.cache_set_max(200)  # 200MB cache
    
    # More threads for multi-core servers
    import os
    cpu_count = os.cpu_count() or 4
    pyvips.concurrency_set(min(cpu_count, 8))
    
    # Log cache statistics (for monitoring)
    def log_cache_stats():
        stats = {
            "cache_max": pyvips.cache_get_max(),
            "cache_size": pyvips.cache_get_size(),
            "operations": pyvips.cache_get_max_operations(),
        }
        logger.debug(f"libvips cache stats: {stats}")
```

---

## Appendix B: Format Loader Reference

### libvips Format Detection

```python
def check_available_loaders():
    """Check which format loaders are available."""
    import pyvips
    
    # Get list of supported file suffixes
    suffixes = pyvips.get_suffixes()
    
    # Get list of available loaders
    loaders = {}
    for suffix in suffixes:
        loader = pyvips.vips_foreign_find_load(f"test{suffix}")
        loaders[suffix] = loader
    
    return loaders

# Expected loaders:
{
    '.jpg': 'VipsForeignLoadJpegFile',
    '.jpeg': 'VipsForeignLoadJpegFile',
    '.png': 'VipsForeignLoadPngFile',
    '.webp': 'VipsForeignLoadWebpFile',
    '.tif': 'VipsForeignLoadTiffFile',
    '.tiff': 'VipsForeignLoadTiffFile',
    '.heic': 'VipsForeignLoadHeifFile',  # If libheif available
    '.heif': 'VipsForeignLoadHeifFile',
    # Others via ImageMagick loader:
    '.bmp': 'VipsForeignLoadMagickFile',
    '.ico': 'VipsForeignLoadMagickFile',
    '.pcx': 'VipsForeignLoadMagickFile',
}
```

---

## References

- [libvips Documentation](https://www.libvips.org/)
- [pyvips Documentation](https://libvips.github.io/pyvips/)
- [libvips Performance](https://github.com/libvips/libvips/wiki/Speed-and-memory-use)
- [HEIC Support in libvips](https://github.com/libvips/libvips/wiki/Build-for-Ubuntu)
- [libvips vs Pillow Benchmarks](https://github.com/uploadcare/pillow-simd#benchmarks)
