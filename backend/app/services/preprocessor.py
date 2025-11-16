"""
Image preprocessing service for formats not natively supported by libvips.

This module provides a preprocessing pipeline that converts exotic image formats
(like PSD, PSB) into formats that libvips can handle. The preprocessor acts as
a bridge between external tools (GraphicsMagick) and our libvips-based conversion.

Architecture:
- PreprocessorInterface: Abstract base class for all preprocessors
- GraphicsMagickPreprocessor: Main implementation using GraphicsMagick
- ImageMagickPreprocessor: Fallback implementation using ImageMagick
- PreprocessorFactory: Creates appropriate preprocessor based on configuration

Design Principles:
1. Use libvips natively whenever possible - only preprocess when necessary
2. Keep it simple - don't over-engineer for hypothetical future needs
3. Security first - validate inputs, sanitize paths, timeout operations
4. Performance matters - cache converted files, use efficient temp file handling
5. Fail gracefully - return clear errors, don't crash the service
"""

import logging
import os
import subprocess
import tempfile
from abc import ABC, abstractmethod
from enum import Enum
from pathlib import Path
from typing import Optional

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

    Preprocessors convert exotic formats into formats that libvips can handle.
    All preprocessors must implement the convert_to_intermediate() method.
    """

    # Formats this preprocessor can handle
    SUPPORTED_FORMATS: set[str] = set()

    # Maximum file size to preprocess (100 MB default)
    MAX_FILE_SIZE = 100 * 1024 * 1024

    # Maximum processing time (30 seconds default)
    TIMEOUT_SECONDS = 30

    @abstractmethod
    def convert_to_intermediate(
        self, input_path: Path, output_format: str = "png"
    ) -> Path:
        """
        Convert an exotic format file to an intermediate format libvips can handle.

        Args:
            input_path: Path to the input file (e.g., PSD file)
            output_format: Target format (png, tiff, jpeg). Default: png

        Returns:
            Path to the converted intermediate file (in temp directory)

        Raises:
            PreprocessorError: If conversion fails
            FileNotFoundError: If input file doesn't exist
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

    def validate_input(self, input_path: Path) -> None:
        """
        Validate input file before processing.

        Args:
            input_path: Path to validate

        Raises:
            FileNotFoundError: If file doesn't exist
            ValueError: If file is too large or has invalid extension
        """
        if not input_path.exists():
            raise FileNotFoundError(f"Input file not found: {input_path}")

        # Check file size
        file_size = input_path.stat().st_size
        if file_size > self.MAX_FILE_SIZE:
            raise ValueError(
                f"File too large: {file_size} bytes (max: {self.MAX_FILE_SIZE})"
            )

        # Check extension
        extension = input_path.suffix.lower().lstrip(".")
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

    def convert_to_intermediate(
        self, input_path: Path, output_format: str = "png"
    ) -> Path:
        """
        Convert PSD/PSB to PNG using GraphicsMagick.

        Args:
            input_path: Path to PSD/PSB file
            output_format: Output format (png, tiff, jpeg). Default: png

        Returns:
            Path to converted PNG file in temp directory

        Raises:
            PreprocessorError: If conversion fails
        """
        # Validate input
        self.validate_input(input_path)

        # Check tool availability
        if not self.check_availability():
            raise PreprocessorError(
                "GraphicsMagick is not installed or not accessible. "
                "Install with: apt-get install graphicsmagick"
            )

        # Validate output format
        valid_formats = {"png", "tiff", "jpeg", "jpg"}
        if output_format.lower() not in valid_formats:
            raise ValueError(
                f"Invalid output format: {output_format}. "
                f"Valid formats: {', '.join(sorted(valid_formats))}"
            )

        # Create temporary output file
        output_path = self._create_temp_file(f".{output_format}")

        try:
            # Build GraphicsMagick command
            # gm convert [options] input.psd output.png
            command = [
                self.gm_command,
                "convert",
                # Flatten layers into single image (merge all layers)
                "-flatten",
                # Set quality for JPEG output (ignored for PNG/TIFF)
                "-quality",
                "85",
                # Input file (first layer/composite if multi-layer PSD)
                f"{input_path}[0]",  # [0] selects the flattened composite
                # Output file
                str(output_path),
            ]

            logger.info(f"Preprocessing {input_path.name} with GraphicsMagick")
            logger.debug(f"Command: {' '.join(command)}")

            # Execute conversion
            result = subprocess.run(
                command, capture_output=True, timeout=self.TIMEOUT_SECONDS, check=False
            )

            if result.returncode != 0:
                error_msg = result.stderr.decode("utf-8", errors="replace")
                raise PreprocessorError(
                    f"GraphicsMagick conversion failed: {error_msg}"
                )

            # Verify output file was created
            if not output_path.exists() or output_path.stat().st_size == 0:
                raise PreprocessorError("Conversion produced no output")

            logger.info(
                f"Successfully preprocessed {input_path.name} "
                f"({input_path.stat().st_size} bytes) -> "
                f"{output_path.name} ({output_path.stat().st_size} bytes)"
            )

            return output_path

        except subprocess.TimeoutExpired:
            # Clean up temp file
            if output_path.exists():
                output_path.unlink()
            raise PreprocessorError(
                f"Conversion timed out after {self.TIMEOUT_SECONDS} seconds. "
                "File may be too complex or corrupted."
            )
        except Exception:
            # Clean up temp file on any error
            if output_path.exists():
                output_path.unlink()
            raise


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

    def convert_to_intermediate(
        self, input_path: Path, output_format: str = "png"
    ) -> Path:
        """
        Convert PSD/PSB to PNG using ImageMagick.

        Args:
            input_path: Path to PSD/PSB file
            output_format: Output format (png, tiff, jpeg). Default: png

        Returns:
            Path to converted PNG file in temp directory

        Raises:
            PreprocessorError: If conversion fails
        """
        # Validate input
        self.validate_input(input_path)

        # Check tool availability
        if not self.check_availability():
            raise PreprocessorError(
                "ImageMagick is not installed or not accessible. "
                "Install with: apt-get install imagemagick"
            )

        # Validate output format
        valid_formats = {"png", "tiff", "jpeg", "jpg"}
        if output_format.lower() not in valid_formats:
            raise ValueError(
                f"Invalid output format: {output_format}. "
                f"Valid formats: {', '.join(sorted(valid_formats))}"
            )

        # Create temporary output file
        output_path = self._create_temp_file(f".{output_format}")

        try:
            # Determine which command to use
            command_name = self._get_command()

            # Build ImageMagick command
            # Note: ImageMagick 7 requires input file BEFORE operations
            command = [
                command_name,
                # Input file (first layer/composite)
                f"{input_path}[0]",  # [0] selects the flattened composite
                # Flatten layers into single image
                "-flatten",
                # Set quality for JPEG output
                "-quality",
                "85",
                # Output file
                str(output_path),
            ]

            logger.info(f"Preprocessing {input_path.name} with ImageMagick")
            logger.debug(f"Command: {' '.join(command)}")

            # Execute conversion
            result = subprocess.run(
                command, capture_output=True, timeout=self.TIMEOUT_SECONDS, check=False
            )

            if result.returncode != 0:
                error_msg = result.stderr.decode("utf-8", errors="replace")
                raise PreprocessorError(f"ImageMagick conversion failed: {error_msg}")

            # Verify output file was created
            if not output_path.exists() or output_path.stat().st_size == 0:
                raise PreprocessorError("Conversion produced no output")

            logger.info(
                f"Successfully preprocessed {input_path.name} "
                f"({input_path.stat().st_size} bytes) -> "
                f"{output_path.name} ({output_path.stat().st_size} bytes)"
            )

            return output_path

        except subprocess.TimeoutExpired:
            # Clean up temp file
            if output_path.exists():
                output_path.unlink()
            raise PreprocessorError(
                f"Conversion timed out after {self.TIMEOUT_SECONDS} seconds. "
                "File may be too complex or corrupted."
            )
        except Exception:
            # Clean up temp file on any error
            if output_path.exists():
                output_path.unlink()
            raise


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
