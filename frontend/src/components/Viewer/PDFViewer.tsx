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
  const [searchMatches, setSearchMatches] = useState<number>(0);
  const [currentMatch, setCurrentMatch] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const [pdfPageWidth, setPdfPageWidth] = useState<number>(612); // Default to US Letter
  const [pdfPageHeight, setPdfPageHeight] = useState<number>(792);
  const containerRef = useRef<HTMLDivElement>(null);

  // Search state
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());
  const [matchLocations, setMatchLocations] = useState<Array<{ page: number; index: number }>>([]);
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
        let hasText = false;

        try {
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            // biome-ignore lint/suspicious/noExplicitAny: PDF.js text item type not fully typed
            const pageText = textContent.items.map((item: any) => item.str).join(" ");
            texts.set(i, pageText);

            // Check if this page has any non-whitespace text
            if (pageText.trim().length > 0) {
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

  // Perform search across all extracted page texts
  const performSearch = useCallback(
    (query: string) => {
      if (!query.trim() || pageTexts.size === 0) {
        setMatchLocations([]);
        setSearchMatches(0);
        setCurrentMatch(0);
        return;
      }

      const lowerQuery = query.toLowerCase();
      const matches: Array<{ page: number; index: number }> = [];

      // Search through all pages
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const pageText = pageTexts.get(pageNum);
        if (!pageText) continue;

        const lowerPageText = pageText.toLowerCase();
        let startIndex = 0;

        // Find all occurrences in this page
        while (true) {
          const index = lowerPageText.indexOf(lowerQuery, startIndex);
          if (index === -1) break;

          matches.push({ page: pageNum, index });
          startIndex = index + 1;
        }
      }

      setMatchLocations(matches);
      setSearchMatches(matches.length);

      // Navigate to first match if any found
      if (matches.length > 0) {
        setCurrentMatch(1);
        setCurrentPage(matches[0].page);
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

  // Effect to highlight matches in the text layer
  // Apply highlights to the text layer
  useEffect(() => {
    if (!searchText.trim() || matchLocations.length === 0) {
      // Clear all highlights
      const textLayer = document.querySelector(".react-pdf__Page__textContent");
      if (textLayer) {
        const spans = textLayer.querySelectorAll("span");
        for (const span of spans) {
          span.style.backgroundColor = "";
        }
      }
      return;
    }

    const applyHighlights = () => {
      const textLayer = document.querySelector(".react-pdf__Page__textContent");
      if (!textLayer) return false;

      const pageText = pageTexts.get(currentPage);
      if (!pageText) return false;

      const spans = textLayer.querySelectorAll("span");
      if (spans.length === 0) return false;

      const lowerQuery = searchText.toLowerCase();
      const lowerPageText = pageText.toLowerCase();

      // Find all match positions in the page text
      const matchPositions: number[] = [];
      let pos = 0;
      while (true) {
        pos = lowerPageText.indexOf(lowerQuery, pos);
        if (pos === -1) break;
        matchPositions.push(pos);
        pos += 1;
      }

      // Map character positions to spans
      // Get matches on current page for proper indexing
      const pageMatches = matchLocations
        .map((loc, idx) => ({ ...loc, globalIndex: idx }))
        .filter((loc) => loc.page === currentPage);

      let charIndex = 0;
      for (const span of spans) {
        const spanText = span.textContent || "";
        const spanStart = charIndex;
        const spanEnd = charIndex + spanText.length;

        // Clear previous highlighting
        span.style.backgroundColor = "";

        // Check if this span contains any matches
        for (let i = 0; i < matchPositions.length; i++) {
          const matchStart = matchPositions[i];
          const matchEnd = matchStart + lowerQuery.length;

          // Check if match overlaps with this span
          if (matchStart < spanEnd && matchEnd > spanStart) {
            // Determine if this is the current match by checking global index
            const pageMatch = pageMatches[i];
            const isCurrentMatch =
              currentMatch > 0 && pageMatch && pageMatch.globalIndex === currentMatch - 1;

            span.style.backgroundColor = isCurrentMatch
              ? "rgba(255, 152, 0, 0.4)"
              : "rgba(255, 235, 59, 0.4)";
            span.style.color = "inherit";
            break;
          }
        }

        charIndex = spanEnd + 1; // +1 for space between spans
      }
      return true;
    };

    // Try to apply highlights immediately if text layer exists
    // Otherwise use MutationObserver to wait for it
    if (!applyHighlights()) {
      // Watch the document container which persists across page changes
      const pdfDocument = document.querySelector(".react-pdf__Document");
      if (pdfDocument) {
        let attemptCount = 0;
        const maxAttempts = 50; // Stop after 5 seconds (50 * 100ms)

        const observer = new MutationObserver(() => {
          attemptCount++;
          if (applyHighlights() || attemptCount >= maxAttempts) {
            observer.disconnect();
          }
        });
        observer.observe(pdfDocument, { childList: true, subtree: true });
        return () => observer.disconnect();
      }
    }
  }, [searchText, matchLocations, currentPage, currentMatch, pageTexts]);

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
                <Page
                  pageNumber={currentPage}
                  scale={pageScale || undefined}
                  width={pageWidth || undefined}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  loading={<CircularProgress />}
                />
              </Document>
            </Box>
          )}
        </Box>
      </Box>
    </Dialog>
  );
};

export default PDFViewer;
