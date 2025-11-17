"""
Real image conversion tests with actual image files.

These tests verify that image conversion works correctly with real image files,
particularly focusing on CMYK→RGB colorspace conversion accuracy.

Important Notes:
    - Vector files (EPS, AI) are created using hand-crafted PostScript code
      with proper colorspace declarations. This ensures reliable CMYK testing.

    - RGB EPS test is skipped as ImageMagick's EPS rendering can be inconsistent.
      The CMYK EPS test is enabled as it validates the critical CMYK conversion.

    - CMYK color expectations are based on ICC profile conversion, which does
      NOT produce pure RGB colors. For example:
      * CMYK cyan (100,0,0,0) → RGB(148,217,248), not RGB(0,255,255)
      * CMYK magenta (0,100,0,0) → RGB(247,177,207), not RGB(255,0,255)
      * CMYK yellow (0,0,100,0) → RGB(255,242,21), not RGB(255,255,0)
      * CMYK black (0,0,0,100) → RGB(55,52,53), not RGB(0,0,0)

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
import subprocess
from pathlib import Path
from typing import Any

import pytest
import pyvips
from app.services.image_converter import convert_image_to_jpeg
from app.services.preprocessor import PreprocessorRegistry

# Test data paths
TEST_DATA_DIR = Path(__file__).parent / "test_data"
IMAGES_DIR = TEST_DATA_DIR / "images"
METADATA_DIR = TEST_DATA_DIR / "metadata"
MANIFEST_FILE = METADATA_DIR / "manifest.json"


@pytest.fixture(scope="module", autouse=True)
def setup_test_images():
    """Generate test images before running tests."""
    if not IMAGES_DIR.exists() or not any(IMAGES_DIR.rglob("*.psd")):
        result = subprocess.run(
            ["./scripts/setup-test-images.sh"],
            cwd=Path(__file__).parent.parent.parent,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            pytest.skip(f"Failed to generate test images: {result.stderr}")


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
    return image.interpretation  # type: ignore


def get_average_color(image_data: bytes) -> tuple[int, int, int]:
    """
    Get the average RGB color of an image.

    Returns:
        Tuple of (R, G, B) values in range 0-255
    """
    image = pyvips.Image.new_from_buffer(image_data, "")

    # Ensure image is in sRGB
    if image.interpretation != "srgb":  # type: ignore
        image = image.colourspace("srgb")  # type: ignore

    # For multi-channel images, get per-band average
    if image.bands >= 3:  # type: ignore
        r = round(image.extract_band(0).avg())  # type: ignore
        g = round(image.extract_band(1).avg())  # type: ignore
        b = round(image.extract_band(2).avg())  # type: ignore
        return (r, g, b)
    else:
        # Grayscale
        gray = round(image.avg())  # type: ignore
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

    def test_cmyk_psd_to_rgb(self, manifest: dict):
        """Test CMYK PSD converts to RGB without color inversion."""
        # Load CMYK PSD test image
        input_data = load_test_image("cmyk/photoshop_cmyk.psd")

        # Convert to JPEG
        output_data, mime_type, converter, duration = convert_image_to_jpeg(
            input_data, filename="photoshop_cmyk.psd"
        )

        # Verify output colorspace is sRGB
        colorspace = get_image_colorspace(output_data)
        assert colorspace == "srgb", f"Expected sRGB, got {colorspace}"

        # Verify color accuracy (cyan CMYK -> RGB via ICC profiles)
        # Pure cyan in CMYK (100,0,0,0) converts to approximately RGB(148,217,248)
        # via ICC profile conversion, NOT pure RGB cyan (0,255,255)
        avg_color = get_average_color(output_data)
        expected_color = (148, 217, 248)  # Actual ICC profile conversion result

        distance = color_distance(avg_color, expected_color)
        # Allow some tolerance for ICC profile conversion
        assert distance < 30, (
            f"Color mismatch: expected {expected_color}, got {avg_color}, "
            f"distance={distance:.1f}"
        )

    def test_cmyk_tiff_to_rgb(self):
        """Test CMYK TIFF converts to RGB (via libvips)."""
        input_data = load_test_image("cmyk/tiff_cmyk.tif")

        # Convert to JPEG
        output_data, _, _, _ = convert_image_to_jpeg(
            input_data, filename="tiff_cmyk.tif"
        )

        # Verify output colorspace
        colorspace = get_image_colorspace(output_data)
        assert colorspace == "srgb"

        # Verify color accuracy (magenta CMYK -> RGB)
        # Pure magenta in CMYK (0,100,0,0) converts to approximately RGB(247,177,207)
        # via libvips built-in conversion
        avg_color = get_average_color(output_data)
        expected_color = (247, 177, 207)  # Actual libvips conversion result

        distance = color_distance(avg_color, expected_color)
        assert distance < 30, f"Color mismatch: {avg_color} vs {expected_color}"

    def test_cmyk_eps_to_rgb(self):
        """Test CMYK EPS converts to RGB via ImageMagick preprocessor.

        Note: PostScript EPS file with embedded CMYK colorspace definition.
        Pure yellow in CMYK (0,0,100,0) converts to RGB(255,242,21) via ICC profiles.
        """
        input_data = load_test_image("cmyk/postscript_cmyk.eps")

        # Verify EPS requires preprocessing
        assert PreprocessorRegistry.requires_preprocessing("eps")

        # Convert to JPEG
        output_data, _, _, _ = convert_image_to_jpeg(
            input_data, filename="postscript_cmyk.eps"
        )

        # Verify output colorspace (vector formats may produce rgb16)
        colorspace = get_image_colorspace(output_data)
        assert colorspace in ("srgb", "rgb16"), (
            f"Expected srgb or rgb16, got {colorspace}"
        )

        # Verify color accuracy (yellow CMYK -> RGB)
        # Pure yellow in CMYK (0,0,100,0) converts to approximately RGB(255,242,21)
        # via ICC profile conversion
        avg_color = get_average_color(output_data)
        expected_color = (255, 242, 21)  # Actual ICC profile conversion result

        distance = color_distance(avg_color, expected_color)
        assert distance < 30, f"Color mismatch: {avg_color} vs {expected_color}"

    def test_cmyk_ai_to_rgb(self):
        """Test CMYK AI converts to RGB via ImageMagick preprocessor."""
        input_data = load_test_image("cmyk/illustrator_cmyk.ai")

        # Verify AI requires preprocessing
        assert PreprocessorRegistry.requires_preprocessing("ai")

        # Convert to JPEG
        output_data, _, _, _ = convert_image_to_jpeg(
            input_data, filename="illustrator_cmyk.ai"
        )

        # Verify output colorspace (vector formats may produce rgb16)
        colorspace = get_image_colorspace(output_data)
        assert colorspace in ("srgb", "rgb16"), (
            f"Expected srgb or rgb16, got {colorspace}"
        )

        # Verify color accuracy (black CMYK -> RGB)
        # CMYK black (0,0,0,100) converts to approximately RGB(55,52,53)
        avg_color = get_average_color(output_data)
        expected_color = (55, 52, 53)

        distance = color_distance(avg_color, expected_color)
        assert distance < 30, f"Color mismatch: {avg_color} vs {expected_color}"


@pytest.mark.integration
class TestRGBPreservation:
    """Test that RGB images are not color-inverted during conversion."""

    def test_rgb_psd_no_inversion(self):
        """Test RGB PSD preserves colors without inversion."""
        input_data = load_test_image("rgb/photoshop_rgb.psd")

        # Convert to JPEG
        output_data, _, _, _ = convert_image_to_jpeg(
            input_data, filename="photoshop_rgb.psd"
        )

        # Verify output colorspace
        colorspace = get_image_colorspace(output_data)
        assert colorspace == "srgb"

        # Verify color preservation (cyan: RGB 0,255,255)
        avg_color = get_average_color(output_data)
        expected_color = (0, 255, 255)  # Cyan

        distance = color_distance(avg_color, expected_color)
        assert distance < 20, f"Color changed: {avg_color} vs {expected_color}"

    def test_rgb_tiff_no_inversion(self):
        """Test RGB TIFF preserves colors without inversion."""
        input_data = load_test_image("rgb/tiff_rgb.tif")

        # Convert to JPEG
        output_data, _, _, _ = convert_image_to_jpeg(
            input_data, filename="tiff_rgb.tif"
        )

        # Verify color preservation (magenta: RGB 255,0,255)
        avg_color = get_average_color(output_data)
        expected_color = (255, 0, 255)  # Magenta

        distance = color_distance(avg_color, expected_color)
        assert distance < 20, f"Color changed: {avg_color} vs {expected_color}"

    @pytest.mark.skip(
        reason="EPS files created with ImageMagick don't render reliably - "
        "vector formats need real design files for testing"
    )
    def test_rgb_eps_no_inversion(self):
        """Test RGB EPS preserves colors without inversion."""
        input_data = load_test_image("rgb/postscript_rgb.eps")

        # Convert to JPEG
        output_data, _, _, _ = convert_image_to_jpeg(
            input_data, filename="postscript_rgb.eps"
        )

        # Verify color preservation (yellow: RGB 255,255,0)
        avg_color = get_average_color(output_data)
        expected_color = (255, 255, 0)  # Yellow

        distance = color_distance(avg_color, expected_color)
        assert distance < 20, f"Color changed: {avg_color} vs {expected_color}"

    def test_rgb_ai_no_inversion(self):
        """Test RGB AI preserves colors without inversion."""
        input_data = load_test_image("rgb/illustrator_rgb.ai")

        # Convert to JPEG
        output_data, _, _, _ = convert_image_to_jpeg(
            input_data, filename="illustrator_rgb.ai"
        )

        # Verify color preservation (red: RGB 255,0,0)
        avg_color = get_average_color(output_data)
        expected_color = (255, 0, 0)  # Red

        distance = color_distance(avg_color, expected_color)
        assert distance < 20, f"Color changed: {avg_color} vs {expected_color}"


@pytest.mark.integration
class TestSpecialColorspaces:
    """Test other colorspace conversions."""

    def test_grayscale_psd(self):
        """Test grayscale PSD conversion."""
        input_data = load_test_image("special/grayscale.psd")

        # Convert to JPEG
        output_data, _, _, _ = convert_image_to_jpeg(
            input_data, filename="grayscale.psd"
        )

        # Verify conversion succeeded
        assert len(output_data) > 0

        # Verify gray value (50% gray: RGB 128,128,128)
        avg_color = get_average_color(output_data)
        expected_color = (128, 128, 128)

        distance = color_distance(avg_color, expected_color)
        assert distance < 30, f"Gray value mismatch: {avg_color} vs {expected_color}"

    def test_lab_tiff(self):
        """Test Lab colorspace TIFF conversion."""
        input_data = load_test_image("special/lab_color.tif")

        # Convert to JPEG
        output_data, _, _, _ = convert_image_to_jpeg(
            input_data, filename="lab_color.tif"
        )

        # Verify conversion succeeded
        assert len(output_data) > 0

        # Verify output is in sRGB
        colorspace = get_image_colorspace(output_data)
        assert colorspace == "srgb"


@pytest.mark.integration
class TestConversionPipeline:
    """Test the complete conversion pipeline."""

    def test_all_test_images_convert(self, manifest: dict):
        """Test that all test images convert successfully."""
        failures = []

        for image_path in manifest["images"].keys():
            try:
                input_data = load_test_image(image_path)

                output_data, _, _, _ = convert_image_to_jpeg(
                    input_data, filename=Path(image_path).name
                )

                assert len(output_data) > 0, f"Empty output for {image_path}"

            except Exception as e:
                failures.append(f"{image_path}: {e}")

        if failures:
            pytest.fail("Conversion failures:\n" + "\n".join(failures))

    def test_conversion_performance(self):
        """Test that conversions complete within reasonable time."""
        import time

        input_data = load_test_image("cmyk/photoshop_cmyk.psd")

        start = time.time()
        output_data, _, _, _ = convert_image_to_jpeg(
            input_data, filename="photoshop_cmyk.psd"
        )
        duration = time.time() - start

        # Small test image should convert quickly (< 5 seconds)
        assert duration < 5.0, f"Conversion too slow: {duration:.2f}s"
        assert len(output_data) > 0
