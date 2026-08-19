"""Private local cache for PDF.js compatibility derivatives."""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from app.core.config import static
from app.core.logging import get_logger
from app.services.pdf_inspector import is_structurally_valid_pdf
from app.services.pdf_normalizer import NORMALIZER_CONFIG_VERSION, get_ghostscript_version, is_valid_pdf_output

logger = get_logger(__name__)
CACHE_DIRECTORY_NAME = "pdf_derivatives"


@dataclass(frozen=True)
class PDFSourceRevision:
    """Best available SMB revision metadata for one derivative source."""

    path: str
    size: int | None
    modified_at: str | None
    created_at: str | None = None
    stable_id: str | None = None
    content_digest: str | None = None

    def cache_identity(self) -> dict[str, str | int | None]:
        """Return revision values obtainable without reading the SMB file."""

        return {
            "path": self.path,
            "size": self.size,
            "modified_at": self.modified_at,
            "created_at": self.created_at,
            "stable_id": self.stable_id,
        }


@dataclass(frozen=True)
class PDFDerivativeCachePolicy:
    quota_bytes: int
    inactivity_ttl_seconds: int


class PDFDerivativeCache:
    """A user-namespaced derivative cache scoped to one backend process."""

    def __init__(self, root: Path | None = None) -> None:
        self._root = root or static.data_dir / CACHE_DIRECTORY_NAME
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    @staticmethod
    def cache_key(user_id: str, connection_id: str, revision: PDFSourceRevision, variant: str) -> str:
        payload = {
            "connection_id": connection_id,
            "normalizer_config_version": NORMALIZER_CONFIG_VERSION,
            "ghostscript_version": get_ghostscript_version(),
            "revision": revision.cache_identity(),
            "user_id": user_id,
            "variant": variant,
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    def get(
        self,
        *,
        user_id: str,
        connection_id: str,
        revision: PDFSourceRevision,
        variant: str,
        policy: PDFDerivativeCachePolicy,
    ) -> bytes | None:
        """Read an existing derivative using only SMB metadata supplied by the caller."""

        if policy.quota_bytes == 0:
            return None
        return self._read(user_id, self.cache_key(user_id, connection_id, revision, variant), revision, policy)

    def invalidate(
        self,
        *,
        user_id: str,
        connection_id: str,
        revision: PDFSourceRevision,
        variant: str,
    ) -> None:
        """Remove a user's derivative for the supplied source metadata."""

        pdf_path, metadata_path = self._entry_paths(user_id, self.cache_key(user_id, connection_id, revision, variant))
        self._delete(pdf_path, metadata_path)

    def get_or_create(
        self,
        *,
        user_id: str,
        connection_id: str,
        revision: PDFSourceRevision,
        variant: str,
        policy: PDFDerivativeCachePolicy,
        create: Callable[[], bytes],
    ) -> tuple[bytes, bool]:
        """Return a derivative and whether it was a cache hit.

        The key lock coalesces conversion requests in one process. The cache
        policy with a zero quota intentionally bypasses cache reads and writes.
        """

        key = self.cache_key(user_id, connection_id, revision, variant)
        if policy.quota_bytes == 0:
            return create(), False

        cached = self.get(user_id=user_id, connection_id=connection_id, revision=revision, variant=variant, policy=policy)
        if cached is not None:
            return cached, True

        lock = self._lock_for(key)
        with lock:
            cached = self.get(user_id=user_id, connection_id=connection_id, revision=revision, variant=variant, policy=policy)
            if cached is not None:
                return cached, True
            derivative = create()
            if len(derivative) <= policy.quota_bytes:
                self._write(user_id, key, revision, variant, derivative, policy)
            else:
                logger.info("PDF derivative exceeds cache quota and will not be stored: %d bytes", len(derivative))
            return derivative, False

    def _lock_for(self, key: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(key, threading.Lock())

    def _entry_paths(self, user_id: str, key: str) -> tuple[Path, Path]:
        user_namespace = hashlib.sha256(user_id.encode("utf-8")).hexdigest()
        directory = self._root / user_namespace
        return directory / f"{key}.pdf", directory / f"{key}.json"

    def _read(self, user_id: str, key: str, revision: PDFSourceRevision, policy: PDFDerivativeCachePolicy) -> bytes | None:
        pdf_path, metadata_path = self._entry_paths(user_id, key)
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if metadata.get("revision") != revision.cache_identity():
                self._delete(pdf_path, metadata_path)
                return None
            if time.time() - float(metadata["last_accessed_at"]) > policy.inactivity_ttl_seconds:
                self._delete(pdf_path, metadata_path)
                return None
            derivative = pdf_path.read_bytes()
            if not is_valid_pdf_output(derivative) or not is_structurally_valid_pdf(derivative):
                self._delete(pdf_path, metadata_path)
                return None
            metadata["last_accessed_at"] = time.time()
            self._atomic_write(metadata_path, json.dumps(metadata, separators=(",", ":")).encode("utf-8"))
            return derivative
        except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError):
            self._delete(pdf_path, metadata_path)
            return None

    def _write(
        self,
        user_id: str,
        key: str,
        revision: PDFSourceRevision,
        variant: str,
        derivative: bytes,
        policy: PDFDerivativeCachePolicy,
    ) -> None:
        if not is_valid_pdf_output(derivative) or not is_structurally_valid_pdf(derivative):
            raise ValueError("Refusing to cache incomplete PDF derivative")
        pdf_path, metadata_path = self._entry_paths(user_id, key)
        pdf_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            os.chmod(pdf_path.parent, 0o700)
        except OSError:
            logger.warning("Could not enforce private permissions on PDF derivative cache directory")

        self._evict(pdf_path.parent, policy, additional_bytes=len(derivative))
        now = time.time()
        metadata = {
            "created_at": now,
            "last_accessed_at": now,
            "revision": revision.cache_identity(),
            "source_digest": revision.content_digest,
            "size": len(derivative),
            "variant": variant,
        }
        self._atomic_write(pdf_path, derivative)
        self._atomic_write(metadata_path, json.dumps(metadata, separators=(",", ":")).encode("utf-8"))

    def _evict(self, directory: Path, policy: PDFDerivativeCachePolicy, *, additional_bytes: int) -> None:
        entries: list[tuple[float, int, Path, Path]] = []
        total_bytes = 0
        now = time.time()
        for metadata_path in directory.glob("*.json"):
            pdf_path = metadata_path.with_suffix(".pdf")
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                last_accessed_at = float(metadata["last_accessed_at"])
                size = int(metadata["size"])
                if now - last_accessed_at > policy.inactivity_ttl_seconds or not pdf_path.is_file():
                    self._delete(pdf_path, metadata_path)
                    continue
                total_bytes += size
                entries.append((last_accessed_at, size, pdf_path, metadata_path))
            except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError):
                self._delete(pdf_path, metadata_path)

        for _, size, pdf_path, metadata_path in sorted(entries):
            if total_bytes + additional_bytes <= policy.quota_bytes:
                break
            self._delete(pdf_path, metadata_path)
            total_bytes -= size

    @staticmethod
    def _atomic_write(path: Path, content: bytes) -> None:
        temporary_path = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            with temporary_path.open("xb") as output:
                os.chmod(output.fileno(), 0o600)
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary_path, path)
        finally:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass

    @staticmethod
    def _delete(pdf_path: Path, metadata_path: Path) -> None:
        for path in (pdf_path, metadata_path):
            try:
                path.unlink()
            except FileNotFoundError:
                continue
            except OSError:
                logger.warning("Could not remove invalid PDF derivative cache entry: %s", path)


pdf_derivative_cache = PDFDerivativeCache()
