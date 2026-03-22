//
// UnifiedSearchBar
//

/**
 * Unified Search Bar Component
 * =============================
 *
 * A modular search bar that accepts a SearchProvider to deliver
 * pluggable search functionality. Renders inline in the header
 * (or mobile sticky area) with a dropdown results panel.
 *
 * Features:
 * - Debounced input driven by the provider's debounceMs
 * - Keyboard navigation: Up/Down/Enter/Escape
 * - Click selection on results
 * - Provider status indicator (e.g., "Indexing...")
 * - Footer hints and info from the provider
 * - Activates provider on focus, deactivates on dismiss
 * - Responsive: works in both desktop header and mobile sticky bar
 */

import ClearIcon from "@mui/icons-material/Clear";
import {
  Box,
  CircularProgress,
  ClickAwayListener,
  IconButton,
  InputAdornment,
  ListItemButton,
  Paper,
  Popper,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SearchProvider, SearchResult, SearchSelectionBehavior } from "./search/types";

// ============================================================================
// Constants
// ============================================================================

/** Maximum visible results before the list scrolls */
const MAX_VISIBLE_RESULTS = 10;

/** Height of each result row in pixels (accommodates two-line smart display) */
const RESULT_ROW_HEIGHT = 56;

/** Desired dropdown width in pixels (static per viewport) */
const DROPDOWN_WIDTH_PX = 700;

/** Number of items to jump with Page Up/Down */
const PAGE_JUMP_SIZE = 10;

/** The default quick-bar mode should read as the baseline, not a tagged variant. */
const DEFAULT_MODE_ID = "navigate";

/** Preserve touch comfort on mobile while tightening desktop density slightly. */
const MOBILE_INPUT_PADDING = "10px 14px";
const DESKTOP_INPUT_PADDING = "7.5px 12px";

// ============================================================================
// Props
// ============================================================================

interface UnifiedSearchBarProps {
  /** The search provider supplying results and behavior */
  provider: SearchProvider;
  /** Increments whenever the quick bar is explicitly reopened and should reset transient state. */
  activationToken?: number;
  /** Ref forwarded to the underlying <input> element */
  inputRef?: React.RefObject<HTMLInputElement>;
  /** Remove from Tab order (dual-pane mode uses Tab for pane switching) */
  disableTabFocus?: boolean;
  /** Whether to use compact (mobile) layout styling */
  useCompactLayout?: boolean;
  /** Called when Escape is pressed with an empty query and closed dropdown */
  onBlurToFileList?: () => void;
  /** Controlled query value for modes that should persist outside the search bar. */
  queryValue?: string;
  /** Controlled query change handler. */
  onQueryValueChange?: (value: string) => void;
  /** Disable dropdown search behavior and use the input as a plain filter box. */
  disableDropdown?: boolean;
  /** Called when ArrowDown should hand focus from the input to the file list. */
  onArrowDownToFileList?: () => void;
}

// ============================================================================
// Component
// ============================================================================

//
// UnifiedSearchBar
//
export function UnifiedSearchBar({
  provider,
  activationToken = 0,
  inputRef,
  useCompactLayout = false,
  onBlurToFileList,
  queryValue,
  onQueryValueChange,
  disableDropdown = false,
  onArrowDownToFileList,
  disableTabFocus,
}: UnifiedSearchBarProps) {
  // ── State ──────────────────────────────────────────────────────────────
  const [internalQuery, setInternalQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isSearchPending, setIsSearchPending] = useState(false);

  const theme = useTheme();
  const { t } = useTranslation();

  // ── Refs ───────────────────────────────────────────────────────────────
  const anchorRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingQueryRef = useRef<string>("");
  const providerRef = useRef(provider);
  const internalInputRef = useRef<HTMLInputElement>(null);
  const activatedRef = useRef(false);
  const lastResetProviderRef = useRef(provider);
  const lastActivationTokenRef = useRef(activationToken);

  // Always keep providerRef current so stable callbacks use the latest provider
  providerRef.current = provider;

  const isControlledQuery = queryValue !== undefined;
  const query = isControlledQuery ? queryValue : internalQuery;

  const setQuery = useCallback(
    (value: string) => {
      providerRef.current.onQueryChange?.(value);

      if (isControlledQuery) {
        onQueryValueChange?.(value);
        return;
      }

      setInternalQuery(value);
    },
    [isControlledQuery, onQueryValueChange]
  );

  // Use external inputRef if provided, otherwise internal
  const effectiveInputRef = inputRef ?? internalInputRef;

  const getEffectiveMinQueryLength = useCallback(
    (value: string) => provider.getMinQueryLength?.(value) ?? provider.minQueryLength,
    [provider]
  );

  const getEffectiveBelowMinimumMessage = useCallback(
    (value: string) => provider.getBelowMinimumMessage?.(value) ?? provider.belowMinimumMessage,
    [provider]
  );

  // ── Keyboard shortcut badge (memoized) ─────────────────────────────────
  const kbdBadge = useMemo(() => {
    if (!provider.shortcutHint || useCompactLayout) return null;
    return (
      <Box
        component="kbd"
        aria-hidden="true"
        sx={{
          display: "inline-block",
          fontFamily: "inherit",
          fontSize: "0.7rem",
          lineHeight: 1,
          px: 0.75,
          py: 0.3,
          borderRadius: 0.5,
          border: 1,
          borderColor: "divider",
          color: "text.disabled",
          backgroundColor: theme.palette.mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        {provider.shortcutHint}
      </Box>
    );
  }, [provider.shortcutHint, useCompactLayout, theme.palette.mode]);

  const shouldShowModeBadge = !!provider.modeLabel && provider.modeId !== DEFAULT_MODE_ID && query.length === 0;

  const modeBadge = useMemo(() => {
    if (!provider.modeLabel || !shouldShowModeBadge) return null;

    return (
      <Box
        aria-hidden="true"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          px: 0.75,
          py: 0.25,
          borderRadius: 999,
          backgroundColor: "action.selected",
          color: "text.secondary",
          fontSize: "0.7rem",
          fontWeight: 600,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
          mr: 0,
        }}
      >
        {provider.modeLabel}
      </Box>
    );
  }, [provider.modeLabel, shouldShowModeBadge]);

  const startAdornment = useMemo(() => {
    if (!modeBadge) {
      return undefined;
    }

    return (
      <InputAdornment
        position="start"
        sx={{
          ml: 0,
          mr: 0.75,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
        }}
      >
        {modeBadge}
      </InputAdornment>
    );
  }, [modeBadge]);

  const endAdornment = useMemo(() => {
    const showShortcutBadge = !query && !isFocused && !!kbdBadge;

    if (!query && !isLoading && !showShortcutBadge) {
      return undefined;
    }

    return (
      <InputAdornment position="end">
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          {isLoading ? <CircularProgress size={18} /> : null}
          {query ? (
            <IconButton
              size="small"
              onClick={() => {
                setQuery("");
                setResults([]);
                setIsDropdownOpen(false);
                setHasSearched(false);
                effectiveInputRef.current?.focus();
              }}
              edge="end"
              sx={{
                minWidth: { xs: 44, sm: "auto" },
                minHeight: { xs: 44, sm: "auto" },
              }}
              aria-label={t("common.search.clear")}
            >
              <ClearIcon fontSize={useCompactLayout ? "medium" : "small"} />
            </IconButton>
          ) : showShortcutBadge ? (
            kbdBadge
          ) : null}
        </Box>
      </InputAdornment>
    );
  }, [effectiveInputRef, isFocused, isLoading, kbdBadge, query, setQuery, t, useCompactLayout]);

  // ── Search execution ───────────────────────────────────────────────────

  //
  // executeSearch
  //
  const executeSearch = useCallback(
    async (searchQuery: string) => {
      // Cancel any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        setIsSearchPending(false);
        setIsLoading(true);
        const fetchedResults = await providerRef.current.fetchResults(searchQuery, controller.signal);

        if (!controller.signal.aborted) {
          setResults(fetchedResults);
          setSelectedIndex(0);
          setHasSearched(true);
          setIsDropdownOpen(true);
        }
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    // providerRef is stable — no dependency on provider object identity
    []
  );

  // ── Input handling ─────────────────────────────────────────────────────

  //
  // handleInputChange
  //
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newQuery = e.target.value;
      const effectiveMinQueryLength = getEffectiveMinQueryLength(newQuery);
      const effectiveBelowMinimumMessage = getEffectiveBelowMinimumMessage(newQuery);

      setQuery(newQuery);

      if (disableDropdown) {
        setResults([]);
        setSelectedIndex(0);
        setHasSearched(false);
        setIsDropdownOpen(false);
        setIsSearchPending(false);
        return;
      }

      // Clear previous debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (newQuery.length >= effectiveMinQueryLength) {
        setIsSearchPending(true);
        pendingQueryRef.current = newQuery;
        debounceTimerRef.current = setTimeout(() => {
          executeSearch(pendingQueryRef.current);
        }, provider.debounceMs);
      } else {
        setIsSearchPending(false);
        setResults([]);
        setSelectedIndex(0);
        setHasSearched(false);
        if (newQuery.length === 0) {
          setIsDropdownOpen(false);
        } else if (effectiveBelowMinimumMessage) {
          // Show hint when query is non-empty but below minimum length
          setIsDropdownOpen(true);
        }
      }
    },
    [disableDropdown, provider.debounceMs, executeSearch, getEffectiveBelowMinimumMessage, getEffectiveMinQueryLength, setQuery]
  );

  // ── Selection handling ─────────────────────────────────────────────────

  //
  // handleSelect
  //
  const handleSelect = useCallback(
    (value: string) => {
      const selectionBehavior: SearchSelectionBehavior | undefined = providerRef.current.onSelect(value);
      setQuery("");
      setResults([]);
      setIsDropdownOpen(false);
      setHasSearched(false);

      const focusTarget = selectionBehavior?.focusTarget ?? "file-list";

      if (focusTarget === "quick-bar") {
        setTimeout(() => {
          effectiveInputRef.current?.focus();
          effectiveInputRef.current?.select();
        }, 0);
        return;
      }

      if (focusTarget === "file-list" && onBlurToFileList) {
        onBlurToFileList();
      }
    },
    [effectiveInputRef, onBlurToFileList, setQuery]
  );

  // ── Keyboard navigation ────────────────────────────────────────────────

  //
  // handleKeyDown
  //
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          if (disableDropdown) {
            if (onArrowDownToFileList) {
              e.preventDefault();
              onArrowDownToFileList();
            }
            break;
          }
          if (isDropdownOpen && results.length > 0) {
            e.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          }
          break;

        case "ArrowUp":
          if (disableDropdown) {
            break;
          }
          if (isDropdownOpen && results.length > 0) {
            e.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
          }
          break;

        case "PageDown":
          if (disableDropdown) {
            break;
          }
          if (isDropdownOpen && results.length > 0) {
            e.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + PAGE_JUMP_SIZE, results.length - 1));
          }
          break;

        case "PageUp":
          if (disableDropdown) {
            break;
          }
          if (isDropdownOpen && results.length > 0) {
            e.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - PAGE_JUMP_SIZE, 0));
          }
          break;

        case "Enter":
          if (disableDropdown) {
            break;
          }
          if (isDropdownOpen && results[selectedIndex]) {
            e.preventDefault();
            handleSelect(results[selectedIndex].value);
          }
          break;

        case "Escape":
          e.preventDefault();
          if (disableDropdown) {
            if (query) {
              setQuery("");
              setResults([]);
              setHasSearched(false);
              setIsDropdownOpen(false);
            } else if (onBlurToFileList) {
              onBlurToFileList();
            }
            break;
          }
          if (isDropdownOpen) {
            // First Escape: close the dropdown
            setIsDropdownOpen(false);
          } else if (query) {
            // Second Escape: clear the query
            setQuery("");
            setResults([]);
            setHasSearched(false);
          } else if (onBlurToFileList) {
            // Third Escape: blur back to the file list
            onBlurToFileList();
          }
          break;
      }
    },
    [disableDropdown, handleSelect, isDropdownOpen, onArrowDownToFileList, onBlurToFileList, query, results, selectedIndex, setQuery]
  );

  // ── Virtual list for results ───────────────────────────────────────────
  // Use state (not ref) for the scroll element so the virtualizer
  // re-initialises when the container mounts/unmounts.
  const [listContainer, setListContainer] = useState<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => listContainer,
    estimateSize: () => RESULT_ROW_HEIGHT,
    overscan: 5,
  });

  // ── Scroll selected item into view ─────────────────────────────────────
  useEffect(() => {
    if (results.length > 0) {
      rowVirtualizer.scrollToIndex(selectedIndex, { align: "auto" });
    }
  }, [selectedIndex, results.length, rowVirtualizer]);

  // ── Focus activation ───────────────────────────────────────────────────

  //
  // handleFocus
  //
  const handleFocus = useCallback(() => {
    if (!activatedRef.current) {
      activatedRef.current = true;
      providerRef.current.onActivate?.();
    }
  }, []);

  // ── Click-away dismissal ───────────────────────────────────────────────

  //
  // handleClickAway
  //
  const handleClickAway = useCallback(() => {
    setIsDropdownOpen(false);
  }, []);

  // ── Re-open on typing after click-away ─────────────────────────────────
  //
  // handleInputFocus
  //
  const handleInputFocus = useCallback(() => {
    setIsFocused(true);
    handleFocus();

    const effectiveMinQueryLength = getEffectiveMinQueryLength(query);
    const effectiveBelowMinimumMessage = getEffectiveBelowMinimumMessage(query);

    if (disableDropdown) {
      setIsDropdownOpen(false);
      return;
    }

    if (!hasSearched && query.length === 0 && effectiveMinQueryLength === 0) {
      void executeSearch("");
    }

    // Re-open dropdown if there are results to show
    if (results.length > 0 || hasSearched) {
      setIsDropdownOpen(true);
    }

    // Show below-minimum hint if query is non-empty but too short
    if (query.length > 0 && query.length < effectiveMinQueryLength && effectiveBelowMinimumMessage) {
      setIsDropdownOpen(true);
    }
  }, [
    disableDropdown,
    executeSearch,
    getEffectiveBelowMinimumMessage,
    getEffectiveMinQueryLength,
    handleFocus,
    results.length,
    hasSearched,
    query,
  ]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      providerRef.current.onDeactivate?.();
    };
  }, []);

  // ── Reset when provider changes or the quick bar is explicitly reopened ──
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset only on explicit provider identity / activation changes
  useEffect(() => {
    const previousProvider = lastResetProviderRef.current;
    const providerChanged = previousProvider.id !== provider.id;
    const activationChanged = lastActivationTokenRef.current !== activationToken;

    if (!providerChanged && !activationChanged) {
      return;
    }

    previousProvider.onDeactivate?.();

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setResults([]);
    setSelectedIndex(0);
    setIsLoading(false);
    setIsSearchPending(false);
    setIsDropdownOpen(false);
    setHasSearched(false);

    if (!isControlledQuery) {
      setInternalQuery("");
    }

    lastResetProviderRef.current = provider;
    lastActivationTokenRef.current = activationToken;

    const isInputFocused = document.activeElement === effectiveInputRef.current;
    activatedRef.current = isInputFocused;

    if (isInputFocused) {
      providerRef.current.onActivate?.();
    }
  }, [activationToken, effectiveInputRef, isControlledQuery, provider.id]);

  useEffect(() => {
    if (disableDropdown) {
      return;
    }
    if (document.activeElement === effectiveInputRef.current && provider.minQueryLength === 0) {
      void executeSearch("");
    }
  }, [disableDropdown, effectiveInputRef, executeSearch, provider.minQueryLength]);

  // ── Derived state ──────────────────────────────────────────────────────
  const statusInfo = provider.getStatusInfo();
  const effectiveMinQueryLength = getEffectiveMinQueryLength(query);
  const effectiveBelowMinimumMessage = getEffectiveBelowMinimumMessage(query);
  const showNoResults = hasSearched && query.length >= effectiveMinQueryLength && !isLoading && !isSearchPending && results.length === 0;
  const showBelowMinimum = query.length > 0 && query.length < effectiveMinQueryLength && !!effectiveBelowMinimumMessage;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <ClickAwayListener onClickAway={handleClickAway}>
      <Box
        ref={anchorRef}
        sx={{
          position: "relative",
          boxSizing: "border-box",
          mb: useCompactLayout ? 2 : 0,
          mt: useCompactLayout ? { xs: 1, sm: 0 } : 0,
          mx: useCompactLayout ? { xs: 2, sm: 3, md: 4 } : 0,
        }}
      >
        {/* Search input */}
        <Paper
          elevation={2}
          sx={{
            position: useCompactLayout ? "sticky" : "relative",
            top: 0,
            zIndex: 10,
            backgroundColor: useCompactLayout ? "background.paper" : "background.default",
          }}
        >
          <TextField
            fullWidth
            size="small"
            placeholder={provider.placeholder}
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            onBlur={() => setIsFocused(false)}
            inputRef={effectiveInputRef}
            inputProps={disableTabFocus ? { tabIndex: -1 } : undefined}
            sx={{
              "& .MuiInputBase-root": {
                fontSize: { xs: "16px", sm: "14px" },
              },
              "& .MuiInputBase-root.Mui-focused": {
                outline: (theme) => `3px solid ${theme.palette.appBar?.focus}`,
                outlineOffset: "0",
              },
              "& .MuiInputBase-input": {
                padding: { xs: MOBILE_INPUT_PADDING, sm: DESKTOP_INPUT_PADDING },
              },
              "& .MuiOutlinedInput-notchedOutline": {
                border: "none",
              },
              "&:hover .MuiOutlinedInput-notchedOutline": {
                border: "none",
              },
              "& .Mui-focused .MuiOutlinedInput-notchedOutline": {
                border: "none",
              },
            }}
            InputProps={{
              startAdornment,
              endAdornment,
            }}
          />
        </Paper>

        {/* Dropdown results panel */}
        <Popper
          open={
            !disableDropdown &&
            isDropdownOpen &&
            (results.length > 0 || showNoResults || showBelowMinimum || isSearchPending || isLoading || statusInfo !== null)
          }
          anchorEl={anchorRef.current}
          placement="bottom"
          style={{
            width: Math.min(DROPDOWN_WIDTH_PX, window.innerWidth - 16),
            zIndex: 1300,
          }}
          modifiers={[
            {
              name: "offset",
              options: { offset: [0, 4] },
            },
            {
              name: "preventOverflow",
              options: { boundary: "viewport", padding: 8 },
            },
          ]}
        >
          <Paper
            elevation={8}
            sx={{
              borderRadius: 1,
              overflow: "hidden",
              maxWidth: "100%",
            }}
          >
            {/* Status indicator */}
            {statusInfo && (
              <Box
                sx={{
                  px: 2,
                  py: 0.5,
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  borderBottom: results.length > 0 || showNoResults ? 1 : 0,
                  borderColor: "divider",
                }}
              >
                {statusInfo.showSpinner && <CircularProgress size={14} />}
                <Typography variant="caption" color="text.secondary">
                  {statusInfo.label}
                </Typography>
              </Box>
            )}

            {/* Results list (virtualized) */}
            {results.length > 0 && (
              <Box
                ref={setListContainer}
                role="listbox"
                sx={{
                  maxHeight: MAX_VISIBLE_RESULTS * RESULT_ROW_HEIGHT,
                  overflowY: "auto",
                  position: "relative",
                }}
              >
                <Box
                  sx={{
                    height: rowVirtualizer.getTotalSize(),
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const result = results[virtualRow.index];
                    if (!result) return null;
                    return (
                      <ListItemButton
                        key={result.id}
                        selected={virtualRow.index === selectedIndex}
                        onClick={() => handleSelect(result.value)}
                        onMouseEnter={() => setSelectedIndex(virtualRow.index)}
                        sx={{
                          py: 0.75,
                          px: 2,
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        role="option"
                        aria-selected={virtualRow.index === selectedIndex}
                      >
                        {result.display}
                      </ListItemButton>
                    );
                  })}
                </Box>
              </Box>
            )}

            {/* Below minimum query length hint */}
            {showBelowMinimum && (
              <Box sx={{ px: 2, py: 1.5, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  {effectiveBelowMinimumMessage}
                </Typography>
              </Box>
            )}

            {/* No results */}
            {showNoResults && (
              <Box sx={{ px: 2, py: 2, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  {t("fileBrowser.search.results.none", { query })}
                </Typography>
              </Box>
            )}

            {/* Footer */}
            {(provider.footerHint || provider.footerInfo) && (
              <Box
                sx={{
                  px: 2,
                  py: 0.75,
                  borderTop: 1,
                  borderColor: "divider",
                  display: "flex",
                  justifyContent: "space-between",
                  backgroundColor: "action.selected",
                }}
              >
                {provider.footerHint && (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      color: "text.secondary",
                      fontSize: "0.75rem",
                      "& kbd": {
                        fontFamily: "inherit",
                        fontSize: "0.7rem",
                        lineHeight: 1,
                        px: 0.5,
                        py: 0.25,
                        borderRadius: 0.5,
                        border: 1,
                        borderColor: "divider",
                        backgroundColor: "background.default",
                      },
                    }}
                  >
                    {provider.footerHint}
                  </Box>
                )}
                {provider.footerInfo && (
                  <Typography variant="caption" color="text.secondary">
                    {provider.footerInfo(results.length)}
                  </Typography>
                )}
              </Box>
            )}
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
