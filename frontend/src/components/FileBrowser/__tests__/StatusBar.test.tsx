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

    renderWithProvider(<StatusBar files={[baseFile]} focusedIndex={5} />);

    expect(screen.getByText("[Ńó šéĺéćťíóń]")).toBeInTheDocument();
    expect(screen.getByText("[1 íťéḿ]")).toBeInTheDocument();
  });

  it("uses translated filter summary", async () => {
    await setLocale("en-XA");

    renderWithProvider(
      <StatusBar files={[baseFile, { ...baseFile, name: "report.pdf", path: "/report.pdf" }]} focusedIndex={0} activeFilter="pdf" />
    );

    expect(screen.getByText("[Ƒíĺťéŕéď ƀý: pdf]")).toBeInTheDocument();
    expect(screen.getByText("[2 íťéḿš]")).toBeInTheDocument();
  });
});
