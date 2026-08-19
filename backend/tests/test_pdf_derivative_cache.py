from app.services.pdf_derivative_cache import PDFDerivativeCache, PDFDerivativeCachePolicy, PDFSourceRevision

VALID_DERIVATIVE = b"%PDF-1.4\ncompatibility derivative\n%%EOF\n"
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
