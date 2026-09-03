"""Shared virtual-tree conformance tests for archive creation manifests."""

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import pytest

from app.models.file import DirectoryListing, FileInfo, FileType
from app.services.archive.coordinator import ArchiveCreationManifest, ArchiveCreationManifestMember
from app.services.archive.creation import build_archive_creation_manifest
from app.services.archive.v2_checkpoint import canonical_v2_timestamp
from app.services.archive.zip_reader import ArchiveFormatError

CORPUS_PATH = Path(__file__).resolve().parents[2] / "archive-contract" / "v2" / "fixtures" / "creation-manifest-scenarios-v2.json"


@dataclass(frozen=True)
class VirtualInfo:
    path: str
    type: object
    size: int | None = None


class VirtualCreationSource:
    def __init__(self, nodes: list[dict[str, object]]) -> None:
        self.nodes = {str(node["path"]): node for node in nodes}

    def _info(self, path: str) -> FileInfo | VirtualInfo:
        node = self.nodes[path]
        node_type = node["type"]
        modified_at = datetime.fromisoformat(str(node["modified_at"])) if "modified_at" in node else None
        if node_type == "file":
            return FileInfo(
                name=path.rsplit("/", 1)[-1],
                path=path,
                type=FileType.FILE,
                size=int(node.get("size", 0)),
                modified_at=modified_at,
            )
        if node_type == "directory":
            return FileInfo(name=path.rsplit("/", 1)[-1], path=path, type=FileType.DIRECTORY, modified_at=modified_at)
        return VirtualInfo(path, node_type)

    async def get_file_info(self, path: str) -> FileInfo | VirtualInfo:
        return self._info(path)

    async def list_directory(self, path: str = "") -> DirectoryListing:
        prefix = f"{path}/" if path else ""
        items = [self._info(candidate) for candidate in self.nodes if candidate.startswith(prefix) and "/" not in candidate[len(prefix) :]]
        return DirectoryListing(path=path, items=items, total=len(items))  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_v2_creation_manifest_virtual_tree_corpus() -> None:
    corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 2
    for scenario in corpus["scenarios"]:
        source = VirtualCreationSource(scenario["nodes"])
        if "error" in scenario:
            with pytest.raises(ArchiveFormatError):
                await build_archive_creation_manifest(source, scenario["sources"], scenario["target"])
            continue
        entries = await build_archive_creation_manifest(source, scenario["sources"], scenario["target"])
        manifest = ArchiveCreationManifest.from_members(
            [
                ArchiveCreationManifestMember(
                    archive_path=entry.archive_path,
                    is_directory=entry.info.type == FileType.DIRECTORY,
                    source_size=entry.info.size or 0,
                    source_path=entry.source_path,
                    source_modified_at=entry.source_modified_at,
                )
                for entry in entries
            ]
        )
        actual_manifest = []
        for entry, expected in zip(manifest.members, scenario["manifest"], strict=True):
            actual = {
                "archive_path": entry.archive_path,
                "is_directory": entry.is_directory,
                "source_size": entry.source_size,
            }
            if "modified_at" in expected:
                actual["modified_at"] = canonical_v2_timestamp(entry.source_modified_at)
            actual_manifest.append(actual)
        assert actual_manifest == scenario["manifest"]
