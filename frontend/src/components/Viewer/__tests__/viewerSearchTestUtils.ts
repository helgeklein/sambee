import { fireEvent, screen, waitFor } from "@testing-library/react";

interface EscapeClosesViewerSearchOptions {
  searchTerm: string;
  assertViewerStillOpen?: () => void;
}

interface FirstViewerSearchMatchOptions {
  searchTerm: string;
  expectedCounterText: string;
  assertCurrentMatchActive?: () => void;
}

interface RefinedViewerSearchMatchOptions {
  refinedSearchTerm: string;
  expectedCounterText: string;
  assertCurrentMatchActive?: () => void;
}

interface CreateViewerSearchTestDriverOptions {
  assertCurrentMatchActive?: () => void;
}

export async function openViewerSearch(searchTerm?: string): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  const searchInput = await screen.findByPlaceholderText("Search");
  if (searchTerm !== undefined) {
    fireEvent.change(searchInput, { target: { value: searchTerm } });
  }

  return searchInput;
}

export async function expectEscapeClosesViewerSearch({
  searchTerm,
  assertViewerStillOpen,
}: EscapeClosesViewerSearchOptions): Promise<void> {
  const searchInput = await openViewerSearch(searchTerm);
  fireEvent.keyDown(searchInput, { key: "Escape" });

  await waitFor(() => {
    expect(screen.queryByPlaceholderText("Search")).not.toBeInTheDocument();
  });

  assertViewerStillOpen?.();
}

export async function expectFirstViewerSearchMatchActive({
  searchTerm,
  expectedCounterText,
  assertCurrentMatchActive,
}: FirstViewerSearchMatchOptions): Promise<void> {
  await openViewerSearch(searchTerm);

  await waitFor(() => {
    expect(screen.getByText(expectedCounterText)).toBeInTheDocument();
    assertCurrentMatchActive?.();
  });
}

export async function expectRefinedViewerSearchKeepsCurrentMatchActive({
  refinedSearchTerm,
  expectedCounterText,
  assertCurrentMatchActive,
}: RefinedViewerSearchMatchOptions): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: refinedSearchTerm } });

  await waitFor(() => {
    expect(screen.getByText(expectedCounterText)).toBeInTheDocument();
    assertCurrentMatchActive?.();
  });
}

export function createViewerSearchTestDriver({ assertCurrentMatchActive }: CreateViewerSearchTestDriverOptions = {}) {
  return {
    openSearch: openViewerSearch,
    expectEscapeClosesSearch: expectEscapeClosesViewerSearch,
    expectFirstMatchActive: ({ searchTerm, expectedCounterText }: Omit<FirstViewerSearchMatchOptions, "assertCurrentMatchActive">) =>
      expectFirstViewerSearchMatchActive({
        searchTerm,
        expectedCounterText,
        assertCurrentMatchActive,
      }),
    expectRefinedSearchKeepsCurrentMatchActive: ({
      refinedSearchTerm,
      expectedCounterText,
    }: Omit<RefinedViewerSearchMatchOptions, "assertCurrentMatchActive">) =>
      expectRefinedViewerSearchKeepsCurrentMatchActive({
        refinedSearchTerm,
        expectedCounterText,
        assertCurrentMatchActive,
      }),
  };
}
