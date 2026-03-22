import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale, translate } from "../../../i18n";
import { SambeeThemeProvider } from "../../../theme/ThemeContext";
import type { SearchProvider } from "../search/types";
import { UnifiedSearchBar } from "../UnifiedSearchBar";

const testProvider: SearchProvider = {
  id: "test-provider",
  placeholder: "Search",
  debounceMs: 0,
  minQueryLength: 0,
  fetchResults: async () => [],
  onSelect: () => undefined,
  getStatusInfo: () => null,
};

const noResultsProvider: SearchProvider = {
  id: "no-results-provider",
  modeId: "navigate",
  modeLabel: "Navigate",
  placeholder: "Search",
  debounceMs: 0,
  minQueryLength: 0,
  fetchResults: async () => [],
  onSelect: () => undefined,
  getStatusInfo: () => null,
};

function renderWithProvider(component: React.ReactElement) {
  return render(<SambeeThemeProvider>{component}</SambeeThemeProvider>);
}

describe("UnifiedSearchBar", () => {
  afterEach(async () => {
    await setLocale("en");
  });

  it("uses translated clear-search aria label", async () => {
    const user = userEvent.setup();
    const onQueryValueChange = vi.fn();
    await setLocale("en-XA");

    renderWithProvider(
      <UnifiedSearchBar provider={testProvider} queryValue="abc" onQueryValueChange={onQueryValueChange} disableDropdown={true} />
    );

    const clearButton = screen.getByRole("button", { name: "[Ćĺéåŕ šéåŕćħ]" });
    expect(clearButton).toBeInTheDocument();

    await user.click(clearButton);

    expect(onQueryValueChange).toHaveBeenCalledWith("");
  });

  it("uses translated no-results copy", async () => {
    const user = userEvent.setup();
    await setLocale("en-XA");

    renderWithProvider(<UnifiedSearchBar provider={noResultsProvider} />);

    const searchInput = screen.getByRole("textbox");
    await user.click(searchInput);
    await user.type(searchInput, "abc");

    expect(screen.getByText(translate("fileBrowser.search.results.none", { query: "abc" }))).toBeInTheDocument();
  });
});
