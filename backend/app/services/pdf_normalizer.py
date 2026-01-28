"""
PDF normalization service for repairing problematic PDF files.

Some PDF files fail to load in PDF.js with errors like "Invalid PDF structure"
due to non-standard or malformed PDF structures. This service uses Ghostscript
to rewrite PDFs in a clean, compatible format.

Architecture:
- Uses Ghostscript to re-render PDFs, fixing structural issues
- Operates on in-memory bytes (no disk I/O except for temp files)
- Falls back to original PDF if normalization fails
- Includes timeout protection for long-running operations

Common issues this fixes:
- Malformed XRef tables
- Invalid object references
- Non-standard PDF structures
- Linearization issues
- Incremental update problems
"""

import logging
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# Check for Ghostscript availability
GHOSTSCRIPT_PATH: Optional[str] = shutil.which("gs") or shutil.which("ghostscript")
GHOSTSCRIPT_AVAILABLE = GHOSTSCRIPT_PATH is not None


class PDFNormalizationError(Exception):
    """Exception raised when PDF normalization fails."""

    pass


#
# is_pdf_normalization_available
#
def is_pdf_normalization_available() -> bool:
    """
    Check if PDF normalization is available.

    Returns:
        True if Ghostscript is installed and accessible.
    """

    return GHOSTSCRIPT_AVAILABLE


#
# normalize_pdf
#
def normalize_pdf(
    pdf_bytes: bytes,
    filename: str = "document.pdf",
    timeout_seconds: int = 60,
) -> tuple[bytes, bool, float]:
    """
    Normalize a PDF file using Ghostscript to fix structural issues.

    Uses Ghostscript to re-render the PDF, which fixes:
    - Malformed XRef tables
    - Invalid object references
    - Non-standard PDF structures
    - Incremental update problems

    Args:
        pdf_bytes: Raw PDF file bytes
        filename: Original filename (for logging)
        timeout_seconds: Maximum time to wait for conversion

    Returns:
        Tuple of (normalized_bytes, was_modified, duration_ms):
        - normalized_bytes: The normalized PDF bytes
        - was_modified: True if the PDF was actually modified
        - duration_ms: Processing duration in milliseconds

    Raises:
        PDFNormalizationError: If normalization fails and no fallback is possible
    """

    if not GHOSTSCRIPT_AVAILABLE:
        logger.warning("Ghostscript not available, skipping PDF normalization")
        return pdf_bytes, False, 0.0

    start_time = time.perf_counter()

    # Use /dev/shm (RAM-based tmpfs) if available for faster I/O
    # Only use for PDFs under 25MB (need space for input + output + overhead)
    # Falls back to system temp directory for larger files or if not available
    pdf_size_mb = len(pdf_bytes) / (1024 * 1024)
    use_ramdisk = os.path.isdir("/dev/shm") and pdf_size_mb < 25
    temp_base: str | None = "/dev/shm" if use_ramdisk else None

    # Create temp files for input and output
    # Try ramdisk first, fall back to system temp if it fails (e.g., no space)
    try:
        temp_context = tempfile.TemporaryDirectory(prefix="sambee_pdf_", dir=temp_base)
        temp_dir = temp_context.__enter__()
    except OSError as e:
        if temp_base is not None:
            logger.debug(f"Ramdisk temp creation failed ({e}), falling back to system temp")
            temp_base = None
            temp_context = tempfile.TemporaryDirectory(prefix="sambee_pdf_", dir=None)
            temp_dir = temp_context.__enter__()
        else:
            raise

    try:
        temp_path = Path(temp_dir)
        input_path = temp_path / "input.pdf"
        output_path = temp_path / "output.pdf"

        # Write input PDF to temp file
        input_path.write_bytes(pdf_bytes)

        # Ghostscript command to normalize PDF
        # Performance optimizations:
        # - Using RAM-backed temp dir when available
        # Quality settings:
        # - dCompatibilityLevel=1.4 ensures wide browser compatibility
        # - dPDFSETTINGS=/ebook: Medium quality (150 dpi images), balanced size and quality.
        # Note: GHOSTSCRIPT_PATH is guaranteed to be non-None here (checked above)
        gs_path: str = GHOSTSCRIPT_PATH  # type: ignore[assignment]
        cmd = [
            gs_path,
            "-dNOPAUSE",  # Do not pause between pages
            "-dBATCH",  # Exit after processing
            "-dQUIET",  # Suppress routine info output
            "-dSAFER",  # Restrict file operations for security
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            "-dPDFSETTINGS=/ebook",
            "-dAutoRotatePages=/None",  # Preserve page orientation
            f"-sOutputFile={output_path}",
            str(input_path),
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=timeout_seconds,
                check=False,
            )

            if result.returncode != 0:
                stderr = result.stderr.decode("utf-8", errors="replace")
                logger.warning(f"Ghostscript normalization failed for {filename}: exit code {result.returncode}, stderr: {stderr[:500]}")
                # Return original PDF on failure
                duration_ms = (time.perf_counter() - start_time) * 1000
                return pdf_bytes, False, duration_ms

            if not output_path.exists():
                logger.warning(f"Ghostscript produced no output for {filename}")
                duration_ms = (time.perf_counter() - start_time) * 1000
                return pdf_bytes, False, duration_ms

            # Read the normalized PDF
            normalized_bytes = output_path.read_bytes()

            if len(normalized_bytes) == 0:
                logger.warning(f"Ghostscript produced empty output for {filename}")
                duration_ms = (time.perf_counter() - start_time) * 1000
                return pdf_bytes, False, duration_ms

            duration_ms = (time.perf_counter() - start_time) * 1000

            # Check if the PDF was actually modified
            was_modified = normalized_bytes != pdf_bytes

            if was_modified:
                size_change = len(normalized_bytes) - len(pdf_bytes)
                size_change_pct = (size_change / len(pdf_bytes)) * 100 if pdf_bytes else 0
                logger.info(
                    f"PDF normalized: {filename} "
                    f"({len(pdf_bytes) / 1024:.0f} → {len(normalized_bytes) / 1024:.0f} KB, "
                    f"{size_change_pct:+.1f}%) in {duration_ms:.0f} ms"
                )
            else:
                logger.debug(f"PDF unchanged after normalization: {filename}")

            return normalized_bytes, was_modified, duration_ms

        except subprocess.TimeoutExpired:
            logger.error(f"PDF normalization timed out after {timeout_seconds}s: {filename}")
            duration_ms = (time.perf_counter() - start_time) * 1000
            return pdf_bytes, False, duration_ms

        except Exception as e:
            logger.error(f"PDF normalization failed for {filename}: {type(e).__name__}: {e}")
            duration_ms = (time.perf_counter() - start_time) * 1000
            return pdf_bytes, False, duration_ms

    finally:
        temp_context.__exit__(None, None, None)


# needs_pdf_normalization
#
def needs_pdf_normalization(filename: str) -> bool:
    """
    Check if a file needs PDF normalization.

    Args:
        filename: The filename to check

    Returns:
        True if the file is a PDF that should be normalized
    """

    ext = os.path.splitext(filename.lower())[1]
    return ext == ".pdf"
