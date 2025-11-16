"""
Image conversion service using libvips for high-performance processing.

Converts non-browser-native image formats to JPEG/PNG for preview.
Examples::
- TIFF/TIF → JPEG
- ICO → PNG (preserves transparency)
- JPEG → preserved (browser-native)
- PSD/PSB → PNG (via GraphicsMagick preprocessor)

Uses libvips for:
- Fast conversion
- Low memory usage
- Streaming, tiled processing
- Automatic multi-threading

For formats libvips doesn't natively support (PSD, PSB), we use preprocessors
(GraphicsMagick or ImageMagick) to convert to an intermediate format first.
"""

import logging
import os
import time
from typing import Any, Optional

import pyvips

from app.core.image_settings import get_libvips_jpeg_kwargs, get_libvips_png_kwargs
from app.services.preprocessor import (
    PreprocessorError,
    PreprocessorRegistry,
)

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
    max_dimension: Optional[int] = None,
) -> tuple[bytes, str, str, float]:
    """
    Convert an image to JPEG/PNG format.

    For formats not natively supported by libvips (PSD, PSB), converts
    directly to final browser-ready format using external preprocessors.
    For other formats, uses libvips for conversion.

    Args:
        image_bytes: Raw image file bytes
        filename: Original filename (used to determine format)
        max_dimension: Optional max width/height for downscaling large images

    Returns:
        Tuple of (converted_bytes, mime_type, converter_name, duration_ms)
        - converted_bytes: The converted image bytes
        - mime_type: MIME type of the output (e.g., "image/jpeg")
        - converter_name: Name of converter used ("ImageMagick", "GraphicsMagick", or "libvips")
        - duration_ms: Conversion duration in milliseconds

    Raises:
        ValueError: If the image cannot be converted
        ImportError: If HEIC support is needed but not available
    """
    if not VIPS_AVAILABLE:
        raise ImportError("libvips is not available")

    # Extract extension for format-specific handling
    extension = f".{filename.lower().rsplit('.', 1)[-1]}" if "." in filename else ""

    # Check if this format needs preprocessing (use registry)
    needs_preprocessing = PreprocessorRegistry.requires_preprocessing(extension)

    # Path 1: Direct conversion for preprocessed formats (PSD, PSB)
    if needs_preprocessing:
        try:
            start_time = time.perf_counter()

            # Get preprocessor
            preprocessor = PreprocessorRegistry.get_preprocessor_for_format(extension)

            # Get converter name from preprocessor class
            converter_name = preprocessor.__class__.__name__.replace(
                "Preprocessor", ""
            )  # "ImageMagick" or "GraphicsMagick"

            # Convert DIRECTLY to final browser-ready format (in-memory)
            # PSD/PSB files don't have alpha channel, so use JPEG
            # Vector formats (EPS/AI) may have transparency, so use PNG
            if extension in {".eps", ".ai"}:
                output_format = "png"
            else:
                output_format = "jpeg"
            logger.debug(
                f"Direct conversion (in-memory): {filename} → {output_format.upper()}"
            )

            # Convert bytes directly - no temp files!
            result_bytes = preprocessor.convert_to_final_format(
                image_bytes, filename, output_format=output_format
            )

            duration_ms = (time.perf_counter() - start_time) * 1000
            mime_type = f"image/{output_format}"

            logger.debug(
                f"Direct conversion (in-memory): {filename} → {mime_type} "
                f"({len(image_bytes) / 1024:.0f} → {len(result_bytes) / 1024:.0f} KB) "
                f"via {converter_name} in {duration_ms:.0f} ms"
            )

            return result_bytes, mime_type, converter_name, duration_ms

        except PreprocessorError as e:
            # Preprocessing failed - provide helpful error
            raise ValueError(
                f"Failed to convert {extension.upper()} file: {str(e)}"
            ) from e
        except Exception as e:
            # Conversion error
            raise ValueError(
                f"Failed to convert {extension.upper()} file: {str(e)}"
            ) from e

    # Path 2: libvips conversion for all other formats
    try:
        start_time = time.perf_counter()

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
        # Use centralized settings from IMAGE_SETTINGS
        if output_format == "jpeg":
            jpeg_kwargs = get_libvips_jpeg_kwargs()
            output_bytes = image.jpegsave_buffer(**jpeg_kwargs)  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]
        else:  # PNG
            png_kwargs = get_libvips_png_kwargs()
            output_bytes = image.pngsave_buffer(**png_kwargs)  # pyright: ignore[reportOptionalMemberAccess, reportAttributeAccessIssue]

        # Convert pyvips buffer to bytes
        result_bytes = bytes(output_bytes)
        duration_ms = (time.perf_counter() - start_time) * 1000

        # Extract just the filename from the path
        basename = os.path.basename(filename)

        logger.debug(
            f"libvips: {basename} → {mime_type} "
            f"({len(image_bytes) / 1024:.0f} → {len(result_bytes) / 1024:.0f} KB, {duration_ms:.0f} ms)"
        )
        return result_bytes, mime_type, "libvips", duration_ms

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
