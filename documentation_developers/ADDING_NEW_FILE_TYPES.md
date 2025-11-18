# Adding New File Types to Sambee

This guide explains how to fully integrate a new file type into Sambee, including backend processing, frontend preview, icons, and documentation.

## Overview

Sambee uses **centralized File Type Registries** on both backend and frontend that serve as single sources of truth for all file type information. This makes adding new file types simple and maintainable.

**Key files:**
- **Frontend Registry:** `/workspace/frontend/src/utils/FileTypeRegistry.ts` - All file type info (extensions, MIME types, icons, colors, preview components)
- **Backend Registry:** `/workspace/backend/app/utils/file_type_registry.py` - All file type info (extensions, MIME types, categories, conversion requirements)

## Quick Start

### Adding a New Image Format (e.g., JPEG XL)

**Step 1:** Add to backend registry:
```python
# In /workspace/backend/app/utils/file_type_registry.py (around line ~60)
# Add to FILE_TYPE_REGISTRY list:
FileTypeDefinition(
    extensions=(".jxl",),
    mime_types=("image/jxl",),
    category=FileCategory.IMAGE,
    requires_conversion=True,  # or False if browser-native
    description="JPEG XL Image",
),
```

**Step 2:** Add to frontend registry:
```typescript
// In /workspace/frontend/src/utils/FileTypeRegistry.ts (around line ~70)
{
  extensions: [".jxl"],
  mimeTypes: ["image/jxl"],
  category: "image",
  viewerComponent: () => import("../components/Viewer/ImageViewer"),
  icon: "image",
  color: "#a855f7",
  description: "JPEG XL Image",
}
```

**That's it!** The system automatically handles:
- ✅ MIME type detection (backend)
- ✅ Icon display with correct color (frontend)
- ✅ Viewer component mapping (frontend)
- ✅ Image conversion routing (backend)
- ✅ File extension matching (both)
- ✅ Gallery mode support (frontend)

## Complete Integration Checklist

### For Image File Types

Example: Adding JPEG XL (`.jxl`) support

#### 1. Backend: File Type Registry
**File:** `/workspace/backend/app/utils/file_type_registry.py`

Add a `FileTypeDefinition` entry to the `FILE_TYPE_REGISTRY` list:

```python
# Add to FILE_TYPE_REGISTRY list (around line ~60 for images)
FileTypeDefinition(
    extensions=(".jxl",),
    mime_types=("image/jxl",),
    category=FileCategory.IMAGE,
    requires_conversion=True,  # Set based on browser support
    description="JPEG XL Image",
),
```

**Key fields:**
- `extensions`: Tuple of file extensions (with leading dot, e.g., `(".jpg", ".jpeg")`)
- `mime_types`: Tuple of MIME types (e.g., `("image/jpeg",)`)
- `category`: Use `FileCategory` enum values:
  - `FileCategory.IMAGE` - Images
  - `FileCategory.DOCUMENT` - Documents (PDF, Word, etc.)
  - `FileCategory.TEXT` - Plain text, Markdown
  - `FileCategory.VIDEO` - Video files
  - `FileCategory.AUDIO` - Audio files
  - `FileCategory.ARCHIVE` - ZIP, TAR, etc.
  - `FileCategory.CODE` - Source code
  - `FileCategory.SPREADSHEET` - Excel, CSV, etc.
  - `FileCategory.OTHER` - Everything else
- `requires_conversion`: `True` if server-side conversion needed, `False` for browser-native
- `description`: Human-readable name

**How to decide `requires_conversion`:**
- **`False` (browser-native)**: All modern browsers support it natively (PNG, JPEG, GIF, WebP, SVG, AVIF)
- **`True` (needs conversion)**: Limited browser support or non-web formats (TIFF, HEIC, BMP, JPEG 2000, etc.)

#### 2. Frontend: File Type Registry
**File:** `/workspace/frontend/src/utils/FileTypeRegistry.ts`

**Add ONE entry to the `FILE_TYPE_REGISTRY` array:**

```typescript
// Add to FILE_TYPE_REGISTRY array (around line ~60 for images):
{
  extensions: [".jxl"],
  mimeTypes: ["image/jxl"],
  category: "image",
  viewerComponent: () => import("../components/Viewer/ImageViewer"),
  icon: "image",
  color: "#a855f7",  // Choose a distinctive color
  description: "JPEG XL Image",
}
```

**That's all you need!** The centralized registry automatically handles:
- Icon selection and color
- Viewer component mapping
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

**Important:** Make sure the MIME types match between backend and frontend registries!

#### 3. Documentation: Preview Support
**File:** `/workspace/documentation/VIEWER_SUPPORT.md`

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

- [ ] **Backend Registry**: Add `FileTypeDefinition` to `FILE_TYPE_REGISTRY` in `app/utils/file_type_registry.py` (around line ~60)
- [ ] **Frontend Registry**: Add entry to `FILE_TYPE_REGISTRY` in `src/utils/FileTypeRegistry.ts` (around line ~70)
- [ ] **Documentation**: Add to appropriate section in `documentation/VIEWER_SUPPORT.md`
- [ ] **Developer Docs** (optional): Update `documentation_developers/SERVER_SIDE_IMAGE_CONVERSION.md` if needed

**Total files to modify:** 2-4 files (1-2 optional)

**Key points:**
- ✅ Both registries must have matching MIME types
- ✅ Both registries must have matching extensions
- ✅ Backend `requires_conversion` determines if image needs server processing
- ✅ Frontend `viewerComponent` determines how file is displayed


---

## Testing Checklist

After making the changes:

- [ ] **Icon Display**: Verify icon shows correctly in file browser with the right color
- [ ] **File Opens in Viewer**: Verify file opens in viewer mode when clicked
- [ ] **Conversion Works**: If server-converted, verify conversion produces valid output
- [ ] **Gallery Mode**: Verify file appears in gallery navigation for images
- [ ] **MIME Type Detection**: Verify correct MIME type is detected (check browser console)
- [ ] **Multiple Extensions**: Test all extension variants (e.g., `.jxl`, `.JXL`)
- [ ] **Download**: Verify file can be downloaded with correct MIME type
- [ ] **Mobile**: Test on mobile/tablet if available

---

## Adding Non-Image File Types

For non-image file types (e.g., PDF, video, audio), the process is similar:

### 1. Backend: File Type Registry
**File:** `/workspace/backend/app/utils/file_type_registry.py`

Add a `FileTypeDefinition` entry for the new type:

```python
# For PDF document
FileTypeDefinition(
    extensions=(".pdf",),
    mime_types=("application/pdf",),
    category=FileCategory.DOCUMENT,
    requires_conversion=False,  # Not applicable for non-images
    description="PDF Document",
),
```

**Note:** `requires_conversion` only affects images. For non-image types, it's typically `False`.

### 2. Frontend: Create Preview Component (if needed)
Create a new preview component in `/workspace/frontend/src/components/Viewer/`
- `PdfViewer.tsx` - For PDF documents
- `VideoViewer.tsx` - For video files
- `AudioViewer.tsx` - For audio files
- `TextViewer.tsx` - For text files with syntax highlighting

### 3. Frontend: Add to FileTypeRegistry
Add one entry to `FILE_TYPE_REGISTRY` array in `src/utils/FileTypeRegistry.ts`:

```typescript
{
  extensions: [".pdf"],
  mimeTypes: ["application/pdf"],
  category: "document",
  viewerComponent: () => import("../components/Viewer/PdfViewer"),  // Your new component
  icon: "pdf",
  color: "#ff0000",
  description: "PDF Document",
}
```

### 4. Update Documentation
Add to `documentation/VIEWER_SUPPORT.md` in the appropriate category.

That's it! Both registries work together to provide complete file type support.

---

## Notes

- **MIME types must match**: Ensure MIME types are identical in both backend and frontend registries
- **Standard MIME types**: Always use standard MIME types (e.g., `image/jpeg`, not custom ones)
- **Backend MIME detection**: Uses the registry's `get_mime_type()` function, which checks the registry first, then falls back to Python's `mimetypes` module
- **Frontend MIME usage**: Relies entirely on backend-provided MIME types from `FileInfo`
- **Type safety**: Backend uses `FileCategory` enum for compile-time validation
- **Browser support**: Check [caniuse.com](https://caniuse.com) for browser support before marking as browser-native
- **Performance**: Consider file size and conversion time for server-converted formats
- **libvips availability**: Check `vips -l` output to confirm format support in your installation
- **Testing**: Test with actual files in your development environment before committing

---

## Example: Adding JPEG XL Support

Here's a complete example showing all required changes:

### 1. Backend Registry (`file_type_registry.py`)
```python
# Add to FILE_TYPE_REGISTRY list (around line ~200)
FileTypeDefinition(
    extensions=(".jxl",),
    mime_types=("image/jxl",),
    category=FileCategory.IMAGE,
    requires_conversion=True,  # Limited browser support as of 2024
    description="JPEG XL",
),
```

### 2. Frontend Registry (`FileTypeRegistry.ts`)
```typescript
// Add to FILE_TYPE_REGISTRY array (around line ~70):
{
  extensions: [".jxl"],
  mimeTypes: ["image/jxl"],
  category: "image",
  viewerComponent: () => import("../components/Viewer/ImageViewer"),
  icon: "image",
  color: "#a855f7",  // Purple for JPEG XL
  description: "JPEG XL Image",
}
```

### 3. Documentation (`VIEWER_SUPPORT.md`)
```markdown
#### Server-Converted Formats
- **JPEG XL** (`.jxl`) - `image/jxl` - Next-generation image format with superior compression
```

Done! The format is now fully integrated.

**What happens automatically:**
- ✅ Backend returns correct MIME type via `get_mime_type()`
- ✅ Backend routes to image converter via `needs_conversion()`
- ✅ File icon displays with purple color (frontend)
- ✅ Preview opens when file is clicked (frontend)
- ✅ Gallery mode includes JPEG XL files (frontend)
- ✅ Server converts to JPEG/PNG for browser display (backend)

## Architecture Notes

### Backend Registry
- **Location**: `/workspace/backend/app/utils/file_type_registry.py`
- **Purpose**: MIME type detection, conversion routing, category classification
- **Type-safe**: Uses `FileCategory` enum for validation
- **Functions**:
  - `get_mime_type(filename)` - Get MIME type for a file
  - `needs_conversion(filename)` - Check if image needs conversion
  - `is_image_file(filename)` - Check if file is an image
  - `get_file_type_by_extension(filename)` - Get full definition
  - `get_file_type_by_mime(mime_type)` - Get definition by MIME type

### Frontend Registry
- **Location**: `/workspace/frontend/src/utils/FileTypeRegistry.ts`
- **Purpose**: Viewer component mapping, icon/color selection, file type classification
- **Functions**:
  - `getViewerComponent(mimeType)` - Get preview component for MIME type
  - `isImageFile(filename)` - Check if file is an image
  - `getFileIcon({filename, isDirectory})` - Get icon and color
  - `getFileTypeByExtension(filename)` - Get full definition
  - `getFileTypeByMime(mimeType)` - Get definition by MIME type

### Integration Flow
1. **File listing**: Backend `SMBBackend.list_directory()` uses `get_mime_type()` to populate `FileInfo.mime_type`
2. **Frontend receives**: File list with MIME types included
3. **Icon display**: Frontend uses `getFileIcon()` based on filename
4. **Preview**: Frontend uses `getViewerComponent()` based on `mime_type` from backend
5. **Image conversion**: Backend uses `needs_conversion()` to route through `image_converter.py`
