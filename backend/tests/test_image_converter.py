"""Tests for image conversion service."""

import io
from unittest.mock import patch

import pytest
from app.services.image_converter import (
    convert_image_to_jpeg,
    get_image_info,
    is_image_file,
    needs_conversion,
)
from PIL import Image


class TestImageFormatDetection:
    """Test image format detection functions."""

    def test_needs_conversion_tiff(self):
        """TIFF files need conversion."""
        assert needs_conversion("photo.tif") is True
        assert needs_conversion("photo.tiff") is True
        assert needs_conversion("PHOTO.TIF") is True

    def test_needs_conversion_heic(self):
        """HEIC files need conversion."""
        assert needs_conversion("photo.heic") is True
        assert needs_conversion("photo.heif") is True
        assert needs_conversion("IMG_1234.HEIC") is True

    def test_needs_conversion_bmp(self):
        """BMP files need conversion."""
        assert needs_conversion("image.bmp") is True
        assert needs_conversion("image.dib") is True

    def test_needs_conversion_ico(self):
        """ICO files need conversion."""
        assert needs_conversion("icon.ico") is True

    def test_no_conversion_needed_jpeg(self):
        """JPEG files don't need conversion."""
        assert needs_conversion("photo.jpg") is False
        assert needs_conversion("photo.jpeg") is False

    def test_no_conversion_needed_png(self):
        """PNG files don't need conversion."""
        assert needs_conversion("image.png") is False

    def test_no_conversion_needed_webp(self):
        """WebP files don't need conversion."""
        assert needs_conversion("photo.webp") is False

    def test_no_conversion_needed_svg(self):
        """SVG files don't need conversion."""
        assert needs_conversion("logo.svg") is False

    def test_is_image_file_supported_formats(self):
        """Test is_image_file recognizes all supported formats."""
        supported = [
            "photo.jpg",
            "photo.jpeg",
            "photo.png",
            "photo.gif",
            "photo.webp",
            "photo.svg",
            "photo.tif",
            "photo.tiff",
            "photo.heic",
            "photo.heif",
            "photo.bmp",
            "photo.ico",
        ]
        for filename in supported:
            assert is_image_file(filename) is True, f"{filename} should be recognized"

    def test_is_image_file_unsupported_formats(self):
        """Test is_image_file rejects unsupported formats."""
        unsupported = ["document.pdf", "video.mp4", "text.txt", "archive.zip"]
        for filename in unsupported:
            assert is_image_file(filename) is False, (
                f"{filename} should not be recognized"
            )


class TestImageConversion:
    """Test image conversion functionality."""

    def create_test_image(self, mode: str = "RGB", size: tuple = (100, 100)) -> bytes:
        """Create a test image in memory."""
        img = Image.new(mode, size, color=(255, 0, 0))
        buffer = io.BytesIO()
        # Save as PNG to preserve all modes
        img.save(buffer, format="PNG")
        buffer.seek(0)
        return buffer.getvalue()

    def create_test_bmp(self, size: tuple = (100, 100)) -> bytes:
        """Create a test BMP image."""
        img = Image.new("RGB", size, color=(0, 255, 0))
        buffer = io.BytesIO()
        img.save(buffer, format="BMP")
        buffer.seek(0)
        return buffer.getvalue()

    def test_convert_rgb_to_jpeg(self):
        """Test converting RGB image to JPEG."""
        test_image = self.create_test_image("RGB", (200, 150))

        result_bytes, mime_type = convert_image_to_jpeg(test_image, "test.png")

        assert mime_type == "image/jpeg"
        assert len(result_bytes) > 0

        # Verify it's a valid JPEG
        result_img = Image.open(io.BytesIO(result_bytes))
        assert result_img.format == "JPEG"
        assert result_img.size == (200, 150)

    def test_convert_rgba_to_jpeg(self):
        """Test converting RGBA image to JPEG (removes alpha)."""
        test_image = self.create_test_image("RGBA", (100, 100))

        result_bytes, mime_type = convert_image_to_jpeg(test_image, "test.png")

        assert mime_type == "image/jpeg"

        # Verify alpha channel was handled (composite on white)
        result_img = Image.open(io.BytesIO(result_bytes))
        assert result_img.format == "JPEG"
        assert result_img.mode == "RGB"

    def test_convert_bmp_to_jpeg(self):
        """Test converting BMP to JPEG."""
        test_bmp = self.create_test_bmp((150, 200))

        result_bytes, mime_type = convert_image_to_jpeg(test_bmp, "test.bmp")

        assert mime_type == "image/jpeg"
        result_img = Image.open(io.BytesIO(result_bytes))
        assert result_img.format == "JPEG"
        assert result_img.size == (150, 200)

    def test_convert_with_max_dimension(self):
        """Test image downscaling with max_dimension."""
        test_image = self.create_test_image("RGB", (2000, 1500))

        result_bytes, mime_type = convert_image_to_jpeg(
            test_image, "large.png", max_dimension=800
        )

        result_img = Image.open(io.BytesIO(result_bytes))
        # Image should be scaled down proportionally
        assert max(result_img.size) <= 800
        # Aspect ratio should be preserved (approximately)
        assert abs(result_img.size[0] / result_img.size[1] - 2000 / 1500) < 0.01

    def test_convert_quality_setting(self):
        """Test JPEG quality setting affects output size."""
        test_image = self.create_test_image("RGB", (500, 500))

        low_quality, _ = convert_image_to_jpeg(test_image, "test.png", quality=50)
        high_quality, _ = convert_image_to_jpeg(test_image, "test.png", quality=95)

        # Higher quality should result in larger file
        assert len(high_quality) > len(low_quality)

    @patch("app.services.image_converter.HEIF_SUPPORT", False)
    def test_heic_without_support_raises_error(self):
        """Test HEIC conversion fails gracefully without pillow-heif."""
        test_image = self.create_test_image("RGB")

        with pytest.raises(ImportError, match="HEIC/HEIF support requires"):
            convert_image_to_jpeg(test_image, "photo.heic")

    def test_invalid_image_raises_error(self):
        """Test that invalid image data raises ValueError."""
        invalid_data = b"This is not an image"

        with pytest.raises(ValueError, match="Failed to convert image"):
            convert_image_to_jpeg(invalid_data, "test.jpg")

    def test_get_image_info(self):
        """Test getting image information."""
        test_image = self.create_test_image("RGB", (300, 200))

        info = get_image_info(test_image)

        assert info["format"] == "PNG"
        assert info["mode"] in ("RGB", "RGBA")  # Can vary
        assert info["size"] == (300, 200)
        assert info["width"] == 300
        assert info["height"] == 200
        assert isinstance(info["info"], dict)

    def test_get_image_info_invalid_data(self):
        """Test get_image_info with invalid data."""
        with pytest.raises(ValueError, match="Failed to read image info"):
            get_image_info(b"invalid")


class TestEdgeCases:
    """Test edge cases and special scenarios."""

    def test_grayscale_image_preserved(self):
        """Test that grayscale images are preserved."""
        img = Image.new("L", (100, 100), color=128)
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        result_bytes, mime_type = convert_image_to_jpeg(buffer.getvalue(), "gray.png")

        result_img = Image.open(io.BytesIO(result_bytes))
        # Grayscale should be preserved in JPEG
        assert result_img.mode in ("L", "RGB")  # JPEG can store as either

    def test_palette_mode_conversion(self):
        """Test palette mode (P) images are converted."""
        img = Image.new("P", (100, 100))
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        result_bytes, mime_type = convert_image_to_jpeg(
            buffer.getvalue(), "palette.png"
        )

        result_img = Image.open(io.BytesIO(result_bytes))
        assert result_img.mode == "RGB"

    def test_small_image_no_downscaling(self):
        """Test that small images are not upscaled."""
        img = Image.new("RGB", (50, 50), color=(255, 0, 0))
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        result_bytes, mime_type = convert_image_to_jpeg(
            buffer.getvalue(), "small.png", max_dimension=1000
        )

        result_img = Image.open(io.BytesIO(result_bytes))
        # Should remain 50x50, not upscaled
        assert result_img.size == (50, 50)
