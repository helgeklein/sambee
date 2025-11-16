"""
Single source of truth for all image conversion settings.

These settings apply to both:
- Direct conversions (libvips)
- Preprocessed conversions (ImageMagick/GraphicsMagick → target format)

This module centralizes all image quality, compression, and format settings
to ensure consistency across the entire image processing pipeline.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ImageConversionSettings:
    """
    Image conversion settings for browser delivery.

    All settings are optimized for web delivery with a balance between
    quality and file size. These settings are used by both libvips and
    external preprocessors (ImageMagick/GraphicsMagick).
    """

    # JPEG settings
    jpeg_quality: int = 85  # 1-100, balance quality vs file size
    jpeg_optimize_coding: bool = True  # Optimize Huffman tables (smaller files)
    jpeg_progressive: bool = False  # Standard (not progressive) JPEG

    # PNG settings
    png_compression: int = 6  # 0-9, balance speed vs compression

    # Common settings
    strip_metadata: bool = True  # Remove EXIF/IPTC for privacy & smaller size
    color_space: str = "srgb"  # Web standard color space

    # Alpha channel handling for JPEG (which doesn't support transparency)
    jpeg_background: tuple[int, int, int] = (255, 255, 255)  # White background


# Single instance - import this everywhere
IMAGE_SETTINGS = ImageConversionSettings()


def get_imagemagick_jpeg_args(
    settings: ImageConversionSettings = IMAGE_SETTINGS,
) -> list[str]:
    """
    Get ImageMagick command arguments for JPEG output.

    Returns command-line arguments that configure JPEG encoding
    with the specified quality and metadata handling.

    Args:
        settings: Image conversion settings to use

    Returns:
        List of command arguments (e.g., ['-quality', '85', '-strip'])

    Example:
        >>> args = get_imagemagick_jpeg_args()
        >>> # Use in ImageMagick command: magick input.psd -flatten [args...] output.jpg
    """
    args = [
        "-quality",
        str(settings.jpeg_quality),
    ]
    if settings.strip_metadata:
        args.append("-strip")
    return args


def get_imagemagick_png_args(
    settings: ImageConversionSettings = IMAGE_SETTINGS,
) -> list[str]:
    """
    Get ImageMagick command arguments for PNG output.

    Returns command-line arguments that configure PNG encoding
    with the specified compression level and metadata handling.

    PNG quality in ImageMagick maps to zlib compression:
    - Quality 0-9: Maps to zlib levels 9-1 (reversed!)
    - Quality 10-99: Uses different strategy
    - Our default of 92 maps to zlib level 6 (good balance)

    Args:
        settings: Image conversion settings to use

    Returns:
        List of command arguments (e.g., ['-quality', '92', '-strip'])

    Example:
        >>> args = get_imagemagick_png_args()
        >>> # Use in ImageMagick command: magick input.psd -flatten [args...] output.png
    """
    # ImageMagick PNG quality mapping to get zlib compression level 6:
    # We use quality 92 which results in zlib compression 6
    png_quality = 92

    args = [
        "-quality",
        str(png_quality),
    ]
    if settings.strip_metadata:
        args.append("-strip")
    return args


def get_graphicsmagick_jpeg_args(
    settings: ImageConversionSettings = IMAGE_SETTINGS,
) -> list[str]:
    """
    Get GraphicsMagick command arguments for JPEG output.

    GraphicsMagick uses similar syntax to ImageMagick for JPEG encoding.

    Args:
        settings: Image conversion settings to use

    Returns:
        List of command arguments (e.g., ['-quality', '85', '-strip'])

    Example:
        >>> args = get_graphicsmagick_jpeg_args()
        >>> # Use in GM command: gm convert input.psd -flatten [args...] output.jpg
    """
    args = [
        "-quality",
        str(settings.jpeg_quality),
    ]
    if settings.strip_metadata:
        args.append("-strip")
    return args


def get_graphicsmagick_png_args(
    settings: ImageConversionSettings = IMAGE_SETTINGS,
) -> list[str]:
    """
    Get GraphicsMagick command arguments for PNG output.

    GraphicsMagick PNG quality works similarly to ImageMagick.

    Args:
        settings: Image conversion settings to use

    Returns:
        List of command arguments (e.g., ['-quality', '92', '-strip'])

    Example:
        >>> args = get_graphicsmagick_png_args()
        >>> # Use in GM command: gm convert input.psd -flatten [args...] output.png
    """
    # GraphicsMagick PNG quality (same as ImageMagick)
    png_quality = 92

    args = [
        "-quality",
        str(png_quality),
    ]
    if settings.strip_metadata:
        args.append("-strip")
    return args


def get_libvips_jpeg_kwargs(
    settings: ImageConversionSettings = IMAGE_SETTINGS,
) -> dict[str, int | bool]:
    """
    Get libvips jpegsave_buffer() keyword arguments.

    Returns a dictionary of keyword arguments that can be passed
    directly to pyvips Image.jpegsave_buffer() method.

    Args:
        settings: Image conversion settings to use

    Returns:
        Dict of kwargs for pyvips image.jpegsave_buffer()

    Example:
        >>> kwargs = get_libvips_jpeg_kwargs()
        >>> output_bytes = image.jpegsave_buffer(**kwargs)
    """
    return {
        "Q": settings.jpeg_quality,
        "optimize_coding": settings.jpeg_optimize_coding,
        "keep": 0 if settings.strip_metadata else 1,  # VIPS_FOREIGN_KEEP_NONE
        "interlace": settings.jpeg_progressive,
    }


def get_libvips_png_kwargs(
    settings: ImageConversionSettings = IMAGE_SETTINGS,
) -> dict[str, int]:
    """
    Get libvips pngsave_buffer() keyword arguments.

    Returns a dictionary of keyword arguments that can be passed
    directly to pyvips Image.pngsave_buffer() method.

    Args:
        settings: Image conversion settings to use

    Returns:
        Dict of kwargs for pyvips image.pngsave_buffer()

    Example:
        >>> kwargs = get_libvips_png_kwargs()
        >>> output_bytes = image.pngsave_buffer(**kwargs)
    """
    return {
        "compression": settings.png_compression,
        "keep": 0 if settings.strip_metadata else 1,  # VIPS_FOREIGN_KEEP_NONE
    }
