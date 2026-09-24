import { describe, expect, it, vi } from "vitest";
import { captureDropEntries, manifestFromDrop, manifestFromFiles } from "./browserUploadManifest";

function pickedFile(name: string, relativePath: string): File {
  const file = new File(["content"], name);
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

function droppedFile(name: string): FileSystemEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (success: (file: File) => void) => success(new File(["content"], name)),
  } as unknown as FileSystemEntry;
}

function droppedDirectory(name: string, batches: FileSystemEntry[][]): FileSystemEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => ({ readEntries: (success: (entries: FileSystemEntry[]) => void) => success(batches.shift() ?? []) }),
  } as unknown as FileSystemEntry;
}

describe("browser upload manifests", () => {
  it("retains one picker root with validated parent-first paths", () => {
    const manifest = manifestFromFiles([pickedFile("one.txt", "Reports/2026/one.txt")], true);
    expect(manifest.map((entry) => [entry.kind, entry.segments.join("/")])).toEqual([
      ["directory", "Reports"],
      ["directory", "Reports/2026"],
      ["file", "Reports/2026/one.txt"],
    ]);
  });

  it("preserves the native picker order for flat file selections", () => {
    expect(manifestFromFiles([new File(["z"], "z.txt"), new File(["a"], "a.txt")], false).map((entry) => entry.segments[0])).toEqual([
      "z.txt",
      "a.txt",
    ]);
  });

  it("rejects unusable or ambiguous picker paths before mutation", () => {
    expect(() => manifestFromFiles([pickedFile("one.txt", "")], true)).toThrow(/folder paths/);
    expect(() => manifestFromFiles([pickedFile("one.txt", "A/one.txt"), pickedFile("two.txt", "B/two.txt")], true)).toThrow(/one folder/);
    expect(() => manifestFromFiles([pickedFile("one.txt", "A/../one.txt")], true)).toThrow(/Invalid upload path/);
  });

  it("captures each dropped item synchronously and rejects an incomplete capture", () => {
    const entry = droppedFile("one.txt");
    const getEntry = vi.fn(() => entry);
    expect(captureDropEntries([{ kind: "file", webkitGetAsEntry: getEntry }] as unknown as DataTransferItemList)).toEqual([entry]);
    expect(getEntry).toHaveBeenCalledOnce();
    expect(() => captureDropEntries([{ kind: "file", webkitGetAsEntry: () => null }] as unknown as DataTransferItemList)).toThrow(
      /unavailable/
    );
  });

  it("reads all directory batches and preserves empty folders in mixed drops", async () => {
    const entries = [
      droppedDirectory("Reports", [[droppedFile("one.txt")], [droppedDirectory("Empty", [])], []]),
      droppedFile("loose.txt"),
    ];
    const manifest = await manifestFromDrop(entries, new AbortController().signal);
    expect(manifest.map((entry) => [entry.kind, entry.segments.join("/")])).toEqual([
      ["file", "loose.txt"],
      ["directory", "Reports"],
      ["directory", "Reports/Empty"],
      ["file", "Reports/one.txt"],
    ]);
  });

  it("rejects duplicate roots and respects preparation cancellation", async () => {
    await expect(
      manifestFromDrop([droppedDirectory("Same", []), droppedDirectory("Same", [])], new AbortController().signal)
    ).rejects.toThrow(/Duplicate/);
    const controller = new AbortController();
    controller.abort();
    await expect(manifestFromDrop([droppedFile("one.txt")], controller.signal)).rejects.toThrow(/cancelled/);
  });

  it("rejects failed directory enumeration instead of uploading a partial tree", async () => {
    const failedDirectory = {
      name: "Reports",
      isFile: false,
      isDirectory: true,
      createReader: () => ({ readEntries: (_success: unknown, reject: (error: Error) => void) => reject(new Error("Read failed")) }),
    } as unknown as FileSystemEntry;
    await expect(manifestFromDrop([failedDirectory], new AbortController().signal)).rejects.toThrow("Read failed");
  });

  it("cancels preparation while a directory reader is pending", async () => {
    let finishRead: ((entries: FileSystemEntry[]) => void) | undefined;
    const pendingDirectory = {
      name: "Reports",
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (success: (entries: FileSystemEntry[]) => void) => {
          finishRead = success;
        },
      }),
    } as unknown as FileSystemEntry;
    const controller = new AbortController();
    const preparation = manifestFromDrop([pendingDirectory], controller.signal);
    expect(finishRead).toBeDefined();
    controller.abort();
    await expect(preparation).rejects.toThrow(/cancelled/);
    finishRead!([]);
  });

  it("bounds both depth and total item count before uploads start", async () => {
    const deepPath = `${Array.from({ length: 32 }, () => "child").join("/")}/file.txt`;
    expect(() => manifestFromFiles([pickedFile("file.txt", deepPath)], true)).toThrow(/too deep/);
    const files = Array.from({ length: 10001 }, (_, index) => new File([""], `file-${index}.txt`));
    expect(() => manifestFromFiles(files, false)).toThrow(/too many items/);
  });
});
