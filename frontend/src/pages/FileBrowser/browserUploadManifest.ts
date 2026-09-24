import { validateItemName } from "../../components/FileBrowser/nameDialogStrings";

const MAX_UPLOAD_ENTRIES = 10000;
const MAX_UPLOAD_DEPTH = 32;

export interface BrowserUploadDirectory {
  kind: "directory";
  segments: string[];
}

export interface BrowserUploadFile {
  kind: "file";
  segments: string[];
  file: File;
}

export type BrowserUploadEntry = BrowserUploadDirectory | BrowserUploadFile;

function validateSegments(segments: string[]): void {
  if (segments.length === 0 || segments.length > MAX_UPLOAD_DEPTH) throw new Error("Upload path is too deep or empty.");
  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      Array.from(segment).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
      validateItemName(segment)
    ) {
      throw new Error(`Invalid upload path: ${segment || "(empty)"}`);
    }
  }
}

function buildManifest(entries: BrowserUploadEntry[], preserveFlatOrder = false): BrowserUploadEntry[] {
  const directories = new Map<string, BrowserUploadDirectory>();
  const explicitDirectories = new Set<string>();
  const files = new Map<string, BrowserUploadFile>();
  for (const entry of entries) {
    validateSegments(entry.segments);
    for (let length = 1; length < entry.segments.length; length++) {
      const segments = entry.segments.slice(0, length);
      directories.set(segments.join("/"), { kind: "directory", segments });
    }
    const path = entry.segments.join("/");
    if (entry.kind === "directory") {
      if (explicitDirectories.has(path)) throw new Error(`Duplicate upload folder: ${path}`);
      explicitDirectories.add(path);
      directories.set(path, entry);
    } else {
      if (files.has(path)) throw new Error(`Duplicate upload path: ${path}`);
      files.set(path, entry);
    }
    if (directories.size + files.size > MAX_UPLOAD_ENTRIES) throw new Error("Upload contains too many items.");
  }
  for (const path of files.keys()) {
    if (directories.has(path)) throw new Error(`File and folder share an upload path: ${path}`);
  }
  if (preserveFlatOrder && directories.size === 0) return [...files.values()];
  return [...directories.values(), ...files.values()].sort(
    (left, right) => left.segments.length - right.segments.length || left.segments.join("/").localeCompare(right.segments.join("/"))
  );
}

export function manifestFromFiles(files: FileList | File[], folder: boolean): BrowserUploadEntry[] {
  const selected = Array.from(files);
  if (folder && selected.some((file) => !file.webkitRelativePath?.includes("/"))) {
    throw new Error("This browser did not provide usable folder paths. Use Upload files.");
  }
  const manifest = buildManifest(
    selected.map((file) => ({
      kind: "file" as const,
      file,
      segments: folder ? file.webkitRelativePath.split("/") : [file.name],
    })),
    !folder
  );
  if (folder && new Set(manifest.map((entry) => entry.segments[0])).size !== 1) {
    throw new Error("Select one folder at a time.");
  }
  return manifest;
}

export function captureDropEntries(items: DataTransferItemList): FileSystemEntry[] {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") throw new Error("Only files and folders can be uploaded.");
    const entry = item.webkitGetAsEntry?.();
    if (!entry) throw new Error("Folder drops are unavailable in this browser. Use Upload instead.");
    entries.push(entry);
  }
  if (!entries.length) throw new Error("No files or folders were dropped.");
  return entries;
}

export async function manifestFromDrop(entries: FileSystemEntry[], signal: AbortSignal): Promise<BrowserUploadEntry[]> {
  const collected: BrowserUploadEntry[] = [];
  const throwIfCancelled = () => {
    if (signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
  };
  const readEntry = <T>(start: (resolve: (value: T) => void, reject: (error: DOMException) => void) => void): Promise<T> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Upload cancelled", "AbortError"));
        return;
      }
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        reject(new DOMException("Upload cancelled", "AbortError"));
      };
      const finish = (value: T) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const fail = (error: DOMException) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        start(finish, fail);
      } catch (error) {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    });
  async function walk(entry: FileSystemEntry, parent: string[]): Promise<void> {
    throwIfCancelled();
    const segments = [...parent, entry.name];
    validateSegments(segments);
    if (++visited > MAX_UPLOAD_ENTRIES) throw new Error("Upload contains too many items.");
    if (entry.isFile) {
      const file = await readEntry<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      throwIfCancelled();
      collected.push({ kind: "file", segments, file });
      return;
    }
    if (!entry.isDirectory) throw new Error(`Cannot read dropped item: ${entry.name}`);
    collected.push({ kind: "directory", segments });
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    while (true) {
      throwIfCancelled();
      const batch = await readEntry<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      throwIfCancelled();
      if (!batch.length) break;
      for (const child of batch) await walk(child, segments);
    }
  }
  let visited = 0;
  for (const entry of entries) await walk(entry, []);
  throwIfCancelled();
  return buildManifest(collected);
}
