import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "../../i18n";
import type { NativeApp } from "../../types";
import { AppPicker } from "../AppPicker";

const { invokeMock, openDialogMock, getPreferredAppMock, setPreferredAppMock, setSizeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openDialogMock: vi.fn(),
  getPreferredAppMock: vi.fn(),
  setPreferredAppMock: vi.fn(),
  setSizeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openDialogMock,
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class {
    width: number;
    height: number;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setSize: setSizeMock,
  }),
}));

vi.mock("../../stores/appPreferences", () => ({
  getPreferredApp: getPreferredAppMock,
  setPreferredApp: setPreferredAppMock,
}));

describe("AppPicker", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openDialogMock.mockReset();
    getPreferredAppMock.mockReset();
    setPreferredAppMock.mockReset();
    setSizeMock.mockReset();
  });

  afterEach(async () => {
    await setLocale("en");
  });

  it("renders translated picker chrome and opens the selected app", async () => {
    await setLocale("en-XA");

    const apps: NativeApp[] = [
      {
        name: "LibreOffice Writer",
        executable: "/usr/bin/libreoffice",
        icon: null,
        is_default: true,
      },
    ];

    invokeMock.mockResolvedValue(apps);
    getPreferredAppMock.mockResolvedValue(null);

    const onSelect = vi.fn();
    const onCancel = vi.fn();

    render(<AppPicker extension="docx" onSelect={onSelect} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "[Ćħóóšé åń åṕṕ ťó óṕéń ťħíš .docx ƒíĺé]" })).toBeInTheDocument();
    });

    expect(screen.getByText("[Ɓŕóŵšé ƒóŕ åńóťħéŕ åṕṕ…]")).toBeInTheDocument();
    expect(screen.getByText("[Ćåńćéĺ]")).toBeInTheDocument();
    expect(screen.getByText("[Óṕéń]")).toBeInTheDocument();
    expect(screen.getByText(`LibreOffice Writer ${translate("appPicker.defaultBadge")}`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "[Óṕéń]" }));

    expect(onSelect).toHaveBeenCalledWith(apps[0], false);
  });
});
