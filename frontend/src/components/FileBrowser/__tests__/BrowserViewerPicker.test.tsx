import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserViewerPicker } from "../BrowserViewerPicker";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "common.actions.cancel": "Cancel",
        "fileBrowser.viewerPicker.title": "Choose Viewer",
        "fileBrowser.viewerPicker.open": "Open",
        "fileBrowser.viewerPicker.alwaysUse": "Always use this viewer for this file type",
        "fileBrowser.viewerPicker.compatible": "Compatible viewer",
        "fileBrowser.viewerPicker.override": "Override viewer",
        "fileBrowser.viewerPicker.openInNativeApp": "Open in native app",
        "fileBrowser.viewerPicker.nativeDescription": "Use your desktop application instead of a Sambee viewer",
        "fileBrowser.viewerPicker.viewers.image": "Image Viewer",
        "fileBrowser.viewerPicker.viewers.markdown": "Markdown Viewer",
        "fileBrowser.viewerPicker.viewers.pdf": "PDF Viewer",
      };

      return translations[key] ?? key;
    },
  }),
}));

describe("BrowserViewerPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets users persist a compatible Sambee viewer selection", () => {
    const onConfirm = vi.fn();

    render(
      <BrowserViewerPicker
        open={true}
        fileName="report.pdf"
        viewerIds={["pdf", "markdown"]}
        compatibleViewerIds={["pdf"]}
        preferredViewerId="pdf"
        showNativeOption={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(onConfirm).toHaveBeenCalledWith({
      viewerId: "pdf",
      rememberSelection: true,
    });
  });

  it("prevents persisting incompatible override viewers", () => {
    const onConfirm = vi.fn();

    render(
      <BrowserViewerPicker
        open={true}
        fileName="report.pdf"
        viewerIds={["pdf", "markdown"]}
        compatibleViewerIds={["pdf"]}
        preferredViewerId="pdf"
        showNativeOption={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByText("Markdown Viewer"));

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(onConfirm).toHaveBeenCalledWith({
      viewerId: "markdown",
      rememberSelection: false,
    });
  });

  it("offers native app fallback when no compatible Sambee viewer exists", () => {
    const onConfirm = vi.fn();

    render(
      <BrowserViewerPicker
        open={true}
        fileName="archive.bin"
        viewerIds={["image", "markdown", "pdf"]}
        compatibleViewerIds={[]}
        preferredViewerId={null}
        showNativeOption={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText("Open in native app")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Open in native app"));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(onConfirm).toHaveBeenCalledWith({
      viewerId: null,
      rememberSelection: false,
    });
  });
});
