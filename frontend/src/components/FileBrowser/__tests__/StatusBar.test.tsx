import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../../../i18n";
import { SambeeThemeProvider } from "../../../theme/ThemeContext";
import type { FileEntry } from "../../../types";
import { StatusBar } from "../StatusBar";

const baseFile: FileEntry = {
  name: "notes.txt",
  path: "/notes.txt",
  type: "file",
  size: 1024,
  modified_at: null,
  is_readable: true,
  is_hidden: false,
};

function renderWithProvider(component: React.ReactElement) {
  return render(<SambeeThemeProvider>{component}</SambeeThemeProvider>);
}

describe("StatusBar", () => {
  afterEach(async () => {
    await setLocale("en");
  });

  it("uses translated empty selection and count strings", async () => {
    await setLocale("en-XA");

    renderWithProvider(<StatusBar files={[baseFile]} focusedIndex={5} canResolveShortcutTargets={false} />);

    expect(screen.getByText("[Ńó šéĺéćťíóń]")).toBeInTheDocument();
    expect(screen.getByText("[1 íťéḿ]")).toBeInTheDocument();
  });

  it("reports a missing shortcut target for the selected item", () => {
    renderWithProvider(
      <StatusBar
        files={[
          {
            ...baseFile,
            link_kind: "windows_shortcut",
            link_target: {
              source_path: "notes.txt.lnk",
              state: "missing",
            },
          },
        ]}
        focusedIndex={0}
        canResolveShortcutTargets
      />
    );

    expect(screen.getByText("Shortcut target not found")).toBeInTheDocument();
  });

  it("reports an unresolved shortcut extension for the selected item", () => {
    renderWithProvider(<StatusBar files={[{ ...baseFile, name: "My Drive.lnk" }]} focusedIndex={0} canResolveShortcutTargets={false} />);

    expect(screen.getByText("Shortcut targets can only be resolved on local drives")).toBeInTheDocument();
  });

  it("reports a Companion unresolvable target independently of connection type", () => {
    renderWithProvider(
      <StatusBar
        files={[
          {
            ...baseFile,
            name: "Broken.lnk",
            link_kind: "windows_shortcut",
            link_target: {
              source_path: "Broken.lnk",
              state: "unresolvable",
            },
          },
        ]}
        focusedIndex={0}
        canResolveShortcutTargets
      />
    );

    expect(screen.getByText("Shortcut target cannot be resolved")).toBeInTheDocument();
  });
});
