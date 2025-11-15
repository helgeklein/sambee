"""
Image conversion service using libvips for high-performance processing.

Converts non-browser-native image formats to JPEG/PNG for preview.
Examples::
- TIFF/TIF → JPEG
- ICO → PNG (preserves transparency)
- JPEG → preserved (browser-native)

Uses libvips for:
- Fast conversion
- Low memory usage
- Streaming, tiled processing
- Automatic multi-threading
"""

import logging
import os
import time
from typing import Any, Optional

import pyvips

logger = logging.getLogger(__name__)

# Check libvips availability and configure
try:
    # Test basic vips functionality and configure cache
    pyvips.cache_set_max(100)  # 100MB cache
    # Note: libvips handles concurrency automatically
    VIPS_AVAILABLE = True
except Exception as e:
    import sys

    print(f"ERROR: Failed to initialize libvips: {e}", file=sys.stderr)
    VIPS_AVAILABLE = False


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

    # Extract extension for format-specific handling
    extension = f".{filename.lower().rsplit('.', 1)[-1]}" if "." in filename else ""
    start_time = time.perf_counter()

    try:
        # Load image (lazy - only metadata read at this point)
        # The empty string tells vips to auto-detect format from buffer
        image = pyvips.Image.new_from_buffer(image_bytes, "")

        # Determine output format based on transparency and file type
        has_alpha = image.hasalpha()  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
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
            image = image.flatten(background=[255, 255, 255])  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]

        # Step 2: Handle color space conversions
        # libvips handles most conversions automatically, but ensure sRGB for web
        if image.interpretation != "srgb":  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
            # Convert to sRGB if not already
            if image.interpretation in ["cmyk", "lab", "xyz"]:  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
                image = image.colourspace("srgb")  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]

        # Step 3: Resize if needed
        if max_dimension and max(image.width, image.height) > max_dimension:  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
            # thumbnail_image maintains aspect ratio
            # Uses high-quality interpolation (lanczos3 by default)
            image = image.thumbnail_image(max_dimension, height=max_dimension)  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]

        # Step 4: Convert to output format
        # Pipeline executes NOW when we call save
        if output_format == "jpeg":
            output_bytes = image.jpegsave_buffer(  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
                Q=quality,  # JPEG quality
                optimize_coding=True,  # Optimize Huffman tables
                keep=0,  # Remove all metadata (smaller files) - VIPS_FOREIGN_KEEP_NONE
                interlace=False,  # Standard (not progressive) JPEG
            )
        else:  # PNG
            output_bytes = image.pngsave_buffer(  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
                compression=6,  # PNG compression level (0-9)
                keep=0,  # Remove all metadata - VIPS_FOREIGN_KEEP_NONE
            )

        # Convert pyvips buffer to bytes
        result_bytes = bytes(output_bytes)
        duration_ms = (time.perf_counter() - start_time) * 1000

        # Extract just the filename from the path
        basename = os.path.basename(filename)

        logger.info(
            f"libvips: {basename} → {mime_type} "
            f"({len(image_bytes) / 1024:.0f} → {len(result_bytes) / 1024:.0f} KB, {duration_ms:.0f} ms)"
        )
        return result_bytes, mime_type

    except pyvips.Error as e:
        error_msg = str(e)

        # Check for missing loader (e.g., HEIC support)
        # Distinguish between "format not supported" vs "corrupt data"
        if "no known loader" in error_msg.lower():
            # This is truly an unsupported format
            if extension in {".heic", ".heif"}:
                raise ImportError(
                    "HEIC/HEIF support requires libvips built with libheif. "
                    "Please ensure libheif is installed."
                ) from e
            raise ImportError(
                f"Image format {extension} not supported. "
                f"libvips may be missing required loader."
            ) from e
        elif (
            "unable to load from buffer" in error_msg.lower()
            or "not in a known format" in error_msg.lower()
        ):
            # This is corrupt/invalid image data
            raise ValueError(f"Failed to convert image: {error_msg}") from e

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
            "format": image.get("vips-loader")  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
            if image.get_typeof("vips-loader") != 0  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
            else "unknown",
            "mode": image.interpretation,  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
            "size": (image.width, image.height),  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
            "width": image.width,  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
            "height": image.height,  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
            "bands": image.bands,  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
            "has_alpha": image.hasalpha(),  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
            "info": {
                "interpretation": image.interpretation,  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
                "format": image.format,  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
                "coding": image.coding,  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
            },
        }
    except Exception as e:
        raise ValueError(f"Failed to read image info: {str(e)}") from e
