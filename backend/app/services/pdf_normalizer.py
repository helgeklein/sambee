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
import resource
import shutil
import signal
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Condition
from typing import Callable, Optional, TypeVar

logger = logging.getLogger(__name__)


# Check for Ghostscript availability
GHOSTSCRIPT_PATH: Optional[str] = shutil.which("gs") or shutil.which("ghostscript")
GHOSTSCRIPT_AVAILABLE = GHOSTSCRIPT_PATH is not None
NORMALIZER_CONFIG_VERSION = "2"
PDF_HEADER = b"%PDF"
PDF_TRAILER = b"%%EOF"
PDF_TRAILER_SEARCH_BYTES = 1024
ResultType = TypeVar("ResultType")


class PDFNormalizationError(Exception):
    """Exception raised when PDF normalization fails."""

    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PDFNormalizationLimits:
    """Resource limits for one Ghostscript compatibility conversion."""

    timeout_seconds: int = 60
    cpu_time_seconds: int = 60
    address_space_bytes: int = 512 * 1024 * 1024
    output_size_bytes: int = 512 * 1024 * 1024


class PDFNormalizationQueue:
    """A dynamically bounded, process-wide queue for Ghostscript work."""

    def __init__(self) -> None:
        self._active = 0
        self._condition = Condition()

    def run(self, *, maximum_concurrent: int, wait_seconds: int, operation: Callable[[], ResultType]) -> ResultType:
        deadline = time.monotonic() + wait_seconds
        with self._condition:
            while self._active >= maximum_concurrent:
                remaining_seconds = deadline - time.monotonic()
                if remaining_seconds <= 0:
                    raise PDFNormalizationError("PDF compatibility conversion queue is full", code="queue_saturated")
                self._condition.wait(timeout=remaining_seconds)
            self._active += 1

        try:
            return operation()
        finally:
            with self._condition:
                self._active -= 1
                self._condition.notify()


pdf_normalization_queue = PDFNormalizationQueue()


def is_valid_pdf_output(pdf_bytes: bytes) -> bool:
    """Return whether bytes contain the minimum complete-PDF markers required for caching."""

    return len(pdf_bytes) > len(PDF_HEADER) and pdf_bytes.startswith(PDF_HEADER) and PDF_TRAILER in pdf_bytes[-PDF_TRAILER_SEARCH_BYTES:]


def _resource_limiter(limits: PDFNormalizationLimits) -> None:
    """Apply subprocess-only resource limits on POSIX platforms."""

    resource.setrlimit(resource.RLIMIT_CPU, (limits.cpu_time_seconds, limits.cpu_time_seconds))
    resource.setrlimit(resource.RLIMIT_AS, (limits.address_space_bytes, limits.address_space_bytes))
    resource.setrlimit(resource.RLIMIT_FSIZE, (limits.output_size_bytes, limits.output_size_bytes))


def _terminate_process_group(process: subprocess.Popen[bytes]) -> None:
    """Terminate a Ghostscript process group without leaving child processes behind."""

    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=2)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        process.wait()


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


def normalize_pdf_strict(
    pdf_bytes: bytes,
    filename: str = "document.pdf",
    limits: PDFNormalizationLimits = PDFNormalizationLimits(),
) -> tuple[bytes, float]:
    """Produce a validated compatibility derivative or raise ``PDFNormalizationError``.

    Unlike ``normalize_pdf``, this function never returns original bytes after a
    Ghostscript failure. Callers use that distinction to present a terminal
    compatibility error instead of treating the original as a repaired file.
    """

    if not GHOSTSCRIPT_AVAILABLE:
        raise PDFNormalizationError("Ghostscript is not available", code="unavailable")
    if not pdf_bytes.startswith(PDF_HEADER):
        raise PDFNormalizationError("Source does not have a PDF signature", code="invalid_source")

    start_time = time.perf_counter()
    temp_base = "/dev/shm" if os.path.isdir("/dev/shm") and len(pdf_bytes) < 25 * 1024 * 1024 else None

    try:
        temp_context = tempfile.TemporaryDirectory(prefix="sambee_pdf_", dir=temp_base)
        temp_dir = temp_context.__enter__()
    except OSError:
        temp_context = tempfile.TemporaryDirectory(prefix="sambee_pdf_")
        temp_dir = temp_context.__enter__()

    try:
        temp_path = Path(temp_dir)
        input_path = temp_path / "input.pdf"
        output_path = temp_path / "output.pdf"
        input_path.write_bytes(pdf_bytes)
        gs_path: str = GHOSTSCRIPT_PATH  # type: ignore[assignment]
        command = [
            gs_path,
            "-dNOPAUSE",
            "-dBATCH",
            "-dQUIET",
            "-dSAFER",
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            "-dAutoRotatePages=/None",
            f"-sOutputFile={output_path}",
            str(input_path),
        ]

        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                start_new_session=True,
                preexec_fn=lambda: _resource_limiter(limits),
            )
            _, stderr = process.communicate(timeout=limits.timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            _terminate_process_group(process)
            raise PDFNormalizationError("Ghostscript conversion timed out", code="timeout") from exc
        except OSError as exc:
            raise PDFNormalizationError("Could not start Ghostscript", code="spawn_failed") from exc

        if process.returncode != 0:
            stderr_text = stderr.decode("utf-8", errors="replace")[:500]
            logger.warning(
                "Ghostscript compatibility conversion failed for %s: exit code %s: %s", filename, process.returncode, stderr_text
            )
            raise PDFNormalizationError("Ghostscript could not repair this PDF", code="conversion_failed")
        if not output_path.exists():
            raise PDFNormalizationError("Ghostscript produced no output", code="invalid_output")

        normalized_bytes = output_path.read_bytes()
        if len(normalized_bytes) > limits.output_size_bytes:
            raise PDFNormalizationError("Ghostscript output exceeded the configured limit", code="output_limit")
        if not is_valid_pdf_output(normalized_bytes):
            raise PDFNormalizationError("Ghostscript output was not a complete PDF", code="invalid_output")

        duration_ms = (time.perf_counter() - start_time) * 1000
        logger.info(
            "PDF compatibility derivative created for %s (%d -> %d bytes) in %.0f ms",
            filename,
            len(pdf_bytes),
            len(normalized_bytes),
            duration_ms,
        )
        return normalized_bytes, duration_ms
    finally:
        temp_context.__exit__(None, None, None)


def normalize_pdf_with_queue(
    pdf_bytes: bytes,
    filename: str,
    limits: PDFNormalizationLimits,
    maximum_concurrent: int,
    queue_wait_seconds: int,
) -> bytes:
    """Create a derivative while enforcing the configured process-wide queue limits."""

    normalized_bytes, _ = pdf_normalization_queue.run(
        maximum_concurrent=maximum_concurrent,
        wait_seconds=queue_wait_seconds,
        operation=lambda: normalize_pdf_strict(pdf_bytes, filename, limits),
    )
    return normalized_bytes


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

    try:
        normalized_bytes, duration_ms = normalize_pdf_strict(
            pdf_bytes,
            filename,
            limits=PDFNormalizationLimits(timeout_seconds=timeout_seconds, cpu_time_seconds=timeout_seconds),
        )
        return normalized_bytes, normalized_bytes != pdf_bytes, duration_ms
    except PDFNormalizationError as exc:
        logger.warning("PDF normalization failed for %s: %s", filename, exc)
        return pdf_bytes, False, 0.0


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
