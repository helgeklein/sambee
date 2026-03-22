import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../../i18n";
import { SambeeThemeProvider } from "../../../theme/ThemeContext";
import { MobileToolbar } from "../MobileToolbar";

function renderWithProvider(component: React.ReactElement) {
  return render(<SambeeThemeProvider>{component}</SambeeThemeProvider>);
}

describe("MobileToolbar", () => {
  afterEach(async () => {
    await setLocale("en");
  });

  it("uses translated mobile toolbar labels", async () => {
    await setLocale("en-XA");

    renderWithProvider(<MobileToolbar currentDirectoryName="Documents" onOpenMenu={vi.fn()} onNavigateUp={vi.fn()} canNavigateUp={true} />);

    expect(screen.getByRole("button", { name: "[Óṕéń ḿéńú]" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "[Ńåṽíğåťé ťó ṕåŕéńť ďíŕéćťóŕý]" })).toBeInTheDocument();
  });
});
