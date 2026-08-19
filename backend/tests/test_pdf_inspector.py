from io import BytesIO

from pypdf import PdfWriter

from app.services.pdf_inspector import PDFScreenProfile, analyze_pdf_for_screen, is_structurally_valid_pdf


def _blank_pdf() -> bytes:
    output = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(output)
    return output.getvalue()


def test_structural_validation_requires_a_parseable_pdf() -> None:
    assert is_structurally_valid_pdf(_blank_pdf())
    assert not is_structurally_valid_pdf(b"%PDF-1.7\nnot a real document\n%%EOF")


def test_screen_analysis_uses_physical_viewport_and_zoom(monkeypatch) -> None:
    import app.services.pdf_inspector as inspector

    monkeypatch.setattr(inspector, "_image_placements", lambda _page, _reader: [(10_000, 10_000, 612.0, 792.0)])
    profile = PDFScreenProfile(width_pixels=5120, height_pixels=2880, zoom_percent=200)

    analysis = analyze_pdf_for_screen(_blank_pdf(), profile, maximum_decoded_pixels=64 * 1024 * 1024)

    assert analysis.is_oversized
    assert analysis.maximum_required_pixels > 0
    assert analysis.screen_resolution_dpi > 0
