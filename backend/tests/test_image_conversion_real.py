"""
Real image conversion tests with actual image files.

These tests verify that image conversion works correctly with real image files,
particularly focusing on CMYK→RGB colorspace conversion accuracy.

Tests are marked as integration tests and can be skipped in fast unit test runs.

Prerequisites:
    - Test images must be generated first: ./scripts/setup-test-images.sh
    - ImageMagick with ICC profile support (libgs-common)
    - libvips with colorspace conversion support

Usage:
    # Run all image conversion tests
    pytest tests/test_image_conversion_real.py -v

    # Run only CMYK tests
    pytest tests/test_image_conversion_real.py -k cmyk -v

    # Skip integration tests
    pytest -m "not integration"
"""

import json
from pathlib import Path
from typing import Any

import pytest
import pyvips
from app.services.preprocessor import PreprocessorRegistry

# Test data paths
TEST_DATA_DIR = Path(__file__).parent / "test_data"
IMAGES_DIR = TEST_DATA_DIR / "images"
EXPECTED_DIR = TEST_DATA_DIR / "expected"
METADATA_DIR = TEST_DATA_DIR / "metadata"
MANIFEST_FILE = METADATA_DIR / "manifest.json"


@pytest.fixture(scope="module")
def manifest() -> dict[str, Any]:
    """Load test image manifest."""
    if not MANIFEST_FILE.exists():
        pytest.skip(
            "Test manifest not found. Run ./scripts/setup-test-images.sh first."
        )

    with open(MANIFEST_FILE) as f:
        return json.load(f)


def load_test_image(relative_path: str) -> bytes:
    """Load a test image file."""
    image_path = IMAGES_DIR / relative_path
    if not image_path.exists():
        pytest.skip(
            f"Test image not found: {relative_path}. "
            "Run ./scripts/setup-test-images.sh first."
        )
    return image_path.read_bytes()


def get_image_colorspace(image_data: bytes) -> str:
    """Get the colorspace of an image using pyvips."""
    image = pyvips.Image.new_from_buffer(image_data, "")
    return image.interpretation


def get_average_color(image_data: bytes, format_hint: str = "") -> tuple[int, int, int]:
    """
    Get the average RGB color of an image.

    Returns:
        Tuple of (R, G, B) values in range 0-255
    """
    image = pyvips.Image.new_from_buffer(image_data, format_hint)

    # Ensure image is in sRGB
    if image.interpretation != "srgb":
        image = image.colourspace("srgb")

    # Get average color per channel
    avg = image.avg()

    # For multi-channel images, get per-band average
    if image.bands >= 3:
        r = round(image.extract_band(0).avg())
        g = round(image.extract_band(1).avg())
        b = round(image.extract_band(2).avg())
        return (r, g, b)
    else:
        # Grayscale
        gray = round(avg)
        return (gray, gray, gray)


def color_distance(color1: tuple[int, int, int], color2: tuple[int, int, int]) -> float:
    """
    Calculate Euclidean distance between two RGB colors.

    Returns:
        Distance in range 0-441 (sqrt(255^2 + 255^2 + 255^2))
    """
    return (
        (color1[0] - color2[0]) ** 2
        + (color1[1] - color2[1]) ** 2
        + (color1[2] - color2[2]) ** 2
    ) ** 0.5


@pytest.mark.integration
class TestCMYKConversion:
    """Test CMYK→RGB colorspace conversion with real images."""

    def test_cmyk_psd_to_rgb(self, image_converter: ImageConverter, manifest: dict):
        """Test CMYK PSD converts to RGB without color inversion."""
        # Load CMYK PSD test image
        input_data = load_test_image("cmyk/photoshop_cmyk.psd")

        # Convert to PNG
        output_data = image_converter.convert_image(
            input_data, filename="photoshop_cmyk.psd", output_format="png"
        )

        # Verify output colorspace is sRGB
        colorspace = get_image_colorspace(output_data)
        assert colorspace == "srgb", f"Expected sRGB, got {colorspace}"

        # Verify color accuracy (cyan: RGB 0,255,255)
        avg_color = get_average_color(output_data)
        expected_color = (0, 255, 255)  # Cyan

        distance = color_distance(avg_color, expected_color)
        # Allow some tolerance for ICC profile conversion
        assert distance < 30, (
            f"Color mismatch: expected {expected_color}, got {avg_color}, "
            f"distance={distance:.1f}"
        )

    def test_cmyk_tiff_to_rgb(self, image_converter: ImageConverter):
        """Test CMYK TIFF converts to RGB (via libvips)."""
        input_data = load_test_image("cmyk/tiff_cmyk.tif")

        # Convert to JPEG
        output_data = image_converter.convert_image(
            input_data, filename="tiff_cmyk.tif", output_format="jpeg"
        )

        # Verify output colorspace
        colorspace = get_image_colorspace(output_data)
        assert colorspace == "srgb"

        # Verify color accuracy (magenta: RGB 255,0,255)
        avg_color = get_average_color(output_data)
        expected_color = (255, 0, 255)  # Magenta

        distance = color_distance(avg_color, expected_color)
        assert distance < 30, f"Color mismatch: {avg_color} vs {expected_color}"

    def test_cmyk_eps_to_rgb(self, image_converter: ImageConverter):
        """Test CMYK EPS converts to RGB via ImageMagick preprocessor."""
        input_data = load_test_image("cmyk/postscript_cmyk.eps")

        # Verify EPS requires preprocessing
        assert PreprocessorRegistry.requires_preprocessing("eps")

        # Convert to PNG
        output_data = image_converter.convert_image(
            input_data, filename="postscript_cmyk.eps", output_format="png"
        )

        # Verify output colorspace
        colorspace = get_image_colorspace(output_data)
        assert colorspace == "srgb"

        # Verify color accuracy (yellow: RGB 255,255,0)
        avg_color = get_average_color(output_data)
        expected_color = (255, 255, 0)  # Yellow

        distance = color_distance(avg_color, expected_color)
        assert distance < 30, f"Color mismatch: {avg_color} vs {expected_color}"

    def test_cmyk_ai_to_rgb(self, image_converter: ImageConverter):
        """Test CMYK AI converts to RGB via ImageMagick preprocessor."""
        input_data = load_test_image("cmyk/illustrator_cmyk.ai")

        # Verify AI requires preprocessing
        assert PreprocessorRegistry.requires_preprocessing("ai")

        # Convert to PNG
        output_data = image_converter.convert_image(
            input_data, filename="illustrator_cmyk.ai", output_format="png"
        )

        # Verify output colorspace
        colorspace = get_image_colorspace(output_data)
        assert colorspace == "srgb"

        # Verify color accuracy (black: RGB 0,0,0)
        avg_color = get_average_color(output_data)
        expected_color = (0, 0, 0)  # Black

        distance = color_distance(avg_color, expected_color)
        assert distance < 30, f"Color mismatch: {avg_color} vs {expected_color}"


@pytest.mark.integration
class TestRGBPreservation:
    """Test that RGB images are not color-inverted during conversion."""

    def test_rgb_psd_no_inversion(self, image_converter: ImageConverter):
        """Test RGB PSD preserves colors without inversion."""
        input_data = load_test_image("rgb/photoshop_rgb.psd")

        # Convert to PNG
        output_data = image_converter.convert_image(
            input_data, filename="photoshop_rgb.psd", output_format="png"
        )

        # Verify output colorspace
        colorspace = get_image_colorspace(output_data)
        assert colorspace == "srgb"

        # Verify color preservation (cyan: RGB 0,255,255)
        avg_color = get_average_color(output_data)
        expected_color = (0, 255, 255)  # Cyan

        distance = color_distance(avg_color, expected_color)
        assert distance < 20, f"Color changed: {avg_color} vs {expected_color}"

    def test_rgb_tiff_no_inversion(self, image_converter: ImageConverter):
        """Test RGB TIFF preserves colors without inversion."""
        input_data = load_test_image("rgb/tiff_rgb.tif")

        # Convert to JPEG
        output_data = image_converter.convert_image(
            input_data, filename="tiff_rgb.tif", output_format="jpeg"
        )

        # Verify color preservation (magenta: RGB 255,0,255)
        avg_color = get_average_color(output_data)
        expected_color = (255, 0, 255)  # Magenta

        distance = color_distance(avg_color, expected_color)
        assert distance < 20, f"Color changed: {avg_color} vs {expected_color}"

    def test_rgb_eps_no_inversion(self, image_converter: ImageConverter):
        """Test RGB EPS preserves colors without inversion."""
        input_data = load_test_image("rgb/postscript_rgb.eps")

        # Convert to PNG
        output_data = image_converter.convert_image(
            input_data, filename="postscript_rgb.eps", output_format="png"
        )

        # Verify color preservation (yellow: RGB 255,255,0)
        avg_color = get_average_color(output_data)
        expected_color = (255, 255, 0)  # Yellow

        distance = color_distance(avg_color, expected_color)
        assert distance < 20, f"Color changed: {avg_color} vs {expected_color}"

    def test_rgb_ai_no_inversion(self, image_converter: ImageConverter):
        """Test RGB AI preserves colors without inversion."""
        input_data = load_test_image("rgb/illustrator_rgb.ai")

        # Convert to PNG
        output_data = image_converter.convert_image(
            input_data, filename="illustrator_rgb.ai", output_format="png"
        )

        # Verify color preservation (red: RGB 255,0,0)
        avg_color = get_average_color(output_data)
        expected_color = (255, 0, 0)  # Red

        distance = color_distance(avg_color, expected_color)
        assert distance < 20, f"Color changed: {avg_color} vs {expected_color}"


@pytest.mark.integration
class TestSpecialColorspaces:
    """Test other colorspace conversions."""

    def test_grayscale_psd(self, image_converter: ImageConverter):
        """Test grayscale PSD conversion."""
        input_data = load_test_image("special/grayscale.psd")

        # Convert to PNG
        output_data = image_converter.convert_image(
            input_data, filename="grayscale.psd", output_format="png"
        )

        # Verify conversion succeeded
        assert len(output_data) > 0

        # Verify gray value (50% gray: RGB 128,128,128)
        avg_color = get_average_color(output_data)
        expected_color = (128, 128, 128)

        distance = color_distance(avg_color, expected_color)
        assert distance < 30, f"Gray value mismatch: {avg_color} vs {expected_color}"

    def test_lab_tiff(self, image_converter: ImageConverter):
        """Test Lab colorspace TIFF conversion."""
        input_data = load_test_image("special/lab_color.tif")

        # Convert to JPEG
        output_data = image_converter.convert_image(
            input_data, filename="lab_color.tif", output_format="jpeg"
        )

        # Verify conversion succeeded
        assert len(output_data) > 0

        # Verify output is in sRGB
        colorspace = get_image_colorspace(output_data)
        assert colorspace == "srgb"


@pytest.mark.integration
class TestConversionPipeline:
    """Test the complete conversion pipeline."""

    def test_all_test_images_convert(
        self, image_converter: ImageConverter, manifest: dict
    ):
        """Test that all test images convert successfully."""
        failures = []

        for image_path, metadata in manifest["images"].items():
            try:
                input_data = load_test_image(image_path)
                output_format = (
                    "png" if metadata["format"] in ["PSD", "EPS", "AI"] else "jpeg"
                )

                output_data = image_converter.convert_image(
                    input_data,
                    filename=Path(image_path).name,
                    output_format=output_format,
                )

                assert len(output_data) > 0, f"Empty output for {image_path}"

            except Exception as e:
                failures.append(f"{image_path}: {e}")

        if failures:
            pytest.fail("Conversion failures:\n" + "\n".join(failures))

    def test_conversion_performance(self, image_converter: ImageConverter):
        """Test that conversions complete within reasonable time."""
        import time

        input_data = load_test_image("cmyk/photoshop_cmyk.psd")

        start = time.time()
        output_data = image_converter.convert_image(
            input_data, filename="photoshop_cmyk.psd", output_format="png"
        )
        duration = time.time() - start

        # Small test image should convert quickly (< 5 seconds)
        assert duration < 5.0, f"Conversion too slow: {duration:.2f}s"
        assert len(output_data) > 0
