//
// Search Provider Types
//

/**
 * Modular Search Provider Interface
 * ==================================
 *
 * Defines the contract for pluggable search functionality in the unified
 * search bar. Different providers can implement this interface to supply
 * domain-specific search results (e.g., directory navigation, file search).
 *
 * Each provider controls:
 * - How search queries are executed (fetchResults)
 * - What happens when a result is selected (onSelect)
 * - How results are rendered (renderResult)
 * - Placeholder text and status indicators
 */

import type React from "react";

// ============================================================================
// Constants
// ============================================================================

/** Shared placeholder text for directory search inputs */
export const DIRECTORY_SEARCH_PLACEHOLDER = "Search directories...";

// ============================================================================
// Result types
// ============================================================================

/** A single search result returned by a provider */
export interface SearchResult {
  /** Unique identifier for the result */
  id: string;
  /** The raw value passed to onSelect when chosen */
  value: string;
  /** React element to render for this result row */
  display: React.ReactNode;
}

/** Status information from the provider (e.g., indexing progress) */
export interface SearchStatusInfo {
  /** Short text label describing current status */
  label: string;
  /** Whether an activity spinner should be shown */
  showSpinner: boolean;
}

// ============================================================================
// Provider interface
// ============================================================================

export interface SearchProvider {
  /** Unique identifier for this provider */
  id: string;

  /** Placeholder text shown in the search input */
  placeholder: string;

  /** Debounce delay in milliseconds for search input */
  debounceMs: number;

  /** Minimum query length to trigger a search (0 = search on empty string) */
  minQueryLength: number;

  /**
   * Fetch results for a given query.
   * @param query The search string
   * @param signal AbortSignal for cancellation
   * @returns Array of search results
   */
  fetchResults: (query: string, signal: AbortSignal) => Promise<SearchResult[]>;

  /**
   * Called when a result is selected (via click or Enter).
   * @param value The value of the selected result
   */
  onSelect: (value: string) => void;

  /**
   * Optional status info to display (e.g., "Indexing... 42 directories found").
   * Return null to hide the status bar.
   */
  getStatusInfo: () => SearchStatusInfo | null;

  /**
   * Called when the search bar gains focus or becomes active.
   * Providers can use this to warm up caches or prefetch data.
   */
  onActivate?: () => void;

  /**
   * Called when the search bar is dismissed.
   * Providers can use this to cancel in-flight requests or reset state.
   */
  onDeactivate?: () => void;

  /** Hint content shown in the footer (e.g., keyboard shortcuts). Supports ReactNode for rich formatting. */
  footerHint?: React.ReactNode;

  /** Optional: dynamic footer info based on result count (e.g., "5 results") */
  footerInfo?: (resultCount: number) => string | undefined;

  /** Optional keyboard shortcut hint shown inside the search input (e.g., "Ctrl+K") */
  shortcutHint?: string;

  /**
   * Optional message shown when query is non-empty but below minQueryLength.
   * E.g., "Type at least 2 characters to search"
   */
  belowMinimumMessage?: string;
}
