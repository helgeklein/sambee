"""Shared virtual-tree conformance tests for archive creation manifests."""

import json
from dataclasses import dataclass
from pathlib import Path

import pytest

from app.models.file import DirectoryListing, FileInfo, FileType
from app.services.archive.creation import build_archive_creation_manifest
from app.services.archive.zip_reader import ArchiveFormatError

CORPUS_PATH = Path(__file__).resolve().parents[2] / "archive-contract" / "v1" / "creation-manifest-scenarios-v1.json"


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
        if node_type == "file":
            return FileInfo(name=path.rsplit("/", 1)[-1], path=path, type=FileType.FILE, size=int(node.get("size", 0)))
        if node_type == "directory":
            return FileInfo(name=path.rsplit("/", 1)[-1], path=path, type=FileType.DIRECTORY)
        return VirtualInfo(path, node_type)

    async def get_file_info(self, path: str) -> FileInfo | VirtualInfo:
        return self._info(path)

    async def list_directory(self, path: str = "") -> DirectoryListing:
        prefix = f"{path}/" if path else ""
        items = [self._info(candidate) for candidate in self.nodes if candidate.startswith(prefix) and "/" not in candidate[len(prefix) :]]
        return DirectoryListing(path=path, items=items, total=len(items))  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_v1_creation_manifest_virtual_tree_corpus() -> None:
    corpus = json.loads(CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["version"] == 1
    for scenario in corpus["scenarios"]:
        source = VirtualCreationSource(scenario["nodes"])
        if "error" in scenario:
            with pytest.raises(ArchiveFormatError):
                await build_archive_creation_manifest(source, scenario["sources"], scenario["target"])
            continue
        manifest = await build_archive_creation_manifest(source, scenario["sources"], scenario["target"])
        assert [
            {"archive_path": entry.archive_path, "is_directory": entry.info.type == FileType.DIRECTORY, "source_size": entry.info.size or 0}
            for entry in manifest
        ] == scenario["manifest"]
