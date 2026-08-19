"""PDF structure and image-placement inspection without rendering pages."""

from __future__ import annotations

import math
from dataclasses import dataclass
from io import BytesIO
from typing import Any

from pypdf import PdfReader
from pypdf.errors import PdfReadError
from pypdf.generic import ContentStream


@dataclass(frozen=True)
class PDFScreenProfile:
    """Physical rendering target supplied by the PDF viewer."""

    width_pixels: int
    height_pixels: int
    zoom_percent: int

    def cache_suffix(self) -> str:
        return f"{self.width_pixels}x{self.height_pixels}-z{self.zoom_percent}"


@dataclass(frozen=True)
class PDFScreenAnalysis:
    """Resource-based result of image-placement inspection."""

    is_oversized: bool
    maximum_image_pixels: int
    maximum_required_pixels: int
    screen_resolution_dpi: int


def is_structurally_valid_pdf(pdf_bytes: bytes) -> bool:
    """Return whether a PDF parser can resolve the document and all pages."""

    try:
        reader = PdfReader(BytesIO(pdf_bytes), strict=True)
        if reader.is_encrypted:
            return False
        return len(reader.pages) > 0
    except (PdfReadError, OSError, ValueError):
        return False


def analyze_pdf_for_screen(pdf_bytes: bytes, profile: PDFScreenProfile, maximum_decoded_pixels: int) -> PDFScreenAnalysis:
    """Find oversized image placements relative to a physical display profile.

    The decision is based on source pixels versus the pixels the submitted
    display profile can render at the requested zoom. It intentionally has no
    fixed DPI threshold.
    """

    try:
        reader = PdfReader(BytesIO(pdf_bytes), strict=False)
    except (PdfReadError, OSError, ValueError):
        return PDFScreenAnalysis(False, 0, 0, 0)
    if reader.is_encrypted:
        return PDFScreenAnalysis(False, 0, 0, 0)

    maximum_image_pixels = 0
    maximum_required_pixels = 0
    screen_resolution_dpi = 0
    for page in reader.pages:
        page_width = float(page.mediabox.width)
        page_height = float(page.mediabox.height)
        if page_width <= 0 or page_height <= 0:
            continue
        zoom = profile.zoom_percent / 100
        page_scale = min(profile.width_pixels / page_width, profile.height_pixels / page_height) * zoom
        screen_resolution_dpi = max(screen_resolution_dpi, math.ceil(page_scale * 72))
        for image_width, image_height, display_width, display_height in _image_placements(page, reader):
            image_pixels = image_width * image_height
            required_pixels = max(1, math.ceil(display_width * page_scale)) * max(1, math.ceil(display_height * page_scale))
            maximum_image_pixels = max(maximum_image_pixels, image_pixels)
            maximum_required_pixels = max(maximum_required_pixels, required_pixels)
            if image_pixels > maximum_decoded_pixels and image_pixels > required_pixels:
                return PDFScreenAnalysis(True, maximum_image_pixels, maximum_required_pixels, screen_resolution_dpi)
    return PDFScreenAnalysis(False, maximum_image_pixels, maximum_required_pixels, screen_resolution_dpi)


def _image_placements(page: Any, reader: PdfReader) -> list[tuple[int, int, float, float]]:
    resources = page.get("/Resources")
    if resources is None:
        return []
    xobjects = resources.get("/XObject")
    if xobjects is None:
        return []
    placements: list[tuple[int, int, float, float]] = []
    matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    matrix_stack: list[tuple[float, float, float, float, float, float]] = []
    try:
        operations = ContentStream(page.get_contents(), reader).operations
    except (PdfReadError, OSError, ValueError):
        return placements
    for operands, operator in operations:
        if operator == b"q":
            matrix_stack.append(matrix)
        elif operator == b"Q" and matrix_stack:
            matrix = matrix_stack.pop()
        elif operator == b"cm" and len(operands) == 6:
            matrix = _multiply_matrix(
                matrix,
                (
                    float(operands[0]),
                    float(operands[1]),
                    float(operands[2]),
                    float(operands[3]),
                    float(operands[4]),
                    float(operands[5]),
                ),
            )
        elif operator == b"Do" and operands:
            xobject = xobjects.get(operands[0])
            if xobject is None:
                continue
            image = xobject.get_object()
            if image.get("/Subtype") != "/Image":
                continue
            width = int(image.get("/Width", 0))
            height = int(image.get("/Height", 0))
            if width <= 0 or height <= 0:
                continue
            display_width = math.hypot(matrix[0], matrix[1])
            display_height = math.hypot(matrix[2], matrix[3])
            if display_width > 0 and display_height > 0:
                placements.append((width, height, display_width, display_height))
    return placements


def _multiply_matrix(
    left: tuple[float, float, float, float, float, float], right: tuple[float, float, float, float, float, float]
) -> tuple[float, float, float, float, float, float]:
    a, b, c, d, e, f = left
    a2, b2, c2, d2, e2, f2 = right
    return (a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f)
