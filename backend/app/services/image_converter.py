"""
Image conversion service for handling various image formats.

Converts non-browser-native image formats to JPEG for preview:
- TIFF/TIF → JPEG
- HEIC/HEIF → JPEG
- BMP → JPEG
- ICO → PNG
- WebP → preserved (browser-native)
- SVG → preserved (browser-native)
- PNG → preserved (browser-native)
- JPEG → preserved (browser-native)
- GIF → preserved (browser-native)
"""

import io
from typing import Any, Optional

from PIL import Image

# Register HEIF/HEIC support
try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
    HEIF_SUPPORT = True
except ImportError:
    HEIF_SUPPORT = False


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
    Convert an image to JPEG format for browser display.

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
    extension = _get_extension(filename)

    # Check HEIC support
    if extension in {".heic", ".heif"} and not HEIF_SUPPORT:
        raise ImportError(
            "HEIC/HEIF support requires pillow-heif package. "
            "Install with: pip install pillow-heif"
        )

    try:
        # Open image from bytes
        with Image.open(io.BytesIO(image_bytes)) as img:
            # Handle special cases
            if extension == ".ico":
                # ICO files can contain multiple sizes, use the largest
                # Convert to PNG to preserve transparency
                if img.mode in ("RGBA", "LA", "P"):
                    output_format = "PNG"
                    mime_type = "image/png"
                else:
                    img = img.convert("RGB")
                    output_format = "JPEG"
                    mime_type = "image/jpeg"
            else:
                # Convert to RGB for JPEG (removes alpha channel)
                if img.mode not in ("RGB", "L"):
                    # Preserve grayscale, convert everything else to RGB
                    if img.mode == "L":
                        pass  # Keep grayscale
                    elif img.mode in ("RGBA", "LA", "P"):
                        # Handle transparency by compositing on white background
                        if img.mode == "P" and "transparency" in img.info:
                            img = img.convert("RGBA")
                        if img.mode in ("RGBA", "LA"):
                            # Create white background
                            background = Image.new("RGB", img.size, (255, 255, 255))
                            if img.mode == "LA":
                                img = img.convert("RGBA")
                            background.paste(
                                img, mask=img.split()[-1]
                            )  # Use alpha channel as mask
                            img = background
                        else:
                            img = img.convert("RGB")
                    else:
                        img = img.convert("RGB")

                output_format = "JPEG"
                mime_type = "image/jpeg"

            # Downscale if requested and image is larger than max_dimension
            if max_dimension and max(img.size) > max_dimension:
                img.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)

            # Convert to bytes
            buffer = io.BytesIO()
            if output_format == "JPEG":
                img.save(buffer, format="JPEG", quality=quality, optimize=True)
            else:  # PNG for ICO with transparency
                img.save(buffer, format="PNG", optimize=True)

            buffer.seek(0)
            return buffer.getvalue(), mime_type

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
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            return {
                "format": img.format,
                "mode": img.mode,
                "size": img.size,
                "width": img.width,
                "height": img.height,
                "info": img.info,
            }
    except Exception as e:
        raise ValueError(f"Failed to read image info: {str(e)}") from e
