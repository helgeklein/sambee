from io import BytesIO

from pypdf import PdfWriter

from app.services.pdf_derivative_cache import PDFDerivativeCache, PDFDerivativeCachePolicy, PDFSourceRevision


def _valid_derivative() -> bytes:
    output = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(output)
    return output.getvalue()


VALID_DERIVATIVE = _valid_derivative()
REVISION = PDFSourceRevision(path="/document.pdf", size=42, modified_at="2026-01-01T00:00:00+00:00")
POLICY = PDFDerivativeCachePolicy(quota_bytes=1024 * 1024, inactivity_ttl_seconds=60)


def test_cache_reuses_derivative_for_same_user_and_revision(tmp_path) -> None:
    cache = PDFDerivativeCache(tmp_path)
    create_calls = 0

    def create() -> bytes:
        nonlocal create_calls
        create_calls += 1
        return VALID_DERIVATIVE

    first, first_hit = cache.get_or_create(
        user_id="user-a", connection_id="connection", revision=REVISION, variant="normalized", policy=POLICY, create=create
    )
    second, second_hit = cache.get_or_create(
        user_id="user-a", connection_id="connection", revision=REVISION, variant="normalized", policy=POLICY, create=create
    )

    assert first == VALID_DERIVATIVE
    assert second == VALID_DERIVATIVE
    assert first_hit is False
    assert second_hit is True
    assert create_calls == 1


def test_cache_isolated_per_user_and_zero_quota_bypasses_storage(tmp_path) -> None:
    cache = PDFDerivativeCache(tmp_path)
    create_calls = 0

    def create() -> bytes:
        nonlocal create_calls
        create_calls += 1
        return VALID_DERIVATIVE

    cache.get_or_create(user_id="user-a", connection_id="connection", revision=REVISION, variant="normalized", policy=POLICY, create=create)
    _, other_user_hit = cache.get_or_create(
        user_id="user-b", connection_id="connection", revision=REVISION, variant="normalized", policy=POLICY, create=create
    )
    no_cache_policy = PDFDerivativeCachePolicy(quota_bytes=0, inactivity_ttl_seconds=60)
    _, first_zero_quota_hit = cache.get_or_create(
        user_id="user-a", connection_id="connection", revision=REVISION, variant="normalized", policy=no_cache_policy, create=create
    )
    _, second_zero_quota_hit = cache.get_or_create(
        user_id="user-a", connection_id="connection", revision=REVISION, variant="normalized", policy=no_cache_policy, create=create
    )

    assert other_user_hit is False
    assert first_zero_quota_hit is False
    assert second_zero_quota_hit is False
    assert create_calls == 4


def test_cache_get_and_invalidate_use_metadata_without_creating(tmp_path) -> None:
    cache = PDFDerivativeCache(tmp_path)
    cache.get_or_create(
        user_id="user-a",
        connection_id="connection",
        revision=REVISION,
        variant="normalized",
        policy=POLICY,
        create=lambda: VALID_DERIVATIVE,
    )

    assert (
        cache.get(user_id="user-a", connection_id="connection", revision=REVISION, variant="normalized", policy=POLICY) == VALID_DERIVATIVE
    )

    cache.invalidate(user_id="user-a", connection_id="connection", revision=REVISION, variant="normalized")

    assert cache.get(user_id="user-a", connection_id="connection", revision=REVISION, variant="normalized", policy=POLICY) is None


def test_cache_evicts_marker_valid_but_structurally_invalid_derivative(tmp_path) -> None:
    cache = PDFDerivativeCache(tmp_path)
    cache.get_or_create(
        user_id="user-a",
        connection_id="connection",
        revision=REVISION,
        variant="normalized",
        policy=POLICY,
        create=lambda: VALID_DERIVATIVE,
    )
    key = cache.cache_key("user-a", "connection", REVISION, "normalized")
    pdf_path, _ = cache._entry_paths("user-a", key)
    pdf_path.write_bytes(b"%PDF-1.7\nnot a real document\n%%EOF")

    assert cache.get(user_id="user-a", connection_id="connection", revision=REVISION, variant="normalized", policy=POLICY) is None
    assert not pdf_path.exists()
