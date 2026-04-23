import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "../../i18n";
import type { NativeApp } from "../../types";
import { AppPicker } from "../AppPicker";

const APP_PICKER_ROUNDING_BUFFER = 1;

const { invokeMock, openDialogMock, getPreferredAppMock, setPreferredAppMock, setSizeMock, scaleFactorMock, onScaleChangedMock } =
  vi.hoisted(() => ({
    invokeMock: vi.fn(),
    openDialogMock: vi.fn(),
    getPreferredAppMock: vi.fn(),
    setPreferredAppMock: vi.fn(),
    setSizeMock: vi.fn(),
    scaleFactorMock: vi.fn(),
    onScaleChangedMock: vi.fn(),
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
    onScaleChanged: onScaleChangedMock,
    scaleFactor: scaleFactorMock,
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
    scaleFactorMock.mockReset();
    onScaleChangedMock.mockReset();
    scaleFactorMock.mockResolvedValue(1);
    onScaleChangedMock.mockResolvedValue(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it("resizes to the picker panel's intrinsic height when the visible box is clipped", async () => {
    await setLocale("en");

    const apps: NativeApp[] = [
      {
        name: "Excel",
        executable: "C:/Program Files/Microsoft Office/root/Office16/EXCEL.EXE",
        icon: null,
        is_default: true,
      },
      {
        name: "LibreOffice Calc",
        executable: "C:/Program Files/LibreOffice/program/scalc.exe",
        icon: null,
        is_default: false,
      },
    ];

    invokeMock.mockResolvedValue(apps);
    getPreferredAppMock.mockResolvedValue(null);

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("app-picker")) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 420,
          bottom: 320,
          width: 420,
          height: 320,
          toJSON: () => ({}),
        };
      }

      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      };
    });

    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("app-picker")) {
        return 472;
      }

      return 0;
    });

    vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element) => {
      if (element instanceof HTMLElement && element.classList.contains("app-picker")) {
        return {
          borderTopWidth: "1px",
          borderBottomWidth: "1px",
        } as CSSStyleDeclaration;
      }

      return {
        borderTopWidth: "0px",
        borderBottomWidth: "0px",
      } as CSSStyleDeclaration;
    });

    render(<AppPicker extension="xlsx" onSelect={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(setSizeMock).toHaveBeenCalled();
    });

    const resizedHeights = setSizeMock.mock.calls.map(([size]) => size.height);
    expect(Math.max(...resizedHeights)).toBe(472 + 2 + APP_PICKER_ROUNDING_BUFFER);
  });
});
