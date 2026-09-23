"""Archive-creation source backed by validated virtual ZIP members."""

from collections.abc import AsyncIterator

from app.models.file import DirectoryListing, FileInfo, FileType
from app.services.archive.zip_reader import ArchiveFormatError, ValidatedZipEntry, ZipEntry, ZipReader


class ZipArchiveCreationSource:
    """Project ZIP members as files and directories for the portable creator."""

    def __init__(self, reader: ZipReader) -> None:
        self.reader = reader
        self._validated: dict[str, ValidatedZipEntry] = {}

    async def validate_projection(self) -> None:
        _entries, skipped = await self.reader.extraction_entries()
        if skipped:
            raise ArchiveFormatError("ZIP contains unsafe or unsupported members")

    @staticmethod
    def _file_info(entry: ZipEntry) -> FileInfo:
        if not entry.is_safe or not entry.has_supported_file_type or entry.encrypted or entry.compression_method not in {0, 8, 12}:
            raise ArchiveFormatError("Selected ZIP member cannot be downloaded")
        return FileInfo(
            name=entry.path.rsplit("/", 1)[-1],
            path=entry.path,
            type=FileType.DIRECTORY if entry.is_directory else FileType.FILE,
            size=0 if entry.is_directory else entry.uncompressed_size,
            modified_at=entry.modified_at,
        )

    async def list_directory(self, path: str = "") -> DirectoryListing:
        cursor = None
        items: list[FileInfo] = []
        while True:
            page = await self.reader.list_directory(path, cursor, 500)
            for entry in page.entries:
                info = self._file_info(entry)
                if not entry.is_directory:
                    self._validated[entry.path] = await self.reader.validate_entry(entry)
                items.append(info)
            if page.next_cursor is None:
                break
            cursor = page.next_cursor
        return DirectoryListing(path=path, items=items, total=len(items))

    async def get_file_info(self, path: str) -> FileInfo:
        if not path or path.startswith("/") or "\\" in path or "\x00" in path or any(part in {"", ".", ".."} for part in path.split("/")):
            raise ArchiveFormatError("Selected ZIP member path is invalid")
        parent = path.rpartition("/")[0]
        listing = await self.list_directory(parent)
        for info in listing.items:
            if info.path == path:
                return info
        raise FileNotFoundError(path)

    async def read_file(self, path: str) -> AsyncIterator[bytes]:
        validated = self._validated.get(path)
        if validated is None:
            await self.get_file_info(path)
            validated = self._validated.get(path)
        if validated is None:
            raise ArchiveFormatError("Selected ZIP file cannot be read")
        async for chunk in self.reader.stream_validated_entry(validated):
            yield chunk
