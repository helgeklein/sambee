# Preview Support

## Supported File Types

Sambee supports in-browser preview for the following file types:

### Images

#### Browser-Native Formats
These formats are displayed directly by the browser:
- **PNG** (`.png`) - `image/png`
- **JPEG** (`.jpg`, `.jpeg`) - `image/jpeg`
- **GIF** (`.gif`) - `image/gif`
- **WebP** (`.webp`) - `image/webp`
- **SVG** (`.svg`) - `image/svg+xml`
- **AVIF** (`.avif`) - `image/avif` (modern browsers)

#### Server-Converted Formats
These formats are automatically converted to JPEG/PNG on the server for browser compatibility:
- **TIFF** (`.tif`, `.tiff`) - `image/tiff`
- **HEIC/HEIF** (`.heic`, `.heif`) - `image/heic`, `image/heif` (iPhone photos)
- **BMP** (`.bmp`, `.dib`) - `image/bmp`
- **ICO** (`.ico`) - `image/x-icon`
- **PCX** (`.pcx`) - `image/x-pcx`
- **TGA** (`.tga`) - `image/x-tga`
- **PNM/PBM/PGM/PPM** (`.pnm`, `.pbm`, `.pgm`, `.ppm`) - Various portable pixmap formats

**Image Features:**
- Zoom controls (mouse wheel, pinch-to-zoom)
- Pan by dragging
- Rotation
- Gallery mode with keyboard navigation (arrow keys)
- Full-screen support
- Responsive on mobile and desktop
- Automatic format conversion for compatibility
- Smart downscaling for very large images (max 4096px)

**Technical Details:**
- Server-side conversion uses Pillow with pillow-heif for HEIC support
- Conversion quality: 85% JPEG quality (good balance of size and quality)
- Large images are downscaled to max 4096px to prevent memory issues
- Transparency preserved where possible (ICO → PNG)
- Multi-page TIFF: First page is displayed

### Markdown
- **Markdown** (`.md`, `.markdown`) - `text/markdown`

**Features:**
- Syntax highlighting for code blocks
- GitHub-flavored Markdown support
- Responsive formatting
- Link handling

## Unsupported File Types

Files with unsupported MIME types will show a download prompt instead of an in-browser preview.

## Future Enhancements

The preview system is extensible. Planned additions include:
- PDF documents (`application/pdf`)
- Plain text files (`text/plain`)
- Video files (`video/*`)
- Audio files (`audio/*`)
