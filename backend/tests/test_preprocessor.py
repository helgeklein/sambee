"""
Tests for image preprocessing service.

These tests verify that the preprocessor can:
1. Detect available preprocessor tools (GraphicsMagick, ImageMagick)
2. Convert PSD/PSB files to intermediate formats
3. Handle errors gracefully (missing tools, corrupt files, timeouts)
4. Clean up temporary files properly
5. Validate inputs (file size, format, existence)
6. Registry-based format lookups and preprocessor selection
"""

import os
from unittest.mock import MagicMock, patch

import pytest

from app.services.preprocessor import (
    GraphicsMagickPreprocessor,
    ImageMagickPreprocessor,
    PreprocessorError,
    PreprocessorFactory,
    PreprocessorRegistry,
)


class TestPreprocessorRegistry:
    """Test the preprocessor registry functionality."""

    def test_requires_preprocessing_psd(self):
        """Test that PSD format is recognized as requiring preprocessing."""
        assert PreprocessorRegistry.requires_preprocessing("psd") is True
        assert PreprocessorRegistry.requires_preprocessing(".psd") is True
        assert PreprocessorRegistry.requires_preprocessing("PSD") is True
        assert PreprocessorRegistry.requires_preprocessing(".PSD") is True

    def test_requires_preprocessing_psb(self):
        """Test that PSB format is recognized as requiring preprocessing."""
        assert PreprocessorRegistry.requires_preprocessing("psb") is True
        assert PreprocessorRegistry.requires_preprocessing(".psb") is True

    def test_requires_preprocessing_non_preprocessed_format(self):
        """Test that non-preprocessed formats return False."""
        assert PreprocessorRegistry.requires_preprocessing("jpg") is False
        assert PreprocessorRegistry.requires_preprocessing("png") is False
        assert PreprocessorRegistry.requires_preprocessing("gif") is False
        assert PreprocessorRegistry.requires_preprocessing("unknown") is False

    def test_get_supported_formats(self):
        """Test that get_supported_formats returns all registered formats."""
        formats = PreprocessorRegistry.get_supported_formats()
        assert isinstance(formats, set)
        assert "psd" in formats
        assert "psb" in formats
        # Should be at least these two
        assert len(formats) >= 2

    def test_get_preprocessor_for_format_psd(self):
        """Test getting preprocessor for PSD format."""
        # This will use GraphicsMagick if available
        try:
            preprocessor = PreprocessorRegistry.get_preprocessor_for_format("psd")
            assert preprocessor is not None
            assert hasattr(preprocessor, "convert_to_final_format")
        except PreprocessorError:
            # It's okay if no preprocessor is available in test environment
            pytest.skip("No preprocessor available in test environment")

    def test_get_preprocessor_for_format_invalid(self):
        """Test that invalid format raises ValueError."""
        with pytest.raises(ValueError, match="not registered for preprocessing"):
            PreprocessorRegistry.get_preprocessor_for_format("jpg")

    def test_get_preprocessor_for_format_with_override(self):
        """Test that preprocessor_type override works."""
        try:
            # Try to get ImageMagick explicitly
            preprocessor = PreprocessorRegistry.get_preprocessor_for_format(
                "psd", preprocessor_type="imagemagick"
            )
            assert isinstance(preprocessor, ImageMagickPreprocessor)
        except PreprocessorError:
            # ImageMagick not available
            pytest.skip("ImageMagick not available in test environment")

    def test_register_format_dynamic(self):
        """Test dynamic format registration."""
        # Create a mock preprocessor class
        class MockPreprocessor(GraphicsMagickPreprocessor):
            SUPPORTED_FORMATS = {"mock"}

        # Register new format
        PreprocessorRegistry.register_format("mock", MockPreprocessor)

        # Verify it's registered
        assert PreprocessorRegistry.requires_preprocessing("mock") is True
        assert "mock" in PreprocessorRegistry.get_supported_formats()

        # Clean up - remove the mock format
        if "mock" in PreprocessorRegistry._FORMAT_REGISTRY:
            del PreprocessorRegistry._FORMAT_REGISTRY["mock"]

    def test_fallback_when_preferred_unavailable(self):
        """Test that registry falls back to alternative preprocessor."""
        with patch.object(
            GraphicsMagickPreprocessor, "check_availability", return_value=False
        ):
            with patch.object(
                ImageMagickPreprocessor, "check_availability", return_value=True
            ):
                # Should fall back to ImageMagick
                preprocessor = PreprocessorRegistry.get_preprocessor_for_format("psd")
                assert isinstance(preprocessor, ImageMagickPreprocessor)

    def test_no_preprocessor_available_raises_error(self):
        """Test that PreprocessorError is raised when no preprocessor is available."""
        with patch.object(
            GraphicsMagickPreprocessor, "check_availability", return_value=False
        ):
            with patch.object(
                ImageMagickPreprocessor, "check_availability", return_value=False
            ):
                with pytest.raises(
                    PreprocessorError, match="No available preprocessor"
                ):
                    PreprocessorRegistry.get_preprocessor_for_format("psd")


class TestPreprocessorInterface:
    """Test the abstract base class functionality."""

    def test_validate_input_file_not_found(self, tmp_path):
        """Test that validate_input raises FileNotFoundError for missing files."""
        preprocessor = GraphicsMagickPreprocessor()
        non_existent = tmp_path / "does_not_exist.psd"

        with pytest.raises(FileNotFoundError, match="Input file not found"):
            preprocessor.validate_input(non_existent)

    def test_validate_input_file_too_large(self, tmp_path):
        """Test that validate_input raises ValueError for files exceeding MAX_FILE_SIZE."""
        preprocessor = GraphicsMagickPreprocessor()

        # Create a file that exceeds max size
        large_file = tmp_path / "large.psd"
        large_file.write_bytes(b"x" * (preprocessor.MAX_FILE_SIZE + 1))

        with pytest.raises(ValueError, match="File too large"):
            preprocessor.validate_input(large_file)

    def test_validate_input_unsupported_format(self, tmp_path):
        """Test that validate_input raises ValueError for unsupported formats."""
        preprocessor = GraphicsMagickPreprocessor()

        # Create a file with unsupported extension
        unsupported = tmp_path / "test.txt"
        unsupported.write_bytes(b"test content")

        with pytest.raises(ValueError, match="Unsupported format"):
            preprocessor.validate_input(unsupported)

    def test_validate_input_success(self, tmp_path):
        """Test that validate_input passes for valid files."""
        preprocessor = GraphicsMagickPreprocessor()

        # Create a valid PSD file
        valid_file = tmp_path / "test.psd"
        valid_file.write_bytes(b"8BPS" + b"x" * 100)  # PSD signature + data

        # Should not raise
        preprocessor.validate_input(valid_file)

    def test_create_temp_file(self):
        """Test that _create_temp_file creates a temporary file with correct suffix."""
        preprocessor = GraphicsMagickPreprocessor()

        temp_file = preprocessor._create_temp_file(".png")

        try:
            assert temp_file.exists()
            assert temp_file.suffix == ".png"
            assert "sambee_preprocessed_" in temp_file.name
        finally:
            # Cleanup
            if temp_file.exists():
                temp_file.unlink()


class TestGraphicsMagickPreprocessor:
    """Test GraphicsMagick preprocessor implementation."""

    def test_supported_formats(self):
        """Test that GraphicsMagick supports PSD and PSB formats."""
        preprocessor = GraphicsMagickPreprocessor()
        assert preprocessor.SUPPORTED_FORMATS == {"psd", "psb"}

    def test_check_availability_not_installed(self):
        """Test availability check when GraphicsMagick is not installed."""
        preprocessor = GraphicsMagickPreprocessor()

        with patch("subprocess.run", side_effect=FileNotFoundError):
            assert preprocessor.check_availability() is False

    def test_check_availability_installed(self):
        """Test availability check when GraphicsMagick is installed."""
        preprocessor = GraphicsMagickPreprocessor()

        mock_result = MagicMock()
        mock_result.returncode = 0

        with patch("subprocess.run", return_value=mock_result):
            assert preprocessor.check_availability() is True

    def test_convert_tool_not_available(self, tmp_path):
        """Test conversion fails gracefully when GraphicsMagick is not available."""
        preprocessor = GraphicsMagickPreprocessor()

        # Create a dummy PSD file
        psd_file = tmp_path / "test.psd"
        psd_file.write_bytes(b"8BPS" + b"x" * 100)

        with patch.object(preprocessor, "check_availability", return_value=False):
            with pytest.raises(
                PreprocessorError, match="GraphicsMagick is not installed"
            ):
                preprocessor.convert_to_final_format(psd_file)

    def test_convert_invalid_output_format(self, tmp_path):
        """Test conversion fails for invalid output format."""
        preprocessor = GraphicsMagickPreprocessor()

        psd_file = tmp_path / "test.psd"
        psd_file.write_bytes(b"8BPS" + b"x" * 100)

        with patch.object(preprocessor, "check_availability", return_value=True):
            with pytest.raises(ValueError, match="Invalid output format"):
                preprocessor.convert_to_final_format(psd_file, output_format="invalid")

    def test_convert_successful(self, tmp_path):
        """Test successful PSD to PNG conversion."""
        preprocessor = GraphicsMagickPreprocessor()

        # Create a dummy PSD file
        psd_file = tmp_path / "test.psd"
        psd_file.write_bytes(b"8BPS" + b"x" * 100)

        # Mock successful conversion
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stderr = b""

        with patch.object(preprocessor, "check_availability", return_value=True):
            with patch("subprocess.run", return_value=mock_result):
                with patch.object(
                    preprocessor, "_create_temp_file"
                ) as mock_create_temp:
                    # Create a real temp file for the output
                    temp_output = tmp_path / "output.png"
                    temp_output.write_bytes(b"PNG\x0d\x0a\x1a\x0a" + b"x" * 100)
                    mock_create_temp.return_value = temp_output

                    result = preprocessor.convert_to_final_format(psd_file)

                    assert result == temp_output
                    assert result.exists()
                    assert result.suffix == ".png"

    def test_convert_command_fails(self, tmp_path):
        """Test conversion fails when GraphicsMagick command fails."""
        preprocessor = GraphicsMagickPreprocessor()

        psd_file = tmp_path / "test.psd"
        psd_file.write_bytes(b"8BPS" + b"x" * 100)

        # Mock failed conversion
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = b"GraphicsMagick: unable to open image"

        with patch.object(preprocessor, "check_availability", return_value=True):
            with patch("subprocess.run", return_value=mock_result):
                with patch.object(preprocessor, "_create_temp_file") as mock_create:
                    temp_output = tmp_path / "output.png"
                    mock_create.return_value = temp_output

                    with pytest.raises(
                        PreprocessorError, match="GraphicsMagick conversion failed"
                    ):
                        preprocessor.convert_to_final_format(psd_file)

    def test_convert_timeout(self, tmp_path):
        """Test conversion handles timeout gracefully."""
        preprocessor = GraphicsMagickPreprocessor()

        psd_file = tmp_path / "test.psd"
        psd_file.write_bytes(b"8BPS" + b"x" * 100)

        import subprocess

        with patch.object(preprocessor, "check_availability", return_value=True):
            with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("gm", 30)):
                with patch.object(preprocessor, "_create_temp_file") as mock_create:
                    temp_output = tmp_path / "output.png"
                    mock_create.return_value = temp_output

                    with pytest.raises(PreprocessorError, match="timed out"):
                        preprocessor.convert_to_final_format(psd_file)

                    # Verify temp file was cleaned up
                    assert not temp_output.exists()


class TestImageMagickPreprocessor:
    """Test ImageMagick preprocessor implementation."""

    def test_supported_formats(self):
        """Test that ImageMagick supports PSD and PSB formats."""
        preprocessor = ImageMagickPreprocessor()
        assert preprocessor.SUPPORTED_FORMATS == {"psd", "psb"}

    def test_check_availability_v7_installed(self):
        """Test availability check with ImageMagick 7 (magick command)."""
        preprocessor = ImageMagickPreprocessor()

        mock_result = MagicMock()
        mock_result.returncode = 0

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            assert preprocessor.check_availability() is True
            # Should try magick command first
            assert mock_run.call_args[0][0][0] == "magick"

    def test_check_availability_v6_installed(self):
        """Test availability check with ImageMagick 6 (convert command)."""
        preprocessor = ImageMagickPreprocessor()

        def run_side_effect(args, **kwargs):
            if args[0] == "magick":
                raise FileNotFoundError()
            mock_result = MagicMock()
            mock_result.returncode = 0
            return mock_result

        with patch("subprocess.run", side_effect=run_side_effect):
            assert preprocessor.check_availability() is True

    def test_check_availability_not_installed(self):
        """Test availability check when ImageMagick is not installed."""
        preprocessor = ImageMagickPreprocessor()

        with patch("subprocess.run", side_effect=FileNotFoundError):
            assert preprocessor.check_availability() is False

    def test_get_command_prefers_v7(self):
        """Test that _get_command prefers ImageMagick 7 over 6."""
        preprocessor = ImageMagickPreprocessor()

        mock_result = MagicMock()
        mock_result.returncode = 0

        with patch("subprocess.run", return_value=mock_result):
            assert preprocessor._get_command() == "magick"

    def test_get_command_falls_back_to_v6(self):
        """Test that _get_command falls back to ImageMagick 6 if v7 unavailable."""
        preprocessor = ImageMagickPreprocessor()

        def run_side_effect(args, **kwargs):
            if args[0] == "magick":
                raise FileNotFoundError()
            mock_result = MagicMock()
            mock_result.returncode = 0
            return mock_result

        with patch("subprocess.run", side_effect=run_side_effect):
            assert preprocessor._get_command() == "convert"


class TestPreprocessorFactory:
    """Test the preprocessor factory."""

    def test_create_auto_prefers_graphicsmagick(self):
        """Test that auto mode prefers GraphicsMagick over ImageMagick."""
        with patch.object(
            GraphicsMagickPreprocessor, "check_availability", return_value=True
        ):
            with patch.object(
                ImageMagickPreprocessor, "check_availability", return_value=True
            ):
                preprocessor = PreprocessorFactory.create("auto")
                assert isinstance(preprocessor, GraphicsMagickPreprocessor)

    def test_create_auto_falls_back_to_imagemagick(self):
        """Test that auto mode falls back to ImageMagick if GM not available."""
        with patch.object(
            GraphicsMagickPreprocessor, "check_availability", return_value=False
        ):
            with patch.object(
                ImageMagickPreprocessor, "check_availability", return_value=True
            ):
                preprocessor = PreprocessorFactory.create("auto")
                assert isinstance(preprocessor, ImageMagickPreprocessor)

    def test_create_auto_fails_if_none_available(self):
        """Test that auto mode raises error if no preprocessor available."""
        with patch.object(
            GraphicsMagickPreprocessor, "check_availability", return_value=False
        ):
            with patch.object(
                ImageMagickPreprocessor, "check_availability", return_value=False
            ):
                with pytest.raises(PreprocessorError, match="No preprocessor available"):
                    PreprocessorFactory.create("auto")

    def test_create_graphicsmagick_explicit(self):
        """Test creating GraphicsMagick preprocessor explicitly."""
        with patch.object(
            GraphicsMagickPreprocessor, "check_availability", return_value=True
        ):
            preprocessor = PreprocessorFactory.create("graphicsmagick")
            assert isinstance(preprocessor, GraphicsMagickPreprocessor)

    def test_create_graphicsmagick_not_available(self):
        """Test error when GraphicsMagick explicitly requested but not available."""
        with patch.object(
            GraphicsMagickPreprocessor, "check_availability", return_value=False
        ):
            with pytest.raises(
                PreprocessorError, match="GraphicsMagick not available"
            ):
                PreprocessorFactory.create("graphicsmagick")

    def test_create_imagemagick_explicit(self):
        """Test creating ImageMagick preprocessor explicitly."""
        with patch.object(
            ImageMagickPreprocessor, "check_availability", return_value=True
        ):
            preprocessor = PreprocessorFactory.create("imagemagick")
            assert isinstance(preprocessor, ImageMagickPreprocessor)

    def test_create_imagemagick_not_available(self):
        """Test error when ImageMagick explicitly requested but not available."""
        with patch.object(
            ImageMagickPreprocessor, "check_availability", return_value=False
        ):
            with pytest.raises(PreprocessorError, match="ImageMagick not available"):
                PreprocessorFactory.create("imagemagick")

    def test_create_invalid_type(self):
        """Test error for invalid preprocessor type."""
        with pytest.raises(ValueError, match="Invalid preprocessor type"):
            PreprocessorFactory.create("invalid")

    def test_create_from_env_var(self):
        """Test creating preprocessor from PREPROCESSOR environment variable."""
        with patch.object(
            GraphicsMagickPreprocessor, "check_availability", return_value=True
        ):
            with patch.dict(os.environ, {"PREPROCESSOR": "graphicsmagick"}):
                preprocessor = PreprocessorFactory.create()
                assert isinstance(preprocessor, GraphicsMagickPreprocessor)

    def test_get_supported_formats_both_available(self):
        """Test getting supported formats when both tools are available."""
        with patch.object(
            GraphicsMagickPreprocessor, "check_availability", return_value=True
        ):
            with patch.object(
                ImageMagickPreprocessor, "check_availability", return_value=True
            ):
                formats = PreprocessorFactory.get_supported_formats()
                assert formats == {"psd", "psb"}

    def test_get_supported_formats_none_available(self):
        """Test getting supported formats when no tools are available."""
        with patch.object(
            GraphicsMagickPreprocessor, "check_availability", return_value=False
        ):
            with patch.object(
                ImageMagickPreprocessor, "check_availability", return_value=False
            ):
                formats = PreprocessorFactory.get_supported_formats()
                assert formats == set()
