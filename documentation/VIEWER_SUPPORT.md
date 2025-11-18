# Viewer Support

## Supported File Types

Sambee supports in-browser viewing for the following file types:

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

**Standard Formats:**
- **TIFF** (`.tif`, `.tiff`) - `image/tiff`
  - Automatic CMYK→RGB color conversion (libvips built-in)
  - Multi-page TIFF: First page is displayed
- **HEIC/HEIF** (`.heic`, `.heif`) - `image/heic`, `image/heif` (iPhone photos)
  - Automatic CMYK→RGB color conversion if needed (libvips built-in)
- **BMP** (`.bmp`, `.dib`) - `image/bmp` - Windows Bitmap
- **ICO** (`.ico`) - `image/vnd.microsoft.icon` (converted to PNG to preserve transparency)
- **CUR** (`.cur`) - Windows Cursor files
- **PCX** (`.pcx`) - `image/x-pcx` - PC Paintbrush
- **TGA** (`.tga`) - `image/x-tga` - Truevision TGA/TARGA
- **PNM/PBM/PGM/PPM** (`.pnm`, `.pbm`, `.pgm`, `.ppm`) - Portable pixmap formats (Netpbm)
- **XBM** (`.xbm`) - X11 Bitmap
- **XPM** (`.xpm`) - X11 Pixmap

**Advanced & Professional Formats:**
- **PSD/PSB** (`.psd`, `.psb`) - `image/vnd.adobe.photoshop` - Adobe Photoshop documents
  - Converted to PNG to preserve transparency
  - Automatic CMYK→RGB color conversion with ICC profiles for accurate colors
  - Merges all layers into flattened composite
- **EPS** (`.eps`) - `application/postscript`, `image/x-eps` - Encapsulated PostScript
  - Converted to PNG at 300 DPI
  - Preserves transparency
  - Automatic CMYK→RGB color conversion with ICC profiles
- **AI** (`.ai`) - `application/postscript`, `application/illustrator` - Adobe Illustrator
  - Converted to PNG at 300 DPI
  - Preserves transparency
  - Automatic CMYK→RGB color conversion with ICC profiles for print-ready files
- **JPEG 2000** (`.jp2`, `.j2k`, `.jpt`, `.j2c`, `.jpc`) - `image/jp2` - Next-gen compression with better quality
- **JPEG XL** (`.jxl`) - `image/jxl` - Modern compression, royalty-free
- **OpenEXR** (`.exr`) - `image/x-exr` - High dynamic range, used in VFX/CGI
- **Radiance HDR** (`.hdr`) - `image/vnd.radiance` - High dynamic range imaging

**Scientific & Medical Formats:**
- **FITS** (`.fits`, `.fit`, `.fts`) - `image/fits` - Astronomy and scientific imaging
- **Analyze** (`.img`) - Medical imaging format (neuroimaging)
- **MATLAB** (`.mat`) - MATLAB matrix data with image arrays

**Whole-Slide Imaging (Digital Pathology):**
- **Aperio SVS** (`.svs`) - Leica Biosystems whole-slide format
- **Hamamatsu** (`.ndpi`, `.vms`, `.vmu`) - Digital pathology slides
- **Leica SCN** (`.scn`) - Leica whole-slide format
- **3DHISTECH** (`.mrxs`) - Digital microscopy
- **Ventana BIF** (`.bif`) - Medical slide imaging

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
- Server-side conversion uses libvips for high-performance image processing
- Supports many different image format extensions requiring conversion
- Conversion quality: 85% JPEG quality (good balance of size and quality)
- Transparency preserved where possible (ICO → PNG, EPS → PNG, AI → PNG, PSD → PNG)
- Vector formats (EPS, AI) rendered at 300 DPI for high quality
- **CMYK colorspace handling:**
  - **PSD/PSB/EPS/AI files:** Explicit ICC profile-based conversion using ImageMagick
    - Detects colorspace first (CMYK vs RGB)
    - CMYK files: Applies Ghostscript ICC profiles (`default_cmyk.icc` → `srgb.icc`) for accurate color conversion
    - RGB files: Simple sRGB normalization without color inversion
  - **TIFF/HEIC and other formats:** Automatic CMYK→RGB conversion using libvips built-in colorspace handling
  - All conversions ensure accurate web display without color inversion
- Multi-page TIFF: First page is displayed
- HDR formats (OpenEXR, Radiance) are tone-mapped for web display
- Whole-slide images: Automatically extracts overview or first pyramid level
- FITS astronomical images: Pixel value scaling applied for visibility

### Markdown
- **Markdown** (`.md`, `.markdown`) - `text/markdown`

**Features:**
- Syntax highlighting for code blocks
- GitHub-flavored Markdown support
- Responsive formatting
- Link handling

## Unsupported File Types

Files with unsupported MIME types will show a download prompt instead of an in-browser viewing.

## Future Enhancements

The viewer system is extensible. Planned additions include:
- PDF documents (`application/pdf`)
- Plain text files (`text/plain`)
- Video files (`video/*`)
- Audio files (`audio/*`)
