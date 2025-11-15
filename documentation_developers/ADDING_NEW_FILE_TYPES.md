# Adding New File Types to Sambee

This guide explains how to fully integrate a new file type into Sambee, including backend processing, frontend preview, icons, and documentation.

## Overview

Sambee uses a **centralized File Type Registry** that serves as a single source of truth for all file type information. This makes adding new file types simple and maintainable.

**Key files:**
- **Frontend:** `/workspace/frontend/src/utils/FileTypeRegistry.ts` - Centralized registry with all file type information
- **Backend (images only):** `/workspace/backend/app/services/image_converter.py` - Server-side image conversion

## Quick Start

### Adding a New Image Format (e.g., JPEG XL)

**Step 1:** Add to backend conversion list (if needed):
```python
# In /workspace/backend/app/services/image_converter.py (line ~40 or ~60)
FORMATS_REQUIRING_CONVERSION = {
    # ... existing ...
    ".jxl",
}
```

**Step 2:** Add ONE entry to frontend registry:
```typescript
// In /workspace/frontend/src/utils/FileTypeRegistry.ts (around line ~70)
{
  extensions: [".jxl"],
  mimeTypes: ["image/jxl"],
  category: "image",
  previewComponent: () => import("../components/Preview/ImagePreview"),
  icon: "image",
  color: "#a855f7",
  description: "JPEG XL Image",
}
```

**That's it!** The system automatically handles:
- ✅ Icon display with correct color
- ✅ Preview component mapping
- ✅ MIME type detection
- ✅ File extension matching
- ✅ Gallery mode support

## Complete Integration Checklist

### For Image File Types

Example: Adding JPEG XL (`.jxl`) support

#### 1. Backend: Image Converter Service
**File:** `/workspace/backend/app/services/image_converter.py`

Add the extension to the appropriate set based on browser support:

**If browser-native** (no conversion needed):
```python
# Line ~66
BROWSER_NATIVE_FORMATS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".avif",
    ".jxl",  # ← Add new format
}
```

**If needs server-side conversion**:
```python
# Line ~45
FORMATS_REQUIRING_CONVERSION = {
    ".tif",
    ".tiff",
    ".heic",
    ".heif",
    ".bmp",
    ".dib",
    ".ico",
    ".cur",
    ".pcx",
    ".tga",
    ".ppm",
    ".pgm",
    ".pbm",
    ".pnm",
    ".xbm",
    ".xpm",
    ".jxl",  # ← Add new format
}
```

**How to decide:**
- **Browser-native**: All modern browsers support it natively (PNG, JPEG, GIF, WebP, SVG, AVIF)
- **Needs conversion**: Limited browser support or non-web formats (TIFF, HEIC, BMP, etc.)

#### 2. Frontend: File Type Registry
**File:** `/workspace/frontend/src/utils/FileTypeRegistry.ts`

**Add ONE entry to the `FILE_TYPE_REGISTRY` array:**

```typescript
// Add to FILE_TYPE_REGISTRY array (around line ~60 for images):
{
  extensions: [".jxl"],
  mimeTypes: ["image/jxl"],
  category: "image",
  previewComponent: () => import("../components/Preview/ImagePreview"),
  icon: "image",
  color: "#a855f7",  // Choose a distinctive color
  description: "JPEG XL Image",
}
```

**That's all you need!** The centralized registry automatically handles:
- Icon selection and color
- Preview component mapping
- MIME type detection
- File extension matching
- Gallery mode support (for images)

**Color scheme reference** (choose a distinctive color):
- JPEG/PNG/GIF/WebP/BMP: `#00b4d8` (cyan)
- TIFF: `#0077b6` (dark cyan)
- HEIC: `#0096c7` (blue)
- ICO: `#48cae4` (light cyan)
- AVIF: `#90e0ef` (light blue)
- SVG: `#ffb13b` (orange)

**Tips:**
- Use colors that distinguish the format from others
- Stick to the established color palette for consistency
- Consider the format's common use case when choosing colors

#### 3. Documentation: Preview Support
**File:** `/workspace/documentation/PREVIEW_SUPPORT.md`

Add to the appropriate section based on browser support:

**If browser-native** (add to the Browser-Native Formats section):
```markdown
#### Browser-Native Formats
These formats are displayed directly by the browser:
- **PNG** (`.png`) - `image/png`
- **JPEG** (`.jpg`, `.jpeg`) - `image/jpeg`
- **GIF** (`.gif`) - `image/gif`
- **WebP** (`.webp`) - `image/webp`
- **SVG** (`.svg`) - `image/svg+xml`
- **AVIF** (`.avif`) - `image/avif` (modern browsers)
- **JPEG XL** (`.jxl`) - `image/jxl` (modern browsers)  ← Add here
```

**If server-converted** (add to the Server-Converted Formats section):
```markdown
#### Server-Converted Formats
These formats are automatically converted to JPEG/PNG on the server for browser compatibility:
- **TIFF** (`.tif`, `.tiff`) - `image/tiff`
- **HEIC/HEIF** (`.heic`, `.heif`) - `image/heic`, `image/heif` (iPhone photos)
- **BMP** (`.bmp`, `.dib`) - `image/bmp`
- **ICO** (`.ico`) - `image/x-icon` (converted to PNG to preserve transparency)
- **JPEG XL** (`.jxl`) - `image/jxl` - Next-generation image format  ← Add here
```

Include a brief description of the format's purpose or common use case.

#### 4. Documentation: Developer Docs (Optional)
**File:** `/workspace/documentation_developers/SERVER_SIDE_IMAGE_CONVERSION.md`

Update if the format requires special conversion considerations:
- Transparency handling (like ICO → PNG)
- Multi-page handling (like TIFF)
- Special quality settings
- Performance considerations

---

## Quick Reference Checklist

For adding a new image format (e.g., JPEG XL `.jxl`):

- [ ] **Backend**: Add extension to `FORMATS_REQUIRING_CONVERSION` or `BROWSER_NATIVE_FORMATS` in `app/services/image_converter.py` (line ~40 or ~60)
- [ ] **Frontend Registry**: Add one entry to `FILE_TYPE_REGISTRY` array in `src/utils/FileTypeRegistry.ts` (around line ~70 for images)
- [ ] **Documentation**: Add to appropriate section in `documentation/PREVIEW_SUPPORT.md`
- [ ] **Developer Docs** (optional): Update `documentation_developers/SERVER_SIDE_IMAGE_CONVERSION.md` if needed

**Total files to modify:** 2-4 files (1-2 optional)

---

## Testing Checklist

After making the changes:

- [ ] **Icon Display**: Verify icon shows correctly in file browser with the right color
- [ ] **Preview Opens**: Verify file opens in preview mode when clicked
- [ ] **Conversion Works**: If server-converted, verify conversion produces valid output
- [ ] **Gallery Mode**: Verify file appears in gallery navigation for images
- [ ] **MIME Type Detection**: Verify correct MIME type is detected (check browser console)
- [ ] **Multiple Extensions**: Test all extension variants (e.g., `.jxl`, `.JXL`)
- [ ] **Download**: Verify file can be downloaded with correct MIME type
- [ ] **Mobile**: Test on mobile/tablet if available

---

## Adding Non-Image File Types

For non-image file types (e.g., PDF, video, audio), the process is even simpler:

### 1. Create Preview Component (if needed)
Create a new preview component in `/workspace/frontend/src/components/Preview/`
- `PdfPreview.tsx` - For PDF documents
- `VideoPreview.tsx` - For video files
- `AudioPreview.tsx` - For audio files
- `TextPreview.tsx` - For text files with syntax highlighting

### 2. Add to FileTypeRegistry
Add one entry to `FILE_TYPE_REGISTRY` array in `src/utils/FileTypeRegistry.ts`:

```typescript
{
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
  category: "document",
  previewComponent: () => import("../components/Preview/PdfPreview"),  // Your new component
  icon: "pdf",
  color: "#ff0000",
  description: "PDF Document",
}
```

### 3. Update Documentation
Add to `documentation/PREVIEW_SUPPORT.md` in the appropriate category.

That's it! No need to modify multiple files or keep regexes in sync.

---

## Notes

- **MIME types**: Always use standard MIME types (e.g., `image/jpeg`, not custom ones)
- **Backend MIME detection**: The backend provides MIME types via `get_file_info()` when files are opened for preview. It uses Python's `mimetypes.guess_type()` with explicit fallback mappings for formats not in system databases
- **Directory listings**: MIME types are intentionally omitted from `list_directory()` responses for performance
- **No frontend MIME detection**: The frontend relies entirely on backend-provided MIME types
- **Browser support**: Check [caniuse.com](https://caniuse.com) for browser support before marking as browser-native
- **Performance**: Consider file size and conversion time for server-converted formats
- **libvips availability**: Check `vips -l` output to confirm format support in your installation
- **Testing**: Test with actual files in your development environment before committing

---

## Example: Adding JPEG XL Support

Here's a complete example showing all required changes:

### 1. Backend (`image_converter.py`)
```python
# Add to FORMATS_REQUIRING_CONVERSION (around line ~40)
FORMATS_REQUIRING_CONVERSION = {
    # ... existing formats ...
    ".jxl",  # JPEG XL - limited browser support as of 2025
}
```

### 2. Frontend Registry (`FileTypeRegistry.ts`)
```typescript
// Add to FILE_TYPE_REGISTRY array (around line ~70):
{
  extensions: [".jxl"],
  mimeTypes: ["image/jxl"],
  category: "image",
  previewComponent: () => import("../components/Preview/ImagePreview"),
  icon: "image",
  color: "#a855f7",  // Purple for JPEG XL
  description: "JPEG XL Image",
}
```

### 3. Documentation (`PREVIEW_SUPPORT.md`)
```markdown
#### Server-Converted Formats
- **JPEG XL** (`.jxl`) - `image/jxl` - Next-generation image format with superior compression
```

Done! The format is now fully integrated.

**What happens automatically:**
- ✅ File icon displays with purple color
- ✅ Preview opens when file is clicked
- ✅ Gallery mode includes JPEG XL files
- ✅ MIME type is detected correctly
- ✅ Server converts to JPEG/PNG for browser display
