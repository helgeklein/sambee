import { Alert, Box, CircularProgress, Dialog } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import apiService from "../../services/api";
import { error as logError } from "../../services/logger";
import { isApiError } from "../../types";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { ViewerControls } from "./ViewerControls";

// Configure PDF.js worker - use CDN to avoid version mismatch
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type ZoomMode = "fit-page" | "fit-width" | number;

/**
 * Text item data from PDF.js with positioning metadata
 */
interface TextItemData {
  text: string;
  startIndex: number;
  endIndex: number;
  transform: number[];
  width: number;
  height: number;
}

/**
 * Match location with reference to containing text item
 */
interface MatchLocation {
  page: number;
  index: number;
  length: number;
  item: TextItemData;
}

/**
 * PDF.js viewport for coordinate calculations
 */
interface PDFViewport {
  width: number;
  height: number;
  scale: number;
}

/**
 * Extract error message from API error or exception
 */
const getErrorMessage = (err: unknown): string => {
  if (isApiError(err) && err.response?.data?.detail) {
    return err.response.data.detail;
  }
  if (isApiError(err) && err.message) {
    if (err.response?.data) {
      const data = err.response.data as Record<string, unknown>;
      if (typeof data.detail === "string") {
        return data.detail;
      }
    }
    return `Failed to load PDF: ${err.message}`;
  }
  return "Failed to load PDF";
};

/**
 * PDF Viewer Component
 * Displays PDF files with navigation, zoom, and search capabilities.
 * Uses react-pdf for client-side rendering to enable text search.
 * Fetches PDFs via API with authentication headers, then creates blob URLs.
 */
const PDFViewer: React.FC<ViewerComponentProps> = ({ connectionId, path, onClose }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<ZoomMode>("fit-page");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState<string>("");
  const [currentMatch, setCurrentMatch] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const [pdfPageWidth, setPdfPageWidth] = useState<number>(612); // Default to US Letter
  const [pdfPageHeight, setPdfPageHeight] = useState<number>(792);
  const containerRef = useRef<HTMLDivElement>(null);

  // Search state
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());
  const [pageTextItems, setPageTextItems] = useState<Map<number, TextItemData[]>>(new Map());
  const [pageViewports, setPageViewports] = useState<Map<number, PDFViewport>>(new Map());
  const [matchLocations, setMatchLocations] = useState<MatchLocation[]>([]);
  const [_extractingText, setExtractingText] = useState(false);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [isSearchable, setIsSearchable] = useState(true); // Assume searchable until proven otherwise

  // Extract filename from path
  const filename = path.split("/").pop() || path;

  // Fetch PDF via API with auth header, then create blob URL
  useEffect(() => {
    let isMounted = true;
    let blobUrl: string | null = null;
    const abortController = new AbortController();

    const fetchPdf = async () => {
      try {
        setLoading(true);
        setError(null);

        const blob = await apiService.getPdfBlob(connectionId, path, {
          signal: abortController.signal,
        });

        if (!blob || blob.size === 0) {
          throw new Error("Received empty PDF blob");
        }

        if (!isMounted) return;

        blobUrl = URL.createObjectURL(blob);
        setPdfUrl(blobUrl);
      } catch (err) {
        if (!isMounted) return;

        const errorMessage = getErrorMessage(err);
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
  }, [connectionId, path]);

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
  useEffect(() => {
    if (!loading && !error && containerRef.current) {
      setTimeout(() => {
        containerRef.current?.focus();
      }, 100);
    }
  }, [loading, error]);

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
        const textItemsMap = new Map<number, TextItemData[]>();
        const viewportsMap = new Map<number, PDFViewport>();
        let hasText = false;

        try {
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const viewport = page.getViewport({ scale: 1.0 });

            // Store viewport for coordinate calculations
            viewportsMap.set(i, viewport);

            // Simple text extraction with item metadata (pdf-helper approach)
            let fullText = "";
            const items: TextItemData[] = [];

            for (let itemIndex = 0; itemIndex < textContent.items.length; itemIndex++) {
              const textItem = textContent.items[itemIndex];
              // biome-ignore lint/suspicious/noExplicitAny: PDF.js text item type not fully typed
              const item = textItem as any;
              const startIndex = fullText.length;

              // Add the text item's content
              fullText += item.str;
              const endIndex = fullText.length;

              items.push({
                text: item.str,
                startIndex,
                endIndex,
                transform: item.transform,
                width: item.width,
                height: item.height,
              });

              // Add space separator AFTER recording the item
              fullText += " ";
            }

            texts.set(i, fullText);
            textItemsMap.set(i, items);

            // Check if this page has any non-whitespace text
            if (fullText.trim().length > 0) {
              hasText = true;
            }
          }

          setPageTexts(texts);
          setPageTextItems(textItemsMap);
          setPageViewports(viewportsMap);
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
    setError(getErrorMessage(err));
  }, []);

  // Page navigation
  const handlePageChange = useCallback(
    (page: number) => {
      if (page >= 1 && page <= numPages) {
        setCurrentPage(page);
      }
    },
    [numPages]
  );

  // Zoom controls
  const handleScaleChange = useCallback((newScale: ZoomMode) => {
    setScale(newScale);
  }, []);

  // Download handler
  const handleDownload = useCallback(() => {
    const downloadUrl = apiService.getDownloadUrl(connectionId, path);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    link.click();
  }, [connectionId, path, filename]);

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
        const items = pageTextItems.get(pageNum);
        if (!fullText || !items) continue;

        let match: RegExpExecArray | null;
        // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex iteration pattern
        while ((match = regex.exec(fullText)) !== null) {
          const matchPosition = match.index;
          const matchText = match[0];

          // Find which text item contains this match
          const containingItem = items.find(
            (item) => matchPosition >= item.startIndex && matchPosition < item.endIndex
          );

          if (containingItem) {
            matches.push({
              page: pageNum,
              index: matchPosition,
              length: matchText.length,
              item: containingItem,
            });
          }
        }
      }

      setMatchLocations(matches);

      // Navigate to first match if any found
      if (matches.length > 0) {
        setCurrentMatch(1);
        setCurrentPage(matches[0].page);
      } else {
        setCurrentMatch(0);
      }
    },
    [pageTexts, pageTextItems, numPages]
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

  const handleSearchNext = useCallback(() => {
    if (matchLocations.length === 0) return;

    const nextMatch = currentMatch >= matchLocations.length ? 1 : currentMatch + 1;
    setCurrentMatch(nextMatch);
    setCurrentPage(matchLocations[nextMatch - 1].page);
  }, [matchLocations, currentMatch]);

  const handleSearchPrevious = useCallback(() => {
    if (matchLocations.length === 0) return;

    const prevMatch = currentMatch <= 1 ? matchLocations.length : currentMatch - 1;
    setCurrentMatch(prevMatch);
    setCurrentPage(matchLocations[prevMatch - 1].page);
  }, [matchLocations, currentMatch]);

  /**
   * Render search highlights using div overlays positioned with PDF.js coordinates.
   * Calculates precise position and width for matched text within text items.
   */
  useEffect(() => {
    // Clear all existing highlights
    const highlightContainers = document.querySelectorAll(".pdf-highlight-container");
    for (const container of highlightContainers) {
      container.innerHTML = "";
    }

    if (!searchText.trim() || matchLocations.length === 0) {
      return;
    }

    // Get page container for current page
    const pageContainer = document.querySelector(`[data-page-number="${currentPage}"]`);
    if (!pageContainer) return;

    const canvas = pageContainer.querySelector("canvas");
    if (!canvas) return;

    const viewport = pageViewports.get(currentPage);
    if (!viewport) return;

    // Calculate actual render scale
    // The Page component is rendered with pageScale or pageWidth
    // We need to determine the actual scale being used
    let actualScale: number;

    if (pageScale) {
      // Direct scale mode (fit-page or numeric zoom)
      actualScale = pageScale;
    } else if (pageWidth) {
      // Fit-width mode - calculate scale from width
      actualScale = pageWidth / viewport.width;
    } else {
      // Fallback - should not happen
      actualScale = 1.0;
    }

    // Get matches on current page
    const pageMatches = matchLocations.filter((match) => match.page === currentPage);

    // Get highlight container
    const highlightContainer = pageContainer.querySelector(".pdf-highlight-container");
    if (!highlightContainer) return;

    // Debug logging
    console.log("Highlight scale debug:", {
      pageScale,
      pageWidth,
      actualScale,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      canvasRect: canvas.getBoundingClientRect(),
    });

    // Get the text layer - we'll find spans by matching text content
    const textLayer = pageContainer.querySelector(".react-pdf__Page__textContent");
    if (!textLayer) {
      console.warn("Text layer not found");
      return;
    }

    // Get all text layer spans
    const textLayerSpans = Array.from(textLayer.querySelectorAll("span"));

    // Build a map from text content to spans (handling multiple spans with same text)
    const spansByText = new Map<string, HTMLElement[]>();
    for (const span of textLayerSpans) {
      const text = span.textContent || "";
      if (!spansByText.has(text)) {
        spansByText.set(text, []);
      }
      spansByText.get(text)?.push(span);
    }

    console.log("Text layer debug:", {
      totalSpans: textLayerSpans.length,
      uniqueTexts: spansByText.size,
      spanTexts: textLayerSpans.map((s) => s.textContent).slice(0, 10),
    });

    // Render each match as a positioned div
    for (let i = 0; i < pageMatches.length; i++) {
      const match = pageMatches[i];
      const item = match.item;
      const isCurrentMatch = currentMatch > 0 && matchLocations.indexOf(match) === currentMatch - 1;

      // Find the corresponding span by text content
      const candidates = spansByText.get(item.text);
      if (!candidates || candidates.length === 0) {
        console.warn("Could not find span for text:", item.text);
        continue;
      }

      // Use the first unused candidate (for duplicate text items)
      const textSpan = candidates[0];

      // Get the span's actual position and size
      const spanRect = textSpan.getBoundingClientRect();
      const containerRect = pageContainer.getBoundingClientRect();

      // Calculate the offset of the match within the text item
      const matchStartInItem = match.index - item.startIndex;

      // Create canvas for text measurement with the actual font from the span
      const measureCanvas = document.createElement("canvas");
      const ctx = measureCanvas.getContext("2d");
      if (!ctx) continue;

      const computedStyle = window.getComputedStyle(textSpan);
      ctx.font = computedStyle.font;

      // Measure text before match
      const textBefore = item.text.substring(0, matchStartInItem);
      const offsetWidth = ctx.measureText(textBefore).width;

      // Measure matched text
      const matchedText = item.text.substring(matchStartInItem, matchStartInItem + match.length);
      const matchWidth = ctx.measureText(matchedText).width;

      // Calculate final position relative to the container
      const x = spanRect.left - containerRect.left + offsetWidth;
      const y = spanRect.top - containerRect.top;
      const height = spanRect.height;

      // Create highlight div
      const highlight = document.createElement("div");
      highlight.className = isCurrentMatch ? "search-highlight current" : "search-highlight";

      // Apply styles
      Object.assign(highlight.style, {
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        width: `${matchWidth}px`,
        height: `${height}px`,
        backgroundColor: isCurrentMatch
          ? "rgba(255, 152, 0, 0.4)" // Orange for current match
          : "rgba(255, 255, 0, 0.4)", // Yellow for other matches
        pointerEvents: "none",
        zIndex: "10",
        borderRadius: "2px",
      });

      highlightContainer.appendChild(highlight);
    }
  }, [searchText, matchLocations, currentPage, currentMatch, pageViewports, pageScale, pageWidth]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      // Check if the search input has focus - if so, skip most shortcuts
      const searchInput = document.querySelector(
        'input[placeholder="Search..."]'
      ) as HTMLInputElement;
      const searchInputHasFocus = searchInput && document.activeElement === searchInput;

      // Always allow Ctrl+F to open search
      if ((event.ctrlKey || event.metaKey) && event.key === "f") {
        event.preventDefault();
        // Open search panel if not already open
        setSearchPanelOpen(true);
        // Focus search input after a brief delay to allow panel to render
        setTimeout(() => {
          const searchInput = document.querySelector(
            'input[placeholder="Search..."]'
          ) as HTMLInputElement;
          if (searchInput) {
            searchInput.focus();
            searchInput.select();
          }
        }, 100);
        return;
      }

      // Allow F3 for search navigation even when search has focus
      if (event.key === "F3") {
        event.preventDefault();
        if (event.shiftKey) {
          handleSearchPrevious();
        } else {
          handleSearchNext();
        }
        return;
      }

      // If search input has focus, skip all other shortcuts (they're handled by the input)
      if (searchInputHasFocus) {
        return;
      }

      switch (event.key) {
        case "ArrowRight":
        case "d":
        case "D":
          if (numPages > 1) {
            event.preventDefault();
            handlePageChange(currentPage + 1);
          }
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          if (numPages > 1) {
            event.preventDefault();
            handlePageChange(currentPage - 1);
          }
          break;
        case "Home":
          if (numPages > 1) {
            event.preventDefault();
            handlePageChange(1);
          }
          break;
        case "End":
          if (numPages > 1) {
            event.preventDefault();
            handlePageChange(numPages);
          }
          break;
        case "PageDown":
          event.preventDefault();
          handlePageChange(currentPage + 1);
          break;
        case "PageUp":
          event.preventDefault();
          handlePageChange(currentPage - 1);
          break;
        case "+":
        case "=":
          event.preventDefault();
          if (typeof scale === "number") {
            handleScaleChange(scale + 0.25);
          } else {
            // When zooming from fit-page/fit-width, use current pageScale as base
            const currentScale = pageScale || 1.0;
            handleScaleChange(currentScale + 0.25);
          }
          break;
        case "-":
        case "_":
          event.preventDefault();
          if (typeof scale === "number") {
            handleScaleChange(Math.max(scale - 0.25, 0.1));
          } else {
            // When zooming from fit-page/fit-width, use current pageScale as base
            const currentScale = pageScale || 1.0;
            handleScaleChange(Math.max(currentScale - 0.25, 0.1));
          }
          break;
        case "Escape":
          event.preventDefault();
          // If search panel is open, close it first
          if (searchPanelOpen) {
            setSearchPanelOpen(false);
          } else {
            // Otherwise close the entire viewer
            onClose();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    currentPage,
    numPages,
    scale,
    pageScale,
    onClose,
    handlePageChange,
    handleScaleChange,
    handleSearchNext,
    handleSearchPrevious,
    searchPanelOpen,
  ]);

  return (
    <Dialog
      open={true}
      onClose={onClose}
      maxWidth={false}
      fullScreen
      sx={{
        "& .MuiDialog-container": {
          alignItems: "stretch",
          justifyContent: "stretch",
        },
      }}
      PaperProps={{
        sx: {
          backgroundColor: "#525252",
          boxShadow: "none",
          margin: 0,
          width: "100dvw",
          maxWidth: "100dvw",
          height: "100dvh",
          maxHeight: "100dvh",
          overflow: "hidden",
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
            config={{
              pageNavigation: true,
              zoom: true,
              search: true,
              download: true,
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
          />
        </Box>

        {/* PDF content area */}
        <Box
          ref={containerRef}
          tabIndex={0}
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "auto",
            minHeight: 0,
            backgroundColor: "#525252",
            "&:focus": {
              outline: "none",
            },
          }}
        >
          {/* Loading state */}
          {loading && (
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              position="absolute"
              top={0}
              left={0}
              right={0}
              bottom={0}
              zIndex={2}
              sx={{
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
                    "-webkit-text-fill-color": "transparent !important",
                  },
                },
              }}
            >
              <Document
                file={pdfUrl}
                onLoadSuccess={handleDocumentLoadSuccess}
                onLoadError={handleDocumentLoadError}
                loading={<CircularProgress />}
                error={
                  <Box p={2}>
                    <Alert severity="error">Failed to load PDF document</Alert>
                  </Box>
                }
              >
                <div
                  style={{ position: "relative", display: "inline-block" }}
                  data-page-number={currentPage}
                >
                  <Page
                    pageNumber={currentPage}
                    scale={pageScale || undefined}
                    width={pageWidth || undefined}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    loading={<CircularProgress />}
                  />
                  {/* Overlay container for search highlights */}
                  <div
                    className="pdf-highlight-container"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      pointerEvents: "none",
                    }}
                  />
                </div>
              </Document>
            </Box>
          )}
        </Box>
      </Box>
    </Dialog>
  );
};

export default PDFViewer;
