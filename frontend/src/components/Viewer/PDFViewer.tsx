import { Alert, Box, CircularProgress, Dialog } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import apiService from "../../services/api";
import { error as logError, info as logInfo } from "../../services/logger";
import { isApiError } from "../../types";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import PDFControls from "./PDFControls";

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
  const [searchMatches, _setSearchMatches] = useState<number>(0);
  const [currentMatch, setCurrentMatch] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);

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

        logInfo("Fetching PDF via API with auth header", {
          path,
          connectionId,
        });

        const blob = await apiService.getPdfBlob(connectionId, path, {
          signal: abortController.signal,
        });

        if (!blob || blob.size === 0) {
          throw new Error("Received empty PDF blob");
        }

        if (!isMounted) return;

        blobUrl = URL.createObjectURL(blob);
        logInfo("Created blob URL for PDF", {
          path,
          blobUrl,
          size: blob.size,
        });

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
        logInfo("Revoking blob URL", { blobUrl });
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [connectionId, path]);

  // Measure container dimensions with ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerWidth(width);
        setContainerHeight(height);
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

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
    // Standard PDF page dimensions (US Letter at 72 DPI)
    const PAGE_WIDTH = 612;  // 8.5 inches × 72 DPI
    const PAGE_HEIGHT = 792; // 11 inches × 72 DPI

    if (scale === "fit-page") {
      // Wait for container dimensions to be measured
      if (containerWidth === 0 || containerHeight === 0) {
        return {
          pageScale: 1.0,
          pageWidth: undefined,
        };
      }

      // Add padding to prevent PDF from touching edges
      const PADDING = 32;
      const availableWidth = containerWidth - PADDING * 2;
      const availableHeight = containerHeight - PADDING * 2;

      // Fit entire page in viewport (like object-fit: contain)
      const widthRatio = availableWidth / PAGE_WIDTH;
      const heightRatio = availableHeight / PAGE_HEIGHT;
      const calculatedScale = Math.min(widthRatio, heightRatio);

      return {
        pageScale: Math.max(0.5, Math.min(3.0, calculatedScale)),
        pageWidth: undefined,
      };
    }

    if (scale === "fit-width") {
      // Fit width, allow vertical scrolling
      const PADDING = 32;
      const availableWidth = containerWidth > 0 ? containerWidth - PADDING * 2 : containerWidth;
      return {
        pageScale: undefined,
        pageWidth: Math.max(100, availableWidth),
      };
    }

    // Numeric zoom level
    return {
      pageScale: scale,
      pageWidth: undefined,
    };
  }, [scale, containerWidth, containerHeight]);

  // Handle document load success
  const handleDocumentLoadSuccess = useCallback(
    ({ numPages: pages }: { numPages: number }) => {
      setNumPages(pages);
      setCurrentPage(1);
      logInfo("PDF loaded successfully", { pages, path });
    },
    [path]
  );

  // Handle document load error
  const handleDocumentLoadError = useCallback(
    (err: Error) => {
      logError("PDF load error", { error: err, path });
      setError(getErrorMessage(err));
    },
    [path]
  );

  // Page navigation
  const handlePageChange = useCallback(
    (page: number) => {
      if (page >= 1 && page <= numPages) {
        setCurrentPage(page);
        logInfo("Navigated to page", { page, totalPages: numPages });
      }
    },
    [numPages]
  );

  // Zoom controls
  const handleScaleChange = useCallback((newScale: ZoomMode) => {
    setScale(newScale);
    logInfo("Zoom changed", { scale: newScale });
  }, []);

  // Download handler
  const handleDownload = useCallback(() => {
    const downloadUrl = apiService.getDownloadUrl(connectionId, path);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    link.click();
    logInfo("Download initiated", { path, filename });
  }, [connectionId, path, filename]);

  // Search handlers (basic implementation - will be enhanced in Phase 2)
  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
    // TODO: Implement actual search logic in Phase 2
    if (text) {
      logInfo("Search query changed", { query: text });
    }
  }, []);

  const handleSearchNext = useCallback(() => {
    if (searchMatches > 0) {
      setCurrentMatch((prev) => (prev >= searchMatches ? 1 : prev + 1));
      logInfo("Navigate to next search match");
    }
  }, [searchMatches]);

  const handleSearchPrevious = useCallback(() => {
    if (searchMatches > 0) {
      setCurrentMatch((prev) => (prev <= 1 ? searchMatches : prev - 1));
      logInfo("Navigate to previous search match");
    }
  }, [searchMatches]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

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
            handleScaleChange(Math.min(scale + 0.25, 3.0));
          } else {
            handleScaleChange(1.25);
          }
          break;
        case "-":
        case "_":
          event.preventDefault();
          if (typeof scale === "number") {
            handleScaleChange(Math.max(scale - 0.25, 0.5));
          } else {
            handleScaleChange(0.75);
          }
          break;
        case "Escape":
          event.preventDefault();
          onClose();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentPage, numPages, scale, onClose, handlePageChange, handleScaleChange]);

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
          <PDFControls
            filename={filename}
            currentPage={currentPage}
            totalPages={numPages}
            scale={scale}
            onPageChange={handlePageChange}
            onScaleChange={handleScaleChange}
            onClose={onClose}
            onDownload={handleDownload}
            searchText={searchText}
            onSearchChange={handleSearchChange}
            searchMatches={searchMatches}
            currentMatch={currentMatch}
            onSearchNext={handleSearchNext}
            onSearchPrevious={handleSearchPrevious}
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
          {!error && pdfUrl && (
            <Box
              sx={{
                maxWidth: "100%",
                maxHeight: "100%",
                width: "auto",
                height: "auto",
                minWidth: 0,
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
                  scale={pageScale}
                  width={pageWidth}
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
