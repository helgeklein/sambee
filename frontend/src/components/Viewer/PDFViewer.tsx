import { Alert, Box, CircularProgress, Dialog } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import apiService from "../../services/api";
import { error as logError } from "../../services/logger";
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
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const [pdfPageWidth, setPdfPageWidth] = useState<number>(612); // Default to US Letter
  const [pdfPageHeight, setPdfPageHeight] = useState<number>(792);
  const containerRef = useRef<HTMLDivElement>(null);

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
      const calculatedScale = Math.min(widthRatio, heightRatio);

      const finalScale = Math.max(0.5, Math.min(3.0, calculatedScale));

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

  // Search handlers (basic implementation - will be enhanced in Phase 2)
  const handleSearchChange = useCallback((text: string) => {
    setSearchText(text);
    // TODO: Implement actual search logic in Phase 2
  }, []);

  const handleSearchNext = useCallback(() => {
    if (searchMatches > 0) {
      setCurrentMatch((prev) => (prev >= searchMatches ? 1 : prev + 1));
    }
  }, [searchMatches]);

  const handleSearchPrevious = useCallback(() => {
    if (searchMatches > 0) {
      setCurrentMatch((prev) => (prev <= 1 ? searchMatches : prev - 1));
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
                "& .react-pdf__Page__canvas": {
                  maxWidth: "100%",
                  maxHeight: "100%",
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
