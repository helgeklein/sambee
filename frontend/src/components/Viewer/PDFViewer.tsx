import { Alert, Box, CircularProgress, Dialog, useMediaQuery, useTheme } from "@mui/material";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { BROWSER_SHORTCUTS, COMMON_SHORTCUTS, VIEWER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { checkIsTransientError, getTransientErrorMessage, useApiRetry } from "../../hooks/useApiRetry";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import apiService from "../../services/api";
import { error as logError } from "../../services/logger";
import { useSambeeTheme } from "../../theme";
import { getViewerColors } from "../../theme/viewerStyles";
import { isApiError } from "../../types";
import { getApiErrorMessage } from "../../utils/apiErrors";
import {
  activateDomTextSearchMatch,
  applyDomTextSearchHighlights,
  clearDomTextSearchHighlights,
  DOM_TEXT_SEARCH_CURRENT_MATCH_ATTRIBUTE,
  DOM_TEXT_SEARCH_HIGHLIGHT_SELECTOR,
  type DomTextSearchMatch,
} from "../../utils/domTextSearch";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { blurActiveToolbarControl } from "../../utils/keyboardUtils";
import { createShareFile, shareNativeContent, supportsNativeShare } from "../../utils/nativeShare";
import { KeyboardShortcutsHelp } from "../KeyboardShortcutsHelp";
import { ViewerControls, ViewerFilenameBadge } from "./ViewerControls";

// Configure PDF.js worker - use CDN to avoid version mismatch
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type ZoomMode = "fit-page" | "fit-width" | number;

/**
 * Match location within extracted PDF text.
 */
interface MatchLocation {
  page: number;
  index: number;
  length: number;
}

interface PdfInternalLinkTarget {
  dest?: unknown;
  pageIndex?: number;
  pageNumber?: number;
}

/**
 * PDF Viewer Component
 * Displays PDF files with navigation, zoom, and search capabilities.
 * Uses react-pdf for client-side rendering to enable text search.
 * Fetches PDFs via API with authentication headers, then creates blob URLs.
 */
const PDFViewer: React.FC<ViewerComponentProps> = ({ connectionId, path, onClose, isReadOnly = false }) => {
  const { t } = useTranslation();
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<ZoomMode>("fit-page");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [shareFile, setShareFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState<string>("");
  const [currentMatch, setCurrentMatch] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const [pdfPageWidth, setPdfPageWidth] = useState<number>(612); // Default to US Letter
  const [pdfPageHeight, setPdfPageHeight] = useState<number>(792);
  const [rotation, setRotation] = useState<number>(0); // 0, 90, 180, 270
  const containerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const numPagesRef = useRef(0);
  const searchHighlightsRef = useRef<DomTextSearchMatch[]>([]);

  // Search state
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());
  const [matchLocations, setMatchLocations] = useState<MatchLocation[]>([]);
  const [_extractingText, setExtractingText] = useState(false);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [isSearchable, setIsSearchable] = useState(true); // Assume searchable until proven otherwise
  const [showHelp, setShowHelp] = useState(false);
  const [pageRenderTrigger, setPageRenderTrigger] = useState(0); // Increments when page renders
  const [sharing, setSharing] = useState(false);
  const fetchWithRetry = useApiRetry();

  const { currentTheme } = useSambeeTheme();
  const muiTheme = useTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down("sm"));
  const shareEnabled = isMobile && supportsNativeShare();
  const { viewerBg, toolbarBg, toolbarText } = getViewerColors(currentTheme, "pdf");
  const readOnlyIndicator = isReadOnly ? (
    <ViewerFilenameBadge label={t("settings.connectionDialog.accessMode.readOnlyLabel")} toolbarText={toolbarText} />
  ) : null;

  // Extract filename from path
  const filename = path.split("/").pop() || path;

  // Rotation handlers
  const handleRotateLeft = useCallback((_event?: KeyboardEvent) => {
    setRotation((r) => (r - 90 + 360) % 360);
  }, []);

  const handleRotateRight = useCallback((_event?: KeyboardEvent) => {
    setRotation((r) => (r + 90) % 360);
  }, []);

  // Fetch PDF via API with auth header, then create blob URL
  useEffect(() => {
    let isMounted = true;
    let blobUrl: string | null = null;
    const abortController = new AbortController();

    const fetchPdf = async () => {
      try {
        setLoading(true);
        setError(null);
        setShareFile(null);
        numPagesRef.current = 0;
        setNumPages(0);
        setCurrentPage(1);
        setPageTexts(new Map());
        setMatchLocations([]);
        setCurrentMatch(0);

        const blob = await fetchWithRetry(
          () =>
            apiService.getPdfBlob(connectionId, path, {
              signal: abortController.signal,
            }),
          {
            signal: abortController.signal,
            maxRetries: 1,
            retryDelay: 1000,
          }
        );

        if (!blob || blob.size === 0) {
          throw new Error("Received empty PDF blob");
        }

        if (!isMounted) return;

        blobUrl = URL.createObjectURL(blob);
        setPdfUrl(blobUrl);
        setShareFile(createShareFile(blob, filename));
      } catch (err) {
        if (!isMounted) return;

        // Show "server busy" only for actual transient/network errors
        const errorMessage = checkIsTransientError(err)
          ? getTransientErrorMessage()
          : getApiErrorMessage(err, "Failed to load PDF", { includeOriginalMessage: true });

        logError("Failed to fetch PDF", {
          path,
          error: err,
          detail: isApiError(err) ? err.response?.data?.detail : undefined,
          status: isApiError(err) ? err.response?.status : undefined,
        });
        setError(errorMessage);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchPdf();

    return () => {
      isMounted = false;
      abortController.abort();

      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, path, fetchWithRetry, filename]);

  // Measure container dimensions with ResizeObserver
  // Trigger after PDF loads to ensure container is in DOM
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfUrl) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerWidth(width);
        setContainerHeight(height);
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [pdfUrl]);

  // Auto-focus content area after load for keyboard navigation
  // Skip if search panel is open to avoid stealing focus from search input
  useEffect(() => {
    if (loading || error || searchPanelOpen || !containerRef.current) {
      return;
    }

    containerRef.current.focus();
  }, [loading, error, searchPanelOpen]);

  // Calculate page scale based on zoom mode
  const { pageScale, pageWidth } = useMemo(() => {
    if (scale === "fit-page") {
      // Wait for container dimensions to be measured
      if (containerWidth === 0 || containerHeight === 0) {
        return {
          pageScale: 1.0,
          pageWidth: undefined,
        };
      }

      // Fit entire page in viewport (like object-fit: contain)
      const widthRatio = containerWidth / pdfPageWidth;
      const heightRatio = containerHeight / pdfPageHeight;
      const finalScale = Math.min(widthRatio, heightRatio);

      return {
        pageScale: finalScale,
        pageWidth: undefined,
      };
    }

    if (scale === "fit-width") {
      // Fit width, allow vertical scrolling - use full container width
      return {
        pageScale: undefined,
        pageWidth: Math.max(100, containerWidth),
      };
    }

    // Numeric zoom level
    return {
      pageScale: scale,
      pageWidth: undefined,
    };
  }, [scale, containerWidth, containerHeight, pdfPageWidth, pdfPageHeight]);

  // Handle document load success
  const handleDocumentLoadSuccess = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: PDF.js document type not fully typed
    (pdf: any) => {
      numPagesRef.current = pdf.numPages;
      setNumPages(pdf.numPages);
      setCurrentPage(1);

      // Get actual page dimensions from the PDF
      pdf
        .getPage(1)
        // biome-ignore lint/suspicious/noExplicitAny: PDF.js page type not fully typed
        .then((page: any) => {
          const viewport = page.getViewport({ scale: 1.0 });
          setPdfPageWidth(viewport.width);
          setPdfPageHeight(viewport.height);
        })
        // biome-ignore lint/suspicious/noExplicitAny: Error type is unknown
        .catch((err: any) => {
          logError("Failed to get page dimensions", err);
        });

      // Extract text from all pages for search functionality
      const extractAllText = async () => {
        setExtractingText(true);
        const texts = new Map<number, string>();
        let hasText = false;

        try {
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();

            // Build a searchable logical text stream with separators between items.
            let fullText = "";

            for (let itemIndex = 0; itemIndex < textContent.items.length; itemIndex++) {
              const textItem = textContent.items[itemIndex];
              // biome-ignore lint/suspicious/noExplicitAny: PDF.js text item type not fully typed
              const item = textItem as any;
              fullText += item.str;

              // Preserve item boundaries so cross-item words do not become false positives.
              fullText += " ";
            }

            texts.set(i, fullText);

            // Check if this page has any non-whitespace text
            if (fullText.trim().length > 0) {
              hasText = true;
            }
          }

          setPageTexts(texts);
          setIsSearchable(hasText);

          if (!hasText) {
            logError("PDF contains no extractable text - search disabled", {
              message: "This PDF may be a scanned image without OCR text layer",
            });
          }
        } catch (err) {
          logError("Failed to extract text from PDF", { error: err });
          setIsSearchable(false);
        } finally {
          setExtractingText(false);
        }
      };

      extractAllText();
    },
    []
  );

  // Handle document load error
  const handleDocumentLoadError = useCallback((err: Error) => {
    logError("PDF load error", { error: err.message });
    setError(getApiErrorMessage(err, "Failed to load PDF", { includeOriginalMessage: true }));
  }, []);

  // Page navigation
  const handlePageChange = useCallback((page: number) => {
    const totalPages = numPagesRef.current;

    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  }, []);

  const handleInternalLinkNavigation = useCallback(
    ({ dest, pageIndex, pageNumber }: PdfInternalLinkTarget) => {
      const totalPages = numPagesRef.current;
      const resolvedPageNumber =
        typeof pageNumber === "number" && Number.isInteger(pageNumber)
          ? pageNumber
          : typeof pageIndex === "number" && Number.isInteger(pageIndex)
            ? pageIndex + 1
            : null;

      if (resolvedPageNumber === null || resolvedPageNumber < 1 || resolvedPageNumber > totalPages) {
        logError("Failed to resolve internal PDF link target", {
          dest,
          pageIndex,
          pageNumber,
          numPages: totalPages,
        });
        return;
      }

      handlePageChange(resolvedPageNumber);
    },
    [handlePageChange]
  );

  // Zoom controls
  const handleScaleChange = useCallback((newScale: ZoomMode) => {
    setScale(newScale);
  }, []);

  // Download handler
  const handleDownload = useCallback(
    async (_event?: KeyboardEvent) => {
      try {
        await apiService.downloadFile(connectionId, path, filename);
      } catch (err) {
        logError("Failed to download file", { error: err, path, connectionId });
      }
    },
    [connectionId, path, filename]
  );

  const handleShare = useCallback(async () => {
    setShareError(null);
    setSharing(true);

    try {
      const fileToShare = shareFile ?? createShareFile(await apiService.getPdfBlob(connectionId, path), filename);
      const result = await shareNativeContent({
        file: fileToShare,
        title: filename,
      });

      if (result === "unsupported") {
        setShareError(t("viewer.share.unsupported"));
      }
    } catch (err) {
      logError("Failed to share PDF", { error: err, path, connectionId });
      setShareError(t("viewer.share.failed"));
    } finally {
      setSharing(false);
    }
  }, [connectionId, filename, path, shareFile, t]);

  /**
   * Perform search across all extracted page texts using simple regex approach.
   * Finds matches and stores reference to containing text item for positioning.
   */
  const performSearch = useCallback(
    (query: string) => {
      if (!query.trim() || pageTexts.size === 0) {
        setMatchLocations([]);
        setCurrentMatch(0);
        return;
      }

      // Escape regex special characters
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escapedQuery, "gi");
      const matches: MatchLocation[] = [];

      // Search through all pages
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const fullText = pageTexts.get(pageNum);
        if (!fullText) continue;

        let match: RegExpExecArray | null;
        // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex iteration pattern
        while ((match = regex.exec(fullText)) !== null) {
          matches.push({
            page: pageNum,
            index: match.index,
            length: match[0].length,
          });
        }
      }

      setMatchLocations(matches);

      // Navigate to first match if any found
      if (matches.length > 0) {
        setCurrentMatch(1);
        if (matches[0]) {
          setCurrentPage(matches[0].page);
        }
      } else {
        setCurrentMatch(0);
      }
    },
    [pageTexts, numPages]
  );

  // Debounced search handler
  const searchTimeoutRef = useRef<number | null>(null);

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchText(text);

      // Clear existing timeout
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      // Debounce search by 300ms
      searchTimeoutRef.current = window.setTimeout(() => {
        performSearch(text);
      }, 300);
    },
    [performSearch]
  );

  // Search matches count is simply the total from extracted text
  const searchMatches = matchLocations.length;

  const handleSearchNext = useCallback(
    (_event?: KeyboardEvent) => {
      if (matchLocations.length === 0) return;

      const nextMatch = currentMatch >= matchLocations.length ? 1 : currentMatch + 1;
      setCurrentMatch(nextMatch);
      const nextLocation = matchLocations[nextMatch - 1];
      if (nextLocation) {
        setCurrentPage(nextLocation.page);
      }
    },
    [matchLocations, currentMatch]
  );

  const handleSearchPrevious = useCallback(
    (_event?: KeyboardEvent) => {
      if (matchLocations.length === 0) return;

      const prevMatch = currentMatch <= 1 ? matchLocations.length : currentMatch - 1;
      setCurrentMatch(prevMatch);
      const prevLocation = matchLocations[prevMatch - 1];
      if (prevLocation) {
        setCurrentPage(prevLocation.page);
      }
    },
    [matchLocations, currentMatch]
  );

  const getCurrentPageMatchIndex = useCallback(() => {
    if (currentMatch <= 0) {
      return 0;
    }

    const activeMatch = matchLocations[currentMatch - 1];
    if (!activeMatch || activeMatch.page !== currentPage) {
      return 0;
    }

    let pageMatchIndex = 0;
    for (let index = 0; index < currentMatch; index += 1) {
      if (matchLocations[index]?.page === currentPage) {
        pageMatchIndex += 1;
      }
    }

    return pageMatchIndex;
  }, [currentMatch, currentPage, matchLocations]);

  // Rebuild highlights from the rendered text layer so split/merged react-pdf spans stay searchable.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pageRenderTrigger intentionally retries after async text layer rendering
  useEffect(() => {
    const textLayers = document.querySelectorAll(".react-pdf__Page__textContent");
    for (const layer of textLayers) {
      clearDomTextSearchHighlights(layer);
    }
    searchHighlightsRef.current = [];

    if (!searchText.trim() || matchLocations.length === 0) {
      return;
    }

    const pageContainer = document.querySelector(`[data-page-number="${currentPage}"]`);
    if (!pageContainer) {
      const retryTimer = setTimeout(() => {
        setPageRenderTrigger((prev) => prev + 1);
      }, 50);
      return () => clearTimeout(retryTimer);
    }

    const textLayer = pageContainer.querySelector(".react-pdf__Page__textContent");
    if (!(textLayer instanceof HTMLElement) || !textLayer.textContent?.trim()) {
      const retryTimer = setTimeout(() => {
        setPageRenderTrigger((prev) => prev + 1);
      }, 50);
      return () => clearTimeout(retryTimer);
    }

    const highlights = applyDomTextSearchHighlights(textLayer, searchText);
    searchHighlightsRef.current = highlights;
    activateDomTextSearchMatch(highlights, getCurrentPageMatchIndex());

    return () => {
      clearDomTextSearchHighlights(textLayer);
      searchHighlightsRef.current = [];
    };
  }, [currentPage, getCurrentPageMatchIndex, matchLocations, pageRenderTrigger, searchText]);

  useEffect(() => {
    activateDomTextSearchMatch(searchHighlightsRef.current, getCurrentPageMatchIndex());
  }, [getCurrentPageMatchIndex]);

  // Keyboard shortcuts - centralized configuration
  const handleOpenSearch = useCallback((_event?: KeyboardEvent) => {
    setSearchPanelOpen(true);
    // Focus will be handled by ViewerControls via ref
  }, []);

  const handleZoomIn = useCallback(
    (_event?: KeyboardEvent) => {
      if (typeof scale === "number") {
        handleScaleChange(scale + 0.25);
      } else {
        const currentScale = pageScale || 1.0;
        handleScaleChange(currentScale + 0.25);
      }
    },
    [scale, pageScale, handleScaleChange]
  );

  const handleZoomOut = useCallback(
    (_event?: KeyboardEvent) => {
      if (typeof scale === "number") {
        handleScaleChange(Math.max(scale - 0.25, 0.1));
      } else {
        const currentScale = pageScale || 1.0;
        handleScaleChange(Math.max(currentScale - 0.25, 0.1));
      }
    },
    [scale, pageScale, handleScaleChange]
  );

  const handleZoomReset = useCallback((_event?: KeyboardEvent) => {
    setScale("fit-page");
  }, []);

  const handleToggleFullscreen = useCallback((_event?: KeyboardEvent) => {
    if (!dialogRef.current) return;

    if (!document.fullscreenElement) {
      dialogRef.current.requestFullscreen().catch((err) => {
        logError(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  /**
   * Context-aware Escape handler (window-level via useKeyboardShortcuts).
   * Blur-first logic lives on the Dialog Paper's onKeyDown instead,
   * because it must fire before the parent FileBrowser's window listener.
   * Pattern: Single handler checks state to determine appropriate action
   * - If search panel is open: close search and clear results
   * - Otherwise: close the entire viewer
   */
  const handleEscape = useCallback(
    (_event?: KeyboardEvent) => {
      if (searchPanelOpen) {
        setSearchPanelOpen(false);
        // Clear search results and highlights when closing search panel
        setSearchText("");
        setMatchLocations([]);
        setCurrentMatch(0);
      } else {
        onClose();
      }
    },
    [searchPanelOpen, onClose]
  );

  /**
   * Paper-level keydown handler — single authority for all Escape logic.
   * MUI Dialogs render in a portal at document.body (outside the React root),
   * so native events may not reliably reach window listeners. Handling
   * everything here and calling preventDefault() makes close robust.
   * 1. If a toolbar button/input has focus → blur it (hide focus ring)
   * 2. If search panel is open → close search and clear results
   * 3. Otherwise → close the viewer
   */
  const handlePaperKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (blurActiveToolbarControl(containerRef)) return;
      handleEscape();
    },
    [handleEscape]
  );

  const handleShowHelp = useCallback(() => {
    setShowHelp(true);
  }, []);

  const pdfShortcuts = useMemo(
    () => [
      // Download
      {
        ...COMMON_SHORTCUTS.DOWNLOAD,
        handler: handleDownload,
      },
      // Search
      {
        ...COMMON_SHORTCUTS.SEARCH,
        handler: handleOpenSearch,
      },
      {
        ...COMMON_SHORTCUTS.NEXT_MATCH,
        handler: handleSearchNext,
      },
      {
        ...COMMON_SHORTCUTS.PREVIOUS_MATCH,
        handler: handleSearchPrevious,
      },
      // Navigation
      {
        ...COMMON_SHORTCUTS.NEXT_ARROW,
        description: "Next page",
        handler: () => handlePageChange(currentPage + 1),
        enabled: numPages > 1 && currentPage < numPages,
      },
      {
        ...COMMON_SHORTCUTS.PREVIOUS_ARROW,
        description: "Previous page",
        handler: () => handlePageChange(currentPage - 1),
        enabled: numPages > 1 && currentPage > 1,
      },
      {
        ...COMMON_SHORTCUTS.FIRST_PAGE,
        handler: () => handlePageChange(1),
        allowInInput: true,
        enabled: numPages > 1,
      },
      {
        ...COMMON_SHORTCUTS.LAST_PAGE,
        handler: () => handlePageChange(numPages),
        allowInInput: true,
        enabled: numPages > 1,
      },
      {
        ...COMMON_SHORTCUTS.PAGE_DOWN,
        handler: () => handlePageChange(currentPage + 1),
        allowInInput: true,
        enabled: currentPage < numPages,
      },
      {
        ...COMMON_SHORTCUTS.PAGE_UP,
        handler: () => handlePageChange(currentPage - 1),
        allowInInput: true,
        enabled: currentPage > 1,
      },
      // Zoom
      {
        ...VIEWER_SHORTCUTS.ZOOM_IN,
        handler: handleZoomIn,
      },
      {
        ...VIEWER_SHORTCUTS.ZOOM_OUT,
        handler: handleZoomOut,
      },
      {
        ...VIEWER_SHORTCUTS.ZOOM_RESET,
        handler: handleZoomReset,
      },
      // Rotation
      {
        ...VIEWER_SHORTCUTS.ROTATE_RIGHT,
        handler: handleRotateRight,
      },
      {
        ...VIEWER_SHORTCUTS.ROTATE_LEFT,
        handler: handleRotateLeft,
      },
      // Fullscreen
      {
        ...VIEWER_SHORTCUTS.FULLSCREEN,
        handler: handleToggleFullscreen,
      },
      // Close viewer or search panel on Escape
      {
        ...COMMON_SHORTCUTS.CLOSE,
        handler: handleEscape,
      },
      // Show help
      {
        ...BROWSER_SHORTCUTS.SHOW_HELP,
        handler: handleShowHelp,
      },
    ],
    [
      handleDownload,
      handleOpenSearch,
      handleSearchNext,
      handleSearchPrevious,
      handlePageChange,
      currentPage,
      numPages,
      handleZoomIn,
      handleZoomOut,
      handleZoomReset,
      handleRotateRight,
      handleRotateLeft,
      handleToggleFullscreen,
      handleEscape,
      handleShowHelp,
    ]
  );

  useKeyboardShortcuts({
    active: !showHelp,
    shortcuts: pdfShortcuts,
    inputSelector: 'input[placeholder="Search"]',
  });

  const handleDialogClose = useCallback(
    (_event: unknown, reason: string) => {
      if (reason === "escapeKeyDown") {
        return;
      }

      onClose();
    },
    [onClose]
  );

  return (
    <Dialog
      open={true}
      onClose={handleDialogClose}
      maxWidth={false}
      fullScreen
      ref={dialogRef}
      sx={{
        "& .MuiDialog-container": {
          alignItems: "stretch",
          justifyContent: "stretch",
        },
      }}
      slotProps={{
        paper: {
          onKeyDown: handlePaperKeyDown,
          sx: {
            backgroundColor: viewerBg,
            boxShadow: "none",
            margin: 0,
            width: "100dvw",
            maxWidth: "100dvw",
            height: "100dvh",
            maxHeight: "100dvh",
            overflow: "hidden",
          },
        },
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        {/* Controls toolbar */}
        <Box
          sx={{
            flexShrink: 0,
            zIndex: 1,
          }}
        >
          <ViewerControls
            filename={filename}
            filenameAdornment={readOnlyIndicator}
            toolbarBackground={toolbarBg}
            toolbarText={toolbarText}
            config={{
              pageNavigation: true,
              zoom: true,
              rotation: true,
              search: true,
              download: true,
              share: shareEnabled,
            }}
            onClose={onClose}
            pageNavigation={{
              currentPage,
              totalPages: numPages,
              onPageChange: handlePageChange,
            }}
            zoom={{
              onZoomIn: () => {
                if (typeof scale === "number") {
                  handleScaleChange(scale + 0.25);
                } else {
                  handleScaleChange((pageScale || 1.0) + 0.25);
                }
              },
              onZoomOut: () => {
                if (typeof scale === "number") {
                  handleScaleChange(Math.max(scale - 0.25, 0.1));
                } else {
                  handleScaleChange(Math.max((pageScale || 1.0) - 0.25, 0.1));
                }
              },
            }}
            rotation={{
              onRotateLeft: handleRotateLeft,
              onRotateRight: handleRotateRight,
            }}
            search={{
              searchText,
              onSearchChange: handleSearchChange,
              searchMatches,
              currentMatch,
              onSearchNext: handleSearchNext,
              onSearchPrevious: handleSearchPrevious,
              searchPanelOpen,
              onSearchPanelToggle: setSearchPanelOpen,
              isSearchable,
            }}
            onDownload={handleDownload}
            onShare={handleShare}
            shareDisabled={sharing || (shareEnabled && !shareFile)}
          />
        </Box>

        {shareError && (
          <Alert severity="error" sx={{ m: 2, flexShrink: 0 }}>
            {shareError}
          </Alert>
        )}

        {/* PDF content area */}
        <Box
          ref={containerRef}
          data-testid="pdf-viewer-content"
          tabIndex={0}
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "auto",
            minHeight: 0,
            backgroundColor: viewerBg,
            "&:focus": {
              outline: "none",
            },
          }}
        >
          {/* Loading state */}
          {loading && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "absolute",
                inset: 0,
                zIndex: 2,
                backgroundColor: pdfUrl ? "rgba(0, 0, 0, 0.3)" : "transparent",
              }}
            >
              <CircularProgress />
            </Box>
          )}

          {/* Error state */}
          {error && (
            <Box p={2}>
              <Alert severity="error">{error}</Alert>
            </Box>
          )}

          {/* PDF Document */}
          {!error && pdfUrl && containerWidth > 0 && containerHeight > 0 && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                height: "100%",
                // Override any padding/margin from react-pdf
                "& .react-pdf__Document": {
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                },
                "& .react-pdf__Page": {
                  padding: 0,
                  margin: 0,
                },
                // Only constrain canvas size in fit-page/fit-width modes
                ...(typeof scale !== "number" && {
                  "& .react-pdf__Page__canvas": {
                    maxWidth: "100%",
                    maxHeight: "100%",
                  },
                }),
                // Hide text layer text but keep it functional for search highlighting
                "& .react-pdf__Page__textContent": {
                  "& span": {
                    color: "transparent !important",
                    // Make sure text itself is invisible
                    WebkitTextFillColor: "transparent !important",
                  },
                },
                [`& .react-pdf__Page__textContent ${DOM_TEXT_SEARCH_HIGHLIGHT_SELECTOR}`]: {
                  backgroundColor: "rgba(255, 255, 0, 0.4)",
                  borderRadius: "2px",
                  color: "transparent !important",
                  WebkitTextFillColor: "transparent !important",
                  padding: 0,
                },
                [`& .react-pdf__Page__textContent ${DOM_TEXT_SEARCH_HIGHLIGHT_SELECTOR}[${DOM_TEXT_SEARCH_CURRENT_MATCH_ATTRIBUTE}="true"]`]:
                  {
                    backgroundColor: "rgba(255, 152, 0, 0.4)",
                  },
              }}
            >
              <Document
                file={pdfUrl}
                onItemClick={handleInternalLinkNavigation}
                onLoadSuccess={handleDocumentLoadSuccess}
                onLoadError={handleDocumentLoadError}
                loading={<CircularProgress />}
                error={
                  <Box p={2}>
                    <Alert severity="error">Failed to load PDF document</Alert>
                  </Box>
                }
              >
                {numPages > 0 && (
                  <div style={{ position: "relative", display: "inline-block" }} data-page-number={currentPage}>
                    <Page
                      pageNumber={currentPage}
                      scale={pageScale || undefined}
                      width={pageWidth || undefined}
                      rotate={rotation}
                      renderTextLayer={true}
                      renderAnnotationLayer={true}
                      loading={<CircularProgress />}
                      onRenderSuccess={() => {
                        // Trigger highlighting effect when page finishes rendering
                        setPageRenderTrigger((prev) => prev + 1);
                      }}
                    />
                  </div>
                )}
              </Document>
            </Box>
          )}
        </Box>
      </Box>
      <KeyboardShortcutsHelp
        open={showHelp}
        onClose={() => setShowHelp(false)}
        shortcuts={pdfShortcuts}
        title={t("keyboardShortcutsHelp.titles.pdfViewer")}
      />
    </Dialog>
  );
};

export default memo(PDFViewer);
