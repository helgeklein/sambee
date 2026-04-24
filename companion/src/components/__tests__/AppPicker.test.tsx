import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "../../i18n";
import type { NativeApp } from "../../types";
import { AppPicker, AppPickerView } from "../AppPicker";

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
    cleanup();
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
        is_recommended: true,
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

    expect(screen.getByText(translate("appPicker.chooseAnotherApp"))).toBeInTheDocument();
    expect(screen.getByText("[Ćåńćéĺ]")).toBeInTheDocument();
    expect(screen.getByText("[Óṕéń]")).toBeInTheDocument();
    expect(screen.getByText("LibreOffice Writer")).toBeInTheDocument();

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
        is_recommended: true,
      },
      {
        name: "LibreOffice Calc",
        executable: "C:/Program Files/LibreOffice/program/scalc.exe",
        icon: null,
        is_default: false,
        is_recommended: true,
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

  it("moves focus to the listbox after apps finish loading", async () => {
    await setLocale("en");

    const apps: NativeApp[] = [
      {
        name: "Excel",
        executable: "C:/Program Files/Microsoft Office/root/Office16/EXCEL.EXE",
        icon: null,
        is_default: true,
        is_recommended: true,
      },
    ];

    invokeMock.mockResolvedValue(apps);
    getPreferredAppMock.mockResolvedValue(null);

    render(<AppPicker extension="xlsx" onSelect={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toHaveFocus();
    });
  });

  it("cancels on Escape", async () => {
    await setLocale("en");

    const onCancel = vi.fn();

    render(
      <AppPickerView
        extension="txt"
        state={{
          kind: "loaded",
          apps: [
            {
              name: "Notepad",
              executable: "C:/Windows/notepad.exe",
              icon: null,
              is_default: true,
              is_recommended: true,
            },
          ],
        }}
        selectedIndex={0}
        alwaysUse={false}
        onSelectIndex={vi.fn()}
        onAlwaysUseChange={vi.fn()}
        onOpen={vi.fn()}
        onCancel={onCancel}
        onBrowse={vi.fn()}
      />
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("moves the selected item by a page on Page Up and Page Down", async () => {
    await setLocale("en");

    const onSelectIndex = vi.fn();

    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("app-picker__list")) {
        return 180;
      }

      return 0;
    });

    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("app-picker__item")) {
        return 60;
      }

      return 0;
    });

    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      if (this.id === "app-picker-item-0") {
        return 0;
      }
      if (this.id === "app-picker-item-1") {
        return 60;
      }
      if (this.id === "app-picker-item-2") {
        return 150;
      }
      if (this.id === "app-picker-item-3") {
        return 210;
      }
      if (this.id === "app-picker-item-4") {
        return 270;
      }
      if (this.id === "app-picker-item-browse") {
        return 330;
      }

      return 0;
    });

    render(
      <AppPickerView
        extension="txt"
        state={{
          kind: "loaded",
          apps: [
            {
              name: "Notepad",
              executable: "C:/Windows/notepad.exe",
              icon: null,
              is_default: true,
              is_recommended: true,
            },
            {
              name: "WordPad",
              executable: "C:/Program Files/Windows NT/Accessories/wordpad.exe",
              icon: null,
              is_default: false,
              is_recommended: true,
            },
            {
              name: "VS Code",
              executable: "C:/Users/demo/AppData/Local/Programs/Microsoft VS Code/Code.exe",
              icon: null,
              is_default: false,
              is_recommended: true,
            },
            {
              name: "LibreOffice Writer",
              executable: "C:/Program Files/LibreOffice/program/swriter.exe",
              icon: null,
              is_default: false,
              is_recommended: true,
            },
            {
              name: "OpenOffice",
              executable: "C:/Program Files/OpenOffice 4/program/soffice.exe",
              icon: null,
              is_default: false,
              is_recommended: false,
            },
          ],
        }}
        selectedIndex={1}
        alwaysUse={false}
        onSelectIndex={onSelectIndex}
        onAlwaysUseChange={vi.fn()}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
        onBrowse={vi.fn()}
      />
    );

    const listbox = screen.getByRole("listbox");

    fireEvent.keyDown(listbox, { key: "PageDown" });
    fireEvent.keyDown(listbox, { key: "PageUp" });

    expect(onSelectIndex).toHaveBeenNthCalledWith(1, 3);
    expect(onSelectIndex).toHaveBeenNthCalledWith(2, 0);
  });

  it("renders non-recommended apps under More options", async () => {
    await setLocale("en");

    const apps: NativeApp[] = [
      {
        name: "Excel",
        executable: "C:/Program Files/Microsoft Office/root/Office16/EXCEL.EXE",
        icon: null,
        is_default: true,
        is_recommended: true,
      },
      {
        name: "LibreOffice Calc",
        executable: "C:/Program Files/LibreOffice/program/scalc.exe",
        icon: null,
        is_default: false,
        is_recommended: true,
      },
      {
        name: "CSV Toolkit",
        executable: "C:/Tools/csv-toolkit.exe",
        icon: null,
        is_default: false,
        is_recommended: false,
      },
    ];

    render(
      <AppPickerView
        extension="csv"
        state={{ kind: "loaded", apps }}
        selectedIndex={0}
        alwaysUse={false}
        onSelectIndex={vi.fn()}
        onAlwaysUseChange={vi.fn()}
        onOpen={vi.fn()}
        onCancel={vi.fn()}
        onBrowse={vi.fn()}
      />
    );

    expect(screen.getByText(translate("appPicker.sectionSuggested"))).toBeInTheDocument();
    expect(screen.getByText(translate("appPicker.sectionMoreOptions"))).toBeInTheDocument();
    expect(screen.getByText("LibreOffice Calc")).toBeInTheDocument();
    expect(screen.getByText("CSV Toolkit")).toBeInTheDocument();
  });
});
