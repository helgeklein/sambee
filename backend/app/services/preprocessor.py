"""
Image preprocessing service for formats not natively supported by libvips.

This module provides a preprocessing pipeline that converts exotic image formats
(like PSD, PSB) directly into browser-ready formats (JPEG, PNG). The preprocessor
uses external tools (ImageMagick, GraphicsMagick) to handle formats that libvips
doesn't natively support.

Architecture:
- PreprocessorInterface: Abstract base class for all preprocessors
- ImageMagickPreprocessor: Primary implementation using ImageMagick
- GraphicsMagickPreprocessor: Fallback implementation using GraphicsMagick
- PreprocessorRegistry: Maps file formats to appropriate preprocessors
- PreprocessorFactory: Creates preprocessor instances based on configuration

Design Principles:
1. Direct conversion - preprocess straight to browser-ready format (no intermediate)
2. Centralized settings - all conversion settings from IMAGE_SETTINGS
3. Security first - validate inputs, sanitize paths, timeout operations
4. Performance matters - single conversion step, efficient temp file handling
5. Fail gracefully - return clear errors, don't crash the service
"""

import logging
import os
import subprocess
import tempfile
import time
from abc import ABC, abstractmethod
from enum import Enum
from pathlib import Path
from typing import Optional

from app.core.image_settings import (
    get_graphicsmagick_jpeg_args,
    get_graphicsmagick_png_args,
    get_imagemagick_jpeg_args,
    get_imagemagick_png_args,
)

logger = logging.getLogger(__name__)


class PreprocessorType(Enum):
    """Available preprocessor implementations."""

    GRAPHICSMAGICK = "graphicsmagick"
    IMAGEMAGICK = "imagemagick"


class PreprocessorError(Exception):
    """Base exception for preprocessor errors."""

    pass


class PreprocessorInterface(ABC):
    """
    Abstract base class for image preprocessors.

    Preprocessors convert exotic formats directly into browser-ready formats
    (JPEG, PNG). All conversion settings come from centralized IMAGE_SETTINGS.
    """

    # Formats this preprocessor can handle
    SUPPORTED_FORMATS: set[str] = set()

    # Maximum file size to preprocess (100 MB default)
    MAX_FILE_SIZE = 100 * 1024 * 1024

    # Maximum processing time (30 seconds default)
    TIMEOUT_SECONDS = 30

    @abstractmethod
    def convert_to_final_format(
        self, input_data: bytes, filename: str, output_format: str = "jpeg"
    ) -> bytes:
        """
        Convert an exotic format file directly to browser-ready format.

        Always applies browser-optimized settings from IMAGE_SETTINGS.
        This is a direct conversion with no intermediate steps.
        Operates entirely in memory - no disk I/O.

        Args:
            input_data: Raw image file bytes (e.g., PSD file contents)
            filename: Original filename (for logging and validation)
            output_format: Target browser format (jpeg, png). Default: jpeg

        Returns:
            Converted image bytes (in-memory, not written to disk)

        Raises:
            PreprocessorError: If conversion fails
            ValueError: If file too large or format unsupported
        """
        pass

    @abstractmethod
    def check_availability(self) -> bool:
        """
        Check if the preprocessor tool is available on the system.

        Returns:
            True if the tool is installed and accessible, False otherwise
        """
        pass

    def validate_input(self, input_data: bytes, filename: str) -> None:
        """
        Validate input data before processing.

        Args:
            input_data: Raw image file bytes
            filename: Original filename (for extension validation)

        Raises:
            ValueError: If data is empty, file is too large, or has invalid extension
        """
        # Check for empty data
        if not input_data or len(input_data) == 0:
            raise ValueError("Empty input data")

        # Check file size
        file_size = len(input_data)
        if file_size > self.MAX_FILE_SIZE:
            raise ValueError(
                f"File too large: {file_size} bytes (max: {self.MAX_FILE_SIZE})"
            )

        # Check extension from filename
        extension = Path(filename).suffix.lower().lstrip(".")
        if extension not in self.SUPPORTED_FORMATS:
            raise ValueError(
                f"Unsupported format: {extension}. "
                f"Supported: {', '.join(sorted(self.SUPPORTED_FORMATS))}"
            )

    def _create_temp_file(self, suffix: str) -> Path:
        """
        Create a temporary file for intermediate output.

        Args:
            suffix: File suffix (e.g., '.png')

        Returns:
            Path to the temporary file
        """
        fd, temp_path = tempfile.mkstemp(suffix=suffix, prefix="sambee_preprocessed_")
        os.close(fd)  # Close the file descriptor, we only need the path
        return Path(temp_path)


class GraphicsMagickPreprocessor(PreprocessorInterface):
    """
    GraphicsMagick-based preprocessor for PSD and PSB files.

    GraphicsMagick is preferred over ImageMagick for:
    - Better performance (2-3x faster for typical PSD files)
    - Lower memory usage (~50% less)
    - Simpler, more focused tool with smaller attack surface
    - More stable command-line interface

    Supported formats: PSD, PSB (Photoshop Document, Photoshop Big)
    """

    SUPPORTED_FORMATS = {"psd", "psb"}

    def __init__(self) -> None:
        """Initialize the GraphicsMagick preprocessor."""
        self.gm_command = "gm"

    def check_availability(self) -> bool:
        """Check if GraphicsMagick is installed and accessible."""
        try:
            result = subprocess.run(
                [self.gm_command, "version"],
                capture_output=True,
                timeout=5,
                check=False,
            )
            return result.returncode == 0
        except (subprocess.SubprocessError, FileNotFoundError):
            return False

    def convert_to_final_format(
        self, input_data: bytes, filename: str, output_format: str = "jpeg"
    ) -> bytes:
        """
        Convert PSD/PSB directly to browser-ready format using GraphicsMagick.

        Applies browser-optimized settings from IMAGE_SETTINGS.
        Returns image bytes in memory without writing to disk.
        Operates entirely in memory - no disk I/O.

        Args:
            input_data: Raw PSD/PSB file bytes
            filename: Original filename (for logging and validation)
            output_format: Browser format (jpeg, png). Default: jpeg

        Returns:
            Converted image bytes (in-memory)

        Raises:
            PreprocessorError: If conversion fails
        """
        # Validate input
        self.validate_input(input_data, filename)

        # Check tool availability
        if not self.check_availability():
            raise PreprocessorError(
                "GraphicsMagick is not installed or not accessible. "
                "Install with: apt-get install graphicsmagick"
            )

        # Validate output format
        valid_formats = {"png", "jpeg", "jpg"}
        if output_format.lower() not in valid_formats:
            raise ValueError(
                f"Invalid output format: {output_format}. "
                f"Valid formats: {', '.join(sorted(valid_formats))}"
            )

        # Normalize format
        if output_format.lower() == "jpg":
            output_format = "jpeg"

        try:
            # Get file extension for format hint
            extension = Path(filename).suffix.lower().lstrip(".")

            # Build GraphicsMagick command
            # gm convert {format}:- [options] {format}:-
            # First "-" reads from stdin, second "-" writes to stdout
            command = [
                self.gm_command,
                "convert",
                # Input from stdin with format hint
                f"{extension}:-[0]",  # [0] selects the flattened composite
                # Flatten layers into single image (merge all layers)
                "-flatten",
            ]

            # Add browser-optimized settings from centralized config
            if output_format == "jpeg":
                command.extend(get_graphicsmagick_jpeg_args())
            elif output_format == "png":
                command.extend(get_graphicsmagick_png_args())

            # Output to stdout in specified format
            command.append(f"{output_format}:-")

            logger.debug(
                f"Converting {filename} to {output_format.upper()} with GraphicsMagick (in-memory)"
            )
            logger.debug(f"Command: {' '.join(command)}")

            # Execute conversion - pipe input via stdin, capture stdout
            start_time = time.perf_counter()
            result = subprocess.run(
                command,
                input=input_data,  # Send data via stdin
                capture_output=True,
                timeout=self.TIMEOUT_SECONDS,
                check=False,
            )
            duration_ms = (time.perf_counter() - start_time) * 1000

            if result.returncode != 0:
                error_msg = result.stderr.decode("utf-8", errors="replace")
                raise PreprocessorError(
                    f"GraphicsMagick conversion failed: {error_msg}"
                )

            # Verify output was produced
            if not result.stdout or len(result.stdout) == 0:
                raise PreprocessorError("Conversion produced no output")

            output_bytes = result.stdout

            logger.debug(
                f"Converted (ImageMagick): {filename} ({len(input_data) / 1024:.0f} KB) → "
                f"{output_format.upper()} ({len(output_bytes) / 1024:.0f} KB) "
                f"in {duration_ms:.0f} ms"
            )

            return output_bytes

        except subprocess.TimeoutExpired:
            raise PreprocessorError(
                f"Conversion timed out after {self.TIMEOUT_SECONDS} seconds. "
                "File may be too complex or corrupted."
            )


class ImageMagickPreprocessor(PreprocessorInterface):
    """
    ImageMagick-based preprocessor for PSD and PSB files.

    This is a fallback preprocessor for cases where GraphicsMagick is unavailable
    or when dealing with complex PSD files that GraphicsMagick struggles with.

    ImageMagick advantages:
    - Better support for complex PSD features (adjustment layers, smart objects)
    - More actively maintained
    - Better font rendering

    ImageMagick disadvantages:
    - Slower than GraphicsMagick (2-3x)
    - Higher memory usage
    - Larger attack surface (more CVEs historically)

    Supported formats: PSD, PSB
    """

    SUPPORTED_FORMATS = {"psd", "psb"}

    def __init__(self) -> None:
        """Initialize the ImageMagick preprocessor."""
        self.convert_command = "convert"  # ImageMagick 6
        self.magick_command = "magick"  # ImageMagick 7

    def check_availability(self) -> bool:
        """Check if ImageMagick is installed and accessible."""
        # Try ImageMagick 7 first (magick command)
        try:
            result = subprocess.run(
                [self.magick_command, "--version"],
                capture_output=True,
                timeout=5,
                check=False,
            )
            if result.returncode == 0:
                return True
        except (subprocess.SubprocessError, FileNotFoundError):
            pass

        # Fall back to ImageMagick 6 (convert command)
        try:
            result = subprocess.run(
                [self.convert_command, "--version"],
                capture_output=True,
                timeout=5,
                check=False,
            )
            return result.returncode == 0
        except (subprocess.SubprocessError, FileNotFoundError):
            return False

    def _get_command(self) -> str:
        """Determine which ImageMagick command to use (v6 or v7)."""
        # Try ImageMagick 7 first
        try:
            result = subprocess.run(
                [self.magick_command, "--version"],
                capture_output=True,
                timeout=5,
                check=False,
            )
            if result.returncode == 0:
                return self.magick_command
        except (subprocess.SubprocessError, FileNotFoundError):
            pass

        # Fall back to ImageMagick 6
        return self.convert_command

    def convert_to_final_format(
        self, input_data: bytes, filename: str, output_format: str = "jpeg"
    ) -> bytes:
        """
        Convert PSD/PSB directly to browser-ready format using ImageMagick.

        Applies browser-optimized settings from IMAGE_SETTINGS.
        Returns image bytes in memory without writing to disk.
        Operates entirely in memory - no disk I/O.

        Args:
            input_data: Raw PSD/PSB file bytes
            filename: Original filename (for logging and validation)
            output_format: Browser format (jpeg, png). Default: jpeg

        Returns:
            Converted image bytes (in-memory)

        Raises:
            PreprocessorError: If conversion fails
        """
        # Validate input
        self.validate_input(input_data, filename)

        # Check tool availability
        if not self.check_availability():
            raise PreprocessorError(
                "ImageMagick is not installed or not accessible. "
                "Install with: apt-get install imagemagick"
            )

        # Validate output format
        valid_formats = {"png", "jpeg", "jpg"}
        if output_format.lower() not in valid_formats:
            raise ValueError(
                f"Invalid output format: {output_format}. "
                f"Valid formats: {', '.join(sorted(valid_formats))}"
            )

        # Normalize format
        if output_format.lower() == "jpg":
            output_format = "jpeg"

        try:
            # Determine which command to use (IM6 vs IM7)
            command_name = self._get_command()

            # Get file extension for format hint
            extension = Path(filename).suffix.lower().lstrip(".")

            # Build ImageMagick command
            # Note: ImageMagick 7 requires input file BEFORE operations
            # {format}:- reads from stdin, {format}:- writes to stdout
            command = [
                command_name,
                # Input from stdin with format hint
                f"{extension}:-[0]",  # [0] selects the flattened composite
                # Flatten layers into single image
                "-flatten",
            ]

            # Add browser-optimized settings from centralized config
            if output_format == "jpeg":
                command.extend(get_imagemagick_jpeg_args())
            elif output_format == "png":
                command.extend(get_imagemagick_png_args())

            # Output to stdout in specified format
            command.append(f"{output_format}:-")

            logger.debug(
                f"Converting {filename} to {output_format.upper()} with ImageMagick (in-memory)"
            )
            logger.debug(f"Command: {' '.join(command)}")

            # Execute conversion - pipe input via stdin, capture stdout
            start_time = time.perf_counter()
            result = subprocess.run(
                command,
                input=input_data,  # Send data via stdin
                capture_output=True,
                timeout=self.TIMEOUT_SECONDS,
                check=False,
            )
            duration_ms = (time.perf_counter() - start_time) * 1000

            if result.returncode != 0:
                error_msg = result.stderr.decode("utf-8", errors="replace")
                raise PreprocessorError(f"ImageMagick conversion failed: {error_msg}")

            # Verify output was produced
            if not result.stdout or len(result.stdout) == 0:
                raise PreprocessorError("Conversion produced no output")

            output_bytes = result.stdout

            logger.debug(
                f"Converted (ImageMagick): {filename} ({len(input_data) / 1024:.0f} KB) → "
                f"{output_format.upper()} ({len(output_bytes) / 1024:.0f} KB) "
                f"in {duration_ms:.0f} ms"
            )

            return output_bytes

        except subprocess.TimeoutExpired:
            raise PreprocessorError(
                f"Conversion timed out after {self.TIMEOUT_SECONDS} seconds. "
                "File may be too complex or corrupted."
            )


class PreprocessorRegistry:
    """
    Central registry for preprocessor format mappings.

    This registry provides a single source of truth for which file formats
    require preprocessing and which preprocessor implementation to use.

    Usage:
        # Check if format needs preprocessing
        if PreprocessorRegistry.requires_preprocessing("psd"):
            preprocessor = PreprocessorRegistry.get_preprocessor_for_format("psd")

        # Get all preprocessable formats
        formats = PreprocessorRegistry.get_supported_formats()
    """

    # Format-to-preprocessor-type mapping
    # This is the single source of truth for preprocessor registrations
    _FORMAT_REGISTRY: dict[str, type[PreprocessorInterface]] = {
        # Adobe Photoshop formats - handled by ImageMagick (preferred) or GraphicsMagick
        # ImageMagick is preferred as it has better PSD delegate support across distributions
        "psd": ImageMagickPreprocessor,
        "psb": ImageMagickPreprocessor,
    }

    @classmethod
    def requires_preprocessing(cls, extension: str) -> bool:
        """
        Check if a file extension requires preprocessing.

        Args:
            extension: File extension (with or without dot, case-insensitive)

        Returns:
            True if the format requires preprocessing, False otherwise
        """
        # Normalize extension (remove dot, lowercase)
        ext = extension.lower().lstrip(".")
        return ext in cls._FORMAT_REGISTRY

    @classmethod
    def get_preprocessor_for_format(
        cls, extension: str, preprocessor_type: Optional[str] = None
    ) -> PreprocessorInterface:
        """
        Get a preprocessor instance for the given file format.

        Args:
            extension: File extension (with or without dot, case-insensitive)
            preprocessor_type: Optional override for preprocessor type
                              ("graphicsmagick", "imagemagick", "auto")
                              If None, uses default for this format.

        Returns:
            PreprocessorInterface instance

        Raises:
            ValueError: If format is not registered for preprocessing
            PreprocessorError: If preprocessor is not available
        """
        # Normalize extension
        ext = extension.lower().lstrip(".")

        if ext not in cls._FORMAT_REGISTRY:
            raise ValueError(
                f"Format '{ext}' is not registered for preprocessing. "
                f"Supported formats: {', '.join(sorted(cls._FORMAT_REGISTRY.keys()))}"
            )

        # If specific preprocessor type requested, use PreprocessorFactory
        if preprocessor_type is not None:
            return PreprocessorFactory.create(preprocessor_type)

        # Otherwise, use the registered default for this format
        preprocessor_class = cls._FORMAT_REGISTRY[ext]

        # Create instance and check availability
        instance = preprocessor_class()
        if not instance.check_availability():
            # Try fallback options if the default isn't available
            logger.warning(
                f"{preprocessor_class.__name__} not available, trying fallbacks"
            )
            # For PSD/PSB, try alternate preprocessor
            fallback: PreprocessorInterface | None = None
            if isinstance(instance, ImageMagickPreprocessor):
                fallback = GraphicsMagickPreprocessor()
                if fallback.check_availability():
                    logger.info("Falling back to GraphicsMagick")
                    return fallback
            elif isinstance(instance, GraphicsMagickPreprocessor):
                fallback = ImageMagickPreprocessor()
                if fallback.check_availability():
                    logger.info("Falling back to ImageMagick")
                    return fallback

            # No fallback available
            raise PreprocessorError(
                f"No available preprocessor for format '{ext}'. "
                f"Install GraphicsMagick or ImageMagick."
            )

        return instance

    @classmethod
    def get_supported_formats(cls) -> set[str]:
        """
        Get all file formats that have registered preprocessors.

        Returns:
            Set of file extensions (lowercase, without dot) that can be preprocessed
        """
        return set(cls._FORMAT_REGISTRY.keys())

    @classmethod
    def register_format(
        cls, extension: str, preprocessor_class: type[PreprocessorInterface]
    ) -> None:
        """
        Register a new format with a preprocessor.

        This allows dynamic registration of new preprocessors at runtime.

        Args:
            extension: File extension (without dot, case-insensitive)
            preprocessor_class: Preprocessor class to handle this format

        Example:
            # Register a custom preprocessor for CDR files
            PreprocessorRegistry.register_format("cdr", CorelDrawPreprocessor)
        """
        ext = extension.lower().lstrip(".")
        cls._FORMAT_REGISTRY[ext] = preprocessor_class
        logger.info(
            f"Registered preprocessor {preprocessor_class.__name__} for .{ext} files"
        )


class PreprocessorFactory:
    """
    Factory for creating preprocessor instances based on configuration.

    Configuration is controlled by the PREPROCESSOR environment variable:
    - "graphicsmagick" (default): Use GraphicsMagick
    - "imagemagick": Use ImageMagick
    - "auto": Auto-detect available tool (prefers GraphicsMagick)

    Note: For format-specific preprocessing, use PreprocessorRegistry instead.
    This factory is primarily for manual preprocessor creation.

    Usage:
        # Recommended: Use registry for format-based lookup
        preprocessor = PreprocessorRegistry.get_preprocessor_for_format("psd")

        # Alternative: Manual creation with factory
        preprocessor = PreprocessorFactory.create("graphicsmagick")
        intermediate_file = preprocessor.convert_to_intermediate(psd_file)
    """

    @staticmethod
    def create(preprocessor_type: Optional[str] = None) -> PreprocessorInterface:
        """
        Create a preprocessor instance.

        Args:
            preprocessor_type: Type of preprocessor to create.
                              If None, reads from PREPROCESSOR env var.
                              Valid values: "graphicsmagick", "imagemagick", "auto"

        Returns:
            PreprocessorInterface instance

        Raises:
            PreprocessorError: If requested preprocessor is not available
        """
        # Get configuration
        if preprocessor_type is None:
            preprocessor_type = os.getenv("PREPROCESSOR", "auto").lower()

        logger.debug(f"Creating preprocessor: {preprocessor_type}")

        # Auto-detect: prefer GraphicsMagick, fallback to ImageMagick
        if preprocessor_type == "auto":
            gm = GraphicsMagickPreprocessor()
            if gm.check_availability():
                logger.info("Using GraphicsMagick preprocessor (auto-detected)")
                return gm

            im = ImageMagickPreprocessor()
            if im.check_availability():
                logger.info("Using ImageMagick preprocessor (auto-detected)")
                return im

            raise PreprocessorError(
                "No preprocessor available. Install GraphicsMagick or ImageMagick:\n"
                "  apt-get install graphicsmagick  (recommended)\n"
                "  apt-get install imagemagick      (alternative)"
            )

        # GraphicsMagick explicitly requested
        elif preprocessor_type == "graphicsmagick":
            gm = GraphicsMagickPreprocessor()
            if not gm.check_availability():
                raise PreprocessorError(
                    "GraphicsMagick not available. Install with: "
                    "apt-get install graphicsmagick"
                )
            logger.info("Using GraphicsMagick preprocessor")
            return gm

        # ImageMagick explicitly requested
        elif preprocessor_type == "imagemagick":
            im = ImageMagickPreprocessor()
            if not im.check_availability():
                raise PreprocessorError(
                    "ImageMagick not available. Install with: "
                    "apt-get install imagemagick"
                )
            logger.info("Using ImageMagick preprocessor")
            return im

        else:
            raise ValueError(
                f"Invalid preprocessor type: {preprocessor_type}. "
                "Valid values: graphicsmagick, imagemagick, auto"
            )

    @staticmethod
    def get_supported_formats() -> set[str]:
        """
        Get all formats supported by available preprocessors.

        Returns:
            Set of supported file extensions (lowercase, without dot)
        """
        formats = set()

        # Check GraphicsMagick
        gm = GraphicsMagickPreprocessor()
        if gm.check_availability():
            formats.update(gm.SUPPORTED_FORMATS)

        # Check ImageMagick
        im = ImageMagickPreprocessor()
        if im.check_availability():
            formats.update(im.SUPPORTED_FORMATS)

        return formats
