//
// useDirectorySearchProvider
//

/**
 * Directory Search Provider Hook
 * ===============================
 *
 * Returns a SearchProvider that searches all directory paths across the
 * current SMB connection using the backend directory cache.
 *
 * Features:
 * - Server-side search via GET /browse/{connectionId}/directories?q=...
 * - Cache state tracking (empty → building → ready → updating)
 * - Highlighted matching substrings in results
 * - Warm-up on activation to trigger cache building
 */

import FolderIcon from "@mui/icons-material/Folder";
import { Box, ListItemIcon, ListItemText, Typography } from "@mui/material";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BROWSER_SHORTCUTS } from "../../../config/keyboardShortcuts";
import api from "../../../services/api";
import { logger } from "../../../services/logger";
import type { DirectorySearchResult } from "../../../types";
import { normalizeQuerySeparators } from "./normalizeQuerySeparators";
import type { SearchProvider, SearchResult, SearchStatusInfo } from "./types";

// ============================================================================
// Constants
// ============================================================================

/** Debounce delay in milliseconds for directory search */
const DIRECTORY_SEARCH_DEBOUNCE_MS = 200;

/** Minimum query length to trigger a directory search */
const DIRECTORY_MIN_QUERY_LENGTH = 2;

const PATH_SEPARATOR = "/";

/** Ellipsis prefix used when the path is truncated */
const ELLIPSIS_PREFIX = "…/";

// ============================================================================
// splitPathSegments — splits a path into segments preserving separators
// ============================================================================

/**
 * Splits a path string into segments.
 * Leading separators are preserved in the first segment.
 *
 * Example: "/Documents/Reports/2026" → ["/", "Documents", "Reports", "2026"]
 */
//
// splitPathSegments
//
function splitPathSegments(path: string): string[] {
  /**
   * Split on path separator, filter empty strings, and preserve leading separator.
   */

  const parts = path.split(PATH_SEPARATOR).filter(Boolean);
  if (path.startsWith(PATH_SEPARATOR)) {
    parts.unshift(PATH_SEPARATOR);
  }
  return parts;
}

// ============================================================================
// findMatchSegmentRange — locates which segments contain the query match
// ============================================================================

interface SegmentRange {
  /** Index of the first segment containing part of the match */
  startSegment: number;
  /** Index of the last segment containing part of the match (inclusive) */
  endSegment: number;
}

/**
 * Given path segments and a query, find which segments span the match.
 * Returns null if the query does not match.
 */
//
// findMatchSegmentRange
//
function findMatchSegmentRange(segments: string[], query: string): SegmentRange | null {
  /**
   * Reconstruct the path, map each character back to its segment index,
   * then look up the segments that contain the match start and end.
   */

  if (!query) return null;

  // Reconstruct the full path from segments with separators
  let reconstructed = "";
  const charToSegment: number[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === undefined) continue;
    // Add separator before non-root, non-first segments
    if (i > 0 && seg !== PATH_SEPARATOR) {
      reconstructed += PATH_SEPARATOR;
      charToSegment.push(i);
    }
    for (let c = 0; c < seg.length; c++) {
      reconstructed += seg[c];
      charToSegment.push(i);
    }
  }

  const matchIndex = reconstructed.toLowerCase().indexOf(query.toLowerCase());
  if (matchIndex === -1) return null;

  const matchEnd = matchIndex + query.length - 1;
  const startSeg = charToSegment[matchIndex];
  const endSeg = charToSegment[Math.min(matchEnd, charToSegment.length - 1)];
  if (startSeg === undefined || endSeg === undefined) return null;

  return {
    startSegment: startSeg,
    endSegment: endSeg,
  };
}

// ============================================================================
// SmartPathDisplay — shows path with match context and highlighted match
// ============================================================================

interface SmartPathDisplayProps {
  /** Full directory path */
  path: string;
  /** User's search query */
  query: string;
}

/**
 * Renders a directory path with smart truncation:
 * - The filename/deepest segment is always shown
 * - Segments containing the match are always shown
 * - Prefix segments that don't contain the match are collapsed to "…/"
 * - The matched substring is bold + primary-colored
 *
 * Two-line layout:
 *   primary line = deepest segments around the match
 *   secondary line = full path (dimmed, for context)
 */
//
// SmartPathDisplay
//
const SmartPathDisplay: React.FC<SmartPathDisplayProps> = ({ path, query }) => {
  /**
   * The primary line shows segments around the match, with leading "…/"
   * if prefix segments were collapsed. The match is highlighted.
   * The secondary line shows the full path, dimmed, for reference.
   */

  const segments = splitPathSegments(path);
  const matchRange = findMatchSegmentRange(segments, query);

  // Determine which segments to show in the primary line.
  // Always show from the match start segment (or the last segment if no match)
  // through the end.
  let visibleStart: number;
  if (matchRange) {
    // Show from match start through end of path
    visibleStart = matchRange.startSegment;
  } else {
    // No match — show the last segment only
    visibleStart = Math.max(0, segments.length - 1);
  }

  // Skip leading "/" segment for the visible portion (it's just a separator)
  if (visibleStart === 0 && segments[0] === PATH_SEPARATOR && segments.length > 1) {
    visibleStart = 1;
  }

  const visibleSegments = segments.slice(visibleStart);
  const isTruncated = visibleStart > 0 && !(visibleStart === 1 && segments[0] === PATH_SEPARATOR);
  const primaryPath = (isTruncated ? ELLIPSIS_PREFIX : "") + visibleSegments.join(PATH_SEPARATOR);

  // Build the parent path for the secondary line (everything before the visible segments)
  const parentSegments = segments.slice(0, visibleStart);
  const parentPath =
    parentSegments.length > 0 ? parentSegments.filter((s) => s !== PATH_SEPARATOR).join(PATH_SEPARATOR) + PATH_SEPARATOR : "";

  // Highlight the match within the primary path
  const primaryDisplay = renderHighlighted(primaryPath, query);

  return (
    <Box sx={{ minWidth: 0, overflow: "hidden" }}>
      <Typography
        component="div"
        sx={{
          fontFamily: "monospace",
          fontSize: "0.9rem",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.4,
        }}
      >
        {primaryDisplay}
      </Typography>
      {isTruncated && parentPath && (
        <Typography
          component="div"
          variant="caption"
          sx={{
            fontFamily: "monospace",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: "text.disabled",
            lineHeight: 1.3,
          }}
        >
          {parentPath}
        </Typography>
      )}
    </Box>
  );
};

// ============================================================================
// renderHighlighted — highlight matching substring in text
// ============================================================================

/**
 * Returns a React node with the first occurrence of `query` in `text`
 * rendered in bold + primary color.
 */
//
// renderHighlighted
//
function renderHighlighted(text: string, query: string): React.ReactNode {
  /**
   * Case-insensitive search for the query within the text.
   * If found, split into before/match/after and bold the match.
   */

  if (!query) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);

  if (matchIndex === -1) return text;

  const before = text.slice(0, matchIndex);
  const match = text.slice(matchIndex, matchIndex + query.length);
  const after = text.slice(matchIndex + query.length);

  return (
    <>
      {before}
      <Box component="span" sx={{ fontWeight: "bold", color: "primary.dark" }}>
        {match}
      </Box>
      {after}
    </>
  );
}

// ============================================================================
// ResultRow — renders a single directory result with smart path display
// ============================================================================

interface ResultRowProps {
  path: string;
  query: string;
}

interface DirectorySearchProviderOptions {
  includeDotDirectories?: boolean;
}

//
// ResultRow
//
const ResultRow: React.FC<ResultRowProps> = ({ path, query }) => (
  <>
    <ListItemIcon sx={{ minWidth: 36 }}>
      <FolderIcon fontSize="small" color="action" />
    </ListItemIcon>
    <ListItemText disableTypography primary={<SmartPathDisplay path={path} query={query} />} />
  </>
);

// ============================================================================
// Hook
// ============================================================================

/**
 * Creates a SearchProvider for directory navigation.
 *
 * @param connectionId - The active SMB connection ID
 * @param onNavigate - Callback when a directory is selected
 * @returns A SearchProvider instance for use with UnifiedSearchBar
 */
//
// useDirectorySearchProvider
//
export function useDirectorySearchProvider(
  connectionId: string,
  onNavigate: (path: string) => void,
  options: DirectorySearchProviderOptions = {}
): SearchProvider {
  const { t } = useTranslation();
  const [cacheState, setCacheState] = useState<string>("empty");
  const [directoryCount, setDirectoryCount] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const lastQueryRef = useRef<string>("");
  const includeDotDirectories = options.includeDotDirectories ?? false;

  //
  // fetchResults
  //
  const fetchResults = useCallback(
    async (query: string, signal: AbortSignal): Promise<SearchResult[]> => {
      // Normalise backslashes to forward slashes for cross-directory search
      const normalizedQuery = normalizeQuerySeparators(query);
      lastQueryRef.current = normalizedQuery;

      try {
        const result: DirectorySearchResult = await api.searchDirectories(connectionId, normalizedQuery, {
          includeDotDirectories,
          signal,
        });

        if (!signal.aborted) {
          setCacheState(result.cache_state);
          setDirectoryCount(result.directory_count);
          setTotalMatches(result.total_matches);
        }

        return result.results.map((path) => ({
          id: path,
          value: path,
          display: <ResultRow path={path} query={normalizedQuery} />,
        }));
      } catch (error: unknown) {
        if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ERR_CANCELED") {
          return []; // Request was cancelled, ignore
        }
        logger.error("Failed to search directories", { error }, "directory-search-provider");
        return [];
      }
    },
    [connectionId, includeDotDirectories]
  );

  //
  // onSelect
  //
  const onSelect = useCallback(
    (value: string) => {
      onNavigate(value);
    },
    [onNavigate]
  );

  //
  // getStatusInfo
  //
  const getStatusInfo = useCallback((): SearchStatusInfo | null => {
    switch (cacheState) {
      case "building":
        return {
          label: t("fileBrowser.search.status.indexing", { count: directoryCount }),
          showSpinner: true,
        };
      case "updating":
        return {
          label: t("fileBrowser.search.status.updating", { count: directoryCount }),
          showSpinner: true,
        };
      case "empty":
        return { label: t("fileBrowser.search.status.startingIndex"), showSpinner: true };
      case "ready":
        return null;
      default:
        return null;
    }
  }, [cacheState, directoryCount, t]);

  //
  // onActivate
  //
  const onActivate = useCallback(() => {
    // Trigger an empty search to warm up the directory cache
    const controller = new AbortController();
    api
      .searchDirectories(connectionId, "", {
        includeDotDirectories,
        signal: controller.signal,
      })
      .then((result: DirectorySearchResult) => {
        if (!controller.signal.aborted) {
          setCacheState(result.cache_state);
          setDirectoryCount(result.directory_count);
        }
      })
      .catch((error: unknown) => {
        if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code !== "ERR_CANCELED") {
          logger.error("Failed to warm up directory cache", { error }, "directory-search-provider");
        }
      });
  }, [connectionId, includeDotDirectories]);

  //
  // footerInfo
  //
  const footerInfo = useCallback(
    (resultCount: number): string | undefined => {
      if (resultCount > 0) {
        const isTruncated = totalMatches > resultCount;
        if (isTruncated) {
          return t("fileBrowser.search.results.countTruncated", { count: resultCount });
        }

        return t("fileBrowser.search.results.count", { count: resultCount });
      }
      return cacheState === "ready" && directoryCount > 0
        ? t("fileBrowser.search.results.directoriesIndexed", { count: directoryCount })
        : undefined;
    },
    [cacheState, directoryCount, t, totalMatches]
  );

  return {
    id: "directory-search",
    modeId: "quick-nav",
    modeLabel: t("fileBrowser.search.modes.quickNav"),
    placeholder: t("fileBrowser.search.placeholders.directory"),
    debounceMs: DIRECTORY_SEARCH_DEBOUNCE_MS,
    minQueryLength: DIRECTORY_MIN_QUERY_LENGTH,
    fetchResults,
    onSelect,
    getStatusInfo,
    onActivate,
    footerHint: (
      <>
        ↑↓ {t("fileBrowser.search.footer.navigate")}&ensp;↵ {t("fileBrowser.search.footer.open")}&ensp;<kbd>esc</kbd>{" "}
        {t("fileBrowser.search.footer.close")}
      </>
    ),
    footerInfo,
    shortcutHint: BROWSER_SHORTCUTS.QUICK_NAVIGATE.label,
    belowMinimumMessage: t("fileBrowser.search.belowMinimum", { count: DIRECTORY_MIN_QUERY_LENGTH }),
  };
}
