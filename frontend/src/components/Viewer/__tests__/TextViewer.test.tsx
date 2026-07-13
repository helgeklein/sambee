import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import apiService from "../../../services/api";
import { SambeeThemeProvider } from "../../../theme";

const { readTextEditorMaxFileSizeBytesPreferenceMock } = vi.hoisted(() => ({
  readTextEditorMaxFileSizeBytesPreferenceMock: vi.fn(() => 52_428_800),
}));

vi.mock("../../../pages/FileBrowser/preferences", () => ({
  readTextEditorMaxFileSizeBytesPreference: readTextEditorMaxFileSizeBytesPreferenceMock,
}));

vi.mock("../TextCodeEditor", () => {
  const MockTextCodeEditor = forwardRef(function MockTextCodeEditor(props: any, ref) {
    const latestTextRef = useRef(props.text);

    latestTextRef.current = props.text;

    useImperativeHandle(ref, () => ({
      focus: vi.fn(),
      flushPendingEdits: vi.fn().mockResolvedValue(undefined),
      getCanonicalText: () => latestTextRef.current,
      getPrimarySelectionText: () => "",
      preserveSelection: vi.fn(),
      restorePreservedSelection: vi.fn().mockReturnValue(true),
      focusCurrentSearchResult: vi.fn().mockReturnValue(true),
      nextSearchResult: vi.fn(),
      previousSearchResult: vi.fn(),
    }));

    useEffect(() => {
      props.onSearchStateChange?.({
        searchText: props.searchText,
        searchMatches: props.searchText ? 2 : 0,
        currentMatch: props.searchText ? 1 : 0,
        isSearchOpen: props.searchOpen,
        isSearchable: true,
        viewMode: "source",
      });
    }, [props.onSearchStateChange, props.searchOpen, props.searchText]);

    return (
      <textarea
        aria-label={props.ariaLabel}
        className={props.className}
        readOnly={props.readOnly}
        value={props.text}
        onChange={(event) => {
          latestTextRef.current = event.target.value;
          props.onUserEdit?.();
          props.onChange(event.target.value);
        }}
      />
    );
  });

  return { TextCodeEditor: MockTextCodeEditor };
});

import TextViewer from "../TextViewer";

function renderViewer() {
  return render(
    <SambeeThemeProvider>
      <TextViewer connectionId="conn1" path="/docs/readme.txt" onClose={vi.fn()} />
    </SambeeThemeProvider>
  );
}

describe("TextViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readTextEditorMaxFileSizeBytesPreferenceMock.mockReturnValue(52_428_800);
    vi.spyOn(apiService, "supportsEditLocks").mockReturnValue(true);
    vi.spyOn(apiService, "getFileContent").mockResolvedValue("hello world");
    vi.spyOn(apiService, "acquireEditLock").mockResolvedValue({
      lock_id: "lock-1",
      file_path: "/docs/readme.txt",
      locked_by: "alice",
      locked_at: "2026-03-23T12:00:00Z",
    });
    vi.spyOn(apiService, "releaseEditLock").mockResolvedValue();
    vi.spyOn(apiService, "saveTextFile").mockResolvedValue();
    vi.spyOn(apiService, "downloadFile").mockResolvedValue();
    vi.spyOn(apiService, "getFileBlob").mockResolvedValue(new Blob(["test"]));
  });

  it("enters edit mode and saves text changes", async () => {
    renderViewer();

    const editButton = await screen.findByRole("button", { name: /edit/i });
    fireEvent.click(editButton);

    await waitFor(() => {
      expect(apiService.acquireEditLock).toHaveBeenCalledWith("conn1", "/docs/readme.txt", expect.any(String));
    });

    const editor = screen.getByRole("textbox", { name: "Text editor" });
    fireEvent.change(editor, { target: { value: "updated text" } });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(apiService.saveTextFile).toHaveBeenCalledWith("conn1", "/docs/readme.txt", "updated text", { filename: "readme.txt" });
    });
  });

  it("falls back to read-only large-file mode when the configured limit is exceeded", async () => {
    readTextEditorMaxFileSizeBytesPreferenceMock.mockReturnValue(4);
    vi.spyOn(apiService, "getFileContent").mockResolvedValueOnce("this content is too large");

    renderViewer();

    expect(await screen.findByText(/exceeds your Text Editor limit/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeDisabled();
  });
});
