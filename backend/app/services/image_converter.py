"""
Image conversion service using libvips for high-performance processing.

Converts non-browser-native image formats to JPEG/PNG for preview:
- TIFF/TIF → JPEG
- HEIC/HEIF → JPEG
- BMP → JPEG
- ICO → PNG (preserves transparency)
- WebP → preserved (browser-native)
- SVG → preserved (browser-native)
- PNG → preserved (browser-native)
- JPEG → preserved (browser-native)
- GIF → preserved (browser-native)

Uses libvips for:
- 5-10x faster conversion
- 60-70% lower memory usage
- Streaming, tiled processing
- Automatic multi-threading
"""

from typing import Any, Optional

import pyvips

# Check libvips availability and configure
try:
    # Test basic vips functionality
    pyvips.cache_set_max(100)  # 100MB cache
    pyvips.concurrency_set(4)  # 4 worker threads
    VIPS_AVAILABLE = True
except Exception:
    VIPS_AVAILABLE = False


# Formats that need conversion (not natively supported by browsers)
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
}

# Browser-native formats (no conversion needed)
BROWSER_NATIVE_FORMATS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".avif",  # Modern browsers
}


def needs_conversion(filename: str) -> bool:
    """
    Check if an image file needs conversion for browser display.

    Args:
        filename: The name of the file

    Returns:
        True if the file needs conversion, False otherwise
    """
    extension = _get_extension(filename)
    return extension in FORMATS_REQUIRING_CONVERSION


def is_image_file(filename: str) -> bool:
    """
    Check if a file is an image that we can handle.

    Args:
        filename: The name of the file

    Returns:
        True if the file is a supported image format
    """
    extension = _get_extension(filename)
    return (
        extension in FORMATS_REQUIRING_CONVERSION or extension in BROWSER_NATIVE_FORMATS
    )


def _get_extension(filename: str) -> str:
    """Extract lowercase file extension including the dot."""
    return "." + filename.lower().rsplit(".", 1)[-1] if "." in filename else ""


def convert_image_to_jpeg(
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
        filename: Original filename (used to determine format)
        quality: JPEG quality (1-100, default 85)
        max_dimension: Optional max width/height for downscaling large images

    Returns:
        Tuple of (converted_bytes, mime_type)

    Raises:
        ValueError: If the image cannot be converted
        ImportError: If HEIC support is needed but not available
    """
    if not VIPS_AVAILABLE:
        raise ImportError("libvips is not available")

    extension = _get_extension(filename)

    try:
        # Load image (lazy - only metadata read at this point)
        # The empty string tells vips to auto-detect format from buffer
        image = pyvips.Image.new_from_buffer(image_bytes, "")

        # Determine output format based on transparency and file type
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
            image = image.flatten(background=[255, 255, 255])

        # Step 2: Handle color space conversions
        # libvips handles most conversions automatically, but ensure sRGB for web
        if image.interpretation != "srgb":
            # Convert to sRGB if not already
            if image.interpretation in ["cmyk", "lab", "xyz"]:
                image = image.colourspace("srgb")

        # Step 3: Resize if needed
        if max_dimension and max(image.width, image.height) > max_dimension:
            # thumbnail_image maintains aspect ratio
            # Uses high-quality interpolation (lanczos3 by default)
            image = image.thumbnail_image(max_dimension, height=max_dimension)

        # Step 4: Convert to output format
        # Pipeline executes NOW when we call save
        if output_format == "jpeg":
            output_bytes = image.jpegsave_buffer(
                Q=quality,  # JPEG quality
                optimize_coding=True,  # Optimize Huffman tables
                strip=True,  # Remove metadata (smaller files)
                interlace=False,  # Standard (not progressive) JPEG
            )
        else:  # PNG
            output_bytes = image.pngsave_buffer(
                compression=6,  # PNG compression level (0-9)
                strip=True,  # Remove metadata
            )

        # Convert pyvips buffer to bytes
        return bytes(output_bytes), mime_type

    except pyvips.Error as e:
        error_msg = str(e)

        # Check for missing loader (e.g., HEIC support)
        if (
            "no known loader" in error_msg.lower()
            or "unable to load" in error_msg.lower()
        ):
            if extension in {".heic", ".heif"}:
                raise ImportError(
                    "HEIC/HEIF support requires libvips built with libheif. "
                    "Please ensure libheif is installed."
                ) from e
            raise ImportError(
                f"Image format {extension} not supported. "
                f"libvips may be missing required loader."
            ) from e

        # Generic conversion error
        raise ValueError(f"Failed to convert image: {error_msg}") from e

    except Exception as e:
        raise ValueError(f"Failed to convert image: {str(e)}") from e


def get_image_info(image_bytes: bytes) -> dict[str, Any]:
    """
    Get information about an image without conversion.

    Args:
        image_bytes: Raw image file bytes

    Returns:
        Dictionary with image information (format, size, mode, etc.)
    """
    if not VIPS_AVAILABLE:
        raise ImportError("libvips is not available")

    try:
        # Load image metadata only (lazy loading)
        image = pyvips.Image.new_from_buffer(image_bytes, "")

        # Extract metadata
        return {
            "format": image.get("vips-loader")
            if image.get_typeof("vips-loader") != 0
            else "unknown",
            "mode": image.interpretation,
            "size": (image.width, image.height),
            "width": image.width,
            "height": image.height,
            "bands": image.bands,
            "has_alpha": image.hasalpha(),
            "info": {
                "interpretation": image.interpretation,
                "format": image.format,
                "coding": image.coding,
            },
        }
    except Exception as e:
        raise ValueError(f"Failed to read image info: {str(e)}") from e
