"""
Tests for PDF normalization service.
"""

import pytest

from app.services.pdf_normalizer import (
    GHOSTSCRIPT_AVAILABLE,
    is_pdf_normalization_available,
    needs_pdf_normalization,
    normalize_pdf,
)


class TestNeedsPdfNormalization:
    """Tests for the needs_pdf_normalization function."""

    def test_pdf_extension_lowercase(self) -> None:
        """Test that .pdf extension is recognized."""
        assert needs_pdf_normalization("document.pdf") is True

    def test_pdf_extension_uppercase(self) -> None:
        """Test that .PDF extension is recognized."""
        assert needs_pdf_normalization("document.PDF") is True

    def test_pdf_extension_mixed_case(self) -> None:
        """Test that mixed case .Pdf extension is recognized."""
        assert needs_pdf_normalization("document.Pdf") is True

    def test_non_pdf_extensions(self) -> None:
        """Test that non-PDF extensions are not recognized."""
        assert needs_pdf_normalization("image.jpg") is False
        assert needs_pdf_normalization("document.docx") is False
        assert needs_pdf_normalization("file.txt") is False
        assert needs_pdf_normalization("archive.zip") is False

    def test_no_extension(self) -> None:
        """Test that files without extension are not recognized."""
        assert needs_pdf_normalization("document") is False

    def test_pdf_in_filename_not_extension(self) -> None:
        """Test that pdf in filename but not extension is not recognized."""
        assert needs_pdf_normalization("pdf_document.txt") is False


class TestIsPdfNormalizationAvailable:
    """Tests for the is_pdf_normalization_available function."""

    def test_returns_boolean(self) -> None:
        """Test that function returns a boolean."""
        result = is_pdf_normalization_available()
        assert isinstance(result, bool)

    def test_matches_ghostscript_available(self) -> None:
        """Test that result matches GHOSTSCRIPT_AVAILABLE constant."""
        assert is_pdf_normalization_available() == GHOSTSCRIPT_AVAILABLE


class TestNormalizePdf:
    """Tests for the normalize_pdf function."""

    @pytest.fixture
    def minimal_pdf(self) -> bytes:
        """Create a minimal valid PDF for testing."""
        # This is a minimal valid PDF structure
        return (
            b"%PDF-1.4\n"
            b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
            b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
            b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\n"
            b"xref\n0 4\n"
            b"0000000000 65535 f \n"
            b"0000000009 00000 n \n"
            b"0000000058 00000 n \n"
            b"0000000115 00000 n \n"
            b"trailer << /Size 4 /Root 1 0 R >>\n"
            b"startxref\n191\n%%EOF"
        )

    @pytest.mark.skipif(not GHOSTSCRIPT_AVAILABLE, reason="Ghostscript not installed")
    def test_normalize_valid_pdf(self, minimal_pdf: bytes) -> None:
        """Test normalizing a valid PDF."""
        result, was_modified, duration_ms = normalize_pdf(minimal_pdf, "test.pdf")

        # Result should be bytes
        assert isinstance(result, bytes)
        # Result should start with PDF magic number
        assert result.startswith(b"%PDF")
        # Duration should be non-negative
        assert duration_ms >= 0

    @pytest.mark.skipif(not GHOSTSCRIPT_AVAILABLE, reason="Ghostscript not installed")
    def test_normalize_returns_valid_pdf(self, minimal_pdf: bytes) -> None:
        """Test that normalized PDF is valid."""
        result, _was_modified, _duration_ms = normalize_pdf(minimal_pdf, "test.pdf")

        # Should contain PDF structure markers
        assert b"%PDF" in result
        assert b"%%EOF" in result

    def test_normalize_invalid_pdf_returns_original(self) -> None:
        """Test that invalid PDF returns original bytes."""
        invalid_bytes = b"This is not a PDF file"
        result, was_modified, duration_ms = normalize_pdf(invalid_bytes, "not_a_pdf.pdf")

        # Should return original bytes
        assert result == invalid_bytes
        # Should indicate not modified
        assert was_modified is False

    def test_normalize_empty_bytes_returns_pdf(self) -> None:
        """Test that empty bytes still produces a PDF from Ghostscript."""
        result, was_modified, duration_ms = normalize_pdf(b"", "empty.pdf")

        # Ghostscript may produce a valid PDF from empty input
        # or return the original empty bytes
        if GHOSTSCRIPT_AVAILABLE:
            # Either empty (failed) or valid PDF (ghostscript created one)
            assert result == b"" or result.startswith(b"%PDF")
        else:
            assert result == b""

    @pytest.mark.skipif(not GHOSTSCRIPT_AVAILABLE, reason="Ghostscript not installed")
    def test_normalize_with_custom_filename(self, minimal_pdf: bytes) -> None:
        """Test that custom filename is accepted."""
        result, _was_modified, _duration_ms = normalize_pdf(
            minimal_pdf,
            filename="custom_document.pdf",
        )
        assert isinstance(result, bytes)

    @pytest.mark.skipif(not GHOSTSCRIPT_AVAILABLE, reason="Ghostscript not installed")
    def test_normalize_with_timeout(self, minimal_pdf: bytes) -> None:
        """Test that timeout parameter is accepted."""
        result, _was_modified, _duration_ms = normalize_pdf(
            minimal_pdf,
            filename="test.pdf",
            timeout_seconds=30,
        )
        assert isinstance(result, bytes)

    def test_normalize_without_ghostscript(self, monkeypatch: pytest.MonkeyPatch, minimal_pdf: bytes) -> None:
        """Test behavior when Ghostscript is not available."""
        # Temporarily set GHOSTSCRIPT_AVAILABLE to False
        import app.services.pdf_normalizer as pdf_module

        monkeypatch.setattr(pdf_module, "GHOSTSCRIPT_AVAILABLE", False)

        result, was_modified, duration_ms = pdf_module.normalize_pdf(minimal_pdf, "test.pdf")

        # Should return original bytes
        assert result == minimal_pdf
        # Should indicate not modified
        assert was_modified is False
        # Duration should be zero
        assert duration_ms == 0.0

    @pytest.mark.skipif(not GHOSTSCRIPT_AVAILABLE, reason="Ghostscript not installed")
    def test_ramdisk_fallback_on_oserror(self, monkeypatch: pytest.MonkeyPatch, minimal_pdf: bytes) -> None:
        """Test that normalization falls back to system temp if ramdisk fails."""
        import tempfile

        import app.services.pdf_normalizer as pdf_module

        original_tempdir = tempfile.TemporaryDirectory
        call_count = 0

        class FailFirstRamdiskTempDir:
            """Mock that fails on first call (ramdisk) but succeeds on second (system temp)."""

            def __init__(self, *args, **kwargs):
                nonlocal call_count
                call_count += 1
                self.dir = kwargs.get("dir")
                # Fail if trying to use ramdisk
                if self.dir == "/dev/shm":
                    raise OSError("No space left on device")
                self._real = original_tempdir(*args, **kwargs)

            def __enter__(self):
                return self._real.__enter__()

            def __exit__(self, *args):
                return self._real.__exit__(*args)

        monkeypatch.setattr(tempfile, "TemporaryDirectory", FailFirstRamdiskTempDir)

        # Should succeed by falling back to system temp
        result, was_modified, duration_ms = pdf_module.normalize_pdf(minimal_pdf, "test.pdf")

        # Should have attempted ramdisk first, then system temp
        assert call_count == 2
        # Should still return valid bytes
        assert isinstance(result, bytes)
        assert len(result) > 0
