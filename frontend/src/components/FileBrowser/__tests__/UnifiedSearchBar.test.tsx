import { render, screen, waitFor } from "@testing-library/react";
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

const filterProvider: SearchProvider = {
  id: "filter-provider",
  modeId: "filter",
  modeLabel: "Filter",
  placeholder: "Filter current directory",
  debounceMs: 0,
  minQueryLength: 0,
  fetchResults: async () => [],
  onSelect: () => undefined,
  getStatusInfo: () => null,
};

const resultsProvider: SearchProvider = {
  id: "results-provider",
  modeId: "navigate",
  modeLabel: "Navigate",
  placeholder: "Search",
  debounceMs: 0,
  minQueryLength: 0,
  fetchResults: async () => [
    {
      id: "folder-1",
      value: "/docs",
      display: "Docs",
    },
  ],
  onSelect: () => undefined,
  getStatusInfo: () => null,
};

const modeOptions = [
  {
    id: "navigate",
    label: "Navigate",
    onSelect: vi.fn(),
  },
  {
    id: "filter",
    label: "Filter",
    onSelect: vi.fn(),
  },
  {
    id: "commands",
    label: "Commands",
    onSelect: vi.fn(),
  },
];

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

  it("closes the dropdown when tab moves focus away", async () => {
    const user = userEvent.setup();

    renderWithProvider(
      <>
        <UnifiedSearchBar provider={resultsProvider} />
        <button type="button">Next focus target</button>
      </>
    );

    const searchInput = screen.getByRole("textbox");
    await user.click(searchInput);

    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    await user.tab();

    expect(screen.getByRole("button", { name: "Next focus target" })).toHaveFocus();
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("returns focus to the quick-bar input when Escape is pressed on the mode button", async () => {
    const user = userEvent.setup();

    renderWithProvider(<UnifiedSearchBar provider={noResultsProvider} modeOptions={modeOptions} />);

    const searchInput = screen.getByRole("textbox");
    const modeButton = screen.getByRole("button", { name: "Switch quick bar mode" });

    modeButton.focus();
    expect(modeButton).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(searchInput).toHaveFocus();
    });
  });

  it("supports arrow navigation in the mode menu after clicking from filter mode with typed input", async () => {
    const user = userEvent.setup();

    renderWithProvider(<UnifiedSearchBar provider={filterProvider} modeOptions={modeOptions} disableDropdown={true} />);

    const searchInput = screen.getByRole("textbox");
    const modeButton = screen.getByRole("button", { name: "Switch quick bar mode" });

    await user.click(searchInput);
    await user.type(searchInput, "s");
    await user.click(modeButton);

    await screen.findByRole("menuitem", { name: "Filter" });

    await user.keyboard("{ArrowDown}");

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Commands" })).toHaveFocus();
    });

    await user.keyboard("{ArrowUp}");

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Filter" })).toHaveFocus();
    });
  });

  it("closes the quick-bar dropdown when clicking the mode button to open the mode menu", async () => {
    const user = userEvent.setup();

    renderWithProvider(<UnifiedSearchBar provider={resultsProvider} modeOptions={modeOptions} />);

    const searchInput = screen.getByRole("textbox");
    const modeButton = screen.getByRole("button", { name: "Switch quick bar mode" });

    await user.click(searchInput);

    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    await user.click(modeButton);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it("supports arrow navigation in the mode menu after opening with Space from the focused mode button", async () => {
    const user = userEvent.setup();

    renderWithProvider(<UnifiedSearchBar provider={filterProvider} modeOptions={modeOptions} disableDropdown={true} />);

    const modeButton = screen.getByRole("button", { name: "Switch quick bar mode" });
    modeButton.focus();

    await user.keyboard("{Space}");

    await screen.findByRole("menuitem", { name: "Filter" });

    await user.keyboard("{ArrowDown}");

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Commands" })).toHaveFocus();
    });

    await user.keyboard("{ArrowUp}");

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Filter" })).toHaveFocus();
    });
  });

  it("opens the mode menu with ArrowDown from the focused mode button", async () => {
    const user = userEvent.setup();

    renderWithProvider(<UnifiedSearchBar provider={filterProvider} modeOptions={modeOptions} disableDropdown={true} />);

    const modeButton = screen.getByRole("button", { name: "Switch quick bar mode" });
    modeButton.focus();

    await user.keyboard("{ArrowDown}");

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Filter" })).toHaveFocus();
    });

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
