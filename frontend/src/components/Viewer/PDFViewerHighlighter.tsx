import { Box, CircularProgress, Dialog } from "@mui/material";
import type * as PDFJS from "pdfjs-dist/types/src/pdf";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Highlight, PdfHighlighter, PdfLoader } from "react-pdf-highlighter-extended";
import "react-pdf-highlighter-extended/dist/style.css";
import apiService from "../../services/api";
import { error as logError } from "../../services/logger";
import { isApiError } from "../../types";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { SearchHighlightContainer } from "./SearchHighlightContainer";
import { ViewerControls } from "./ViewerControls";

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
 * PDF Viewer Component using react-pdf-highlighter-extended
 * Displays PDF files with navigation, zoom, and search capabilities.
 */
const PDFViewerHighlighter: React.FC<ViewerComponentProps> = ({ connectionId, path, onClose }) => {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<ZoomMode>("fit-page");
  const [pdfDocument, setPdfDocument] = useState<PDFJS.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState<string>("");
  const [currentMatch, setCurrentMatch] = useState<number>(0);
  const [searchHighlights, setSearchHighlights] = useState<Highlight[]>([]);
  const [searchHighlightPages, setSearchHighlightPages] = useState<number[]>([]);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [isSearchable, setIsSearchable] = useState(true);

  // Search indexing state
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());
  const [normalizedPageTexts, setNormalizedPageTexts] = useState<Map<number, string>>(new Map());
  const [pageDiffs, setPageDiffs] = useState<Map<number, number[]>>(new Map());

  // Ref for PdfHighlighter utilities
  const highlighterUtilsRef = useRef<{ scrollToHighlight: (highlight: Highlight) => void }>();

  const searchTimeoutRef = useRef<number | null>(null);

  // Extract filename from path
  const filename = path.split("/").pop() || path;

  // Normalize function for search
  const normalize = useCallback((text: string): [string, number[]] => {
    const result: string[] = [];
    const diffs: number[] = [];
    let origIdx = 0;

    while (origIdx < text.length) {
      const char = text[origIdx];
      diffs[result.length] = origIdx;

      if (/\s/.test(char)) {
        result.push(" ");
        origIdx++;
        while (origIdx < text.length && /\s/.test(text[origIdx])) {
          origIdx++;
        }
      } else {
        result.push(char);
        origIdx++;
      }
    }

    diffs[result.length] = origIdx;
    return [result.join(""), diffs];
  }, []);

  // Map normalized position back to original
  const getOriginalIndex = useCallback(
    (diffs: number[], pos: number, len: number): [number, number] => {
      if (!diffs || diffs.length === 0) {
        return [pos, len];
      }

      const start = pos;
      const end = pos + len - 1;
      const originalStart = diffs[start] !== undefined ? diffs[start] : start;
      const originalEnd = diffs[end] !== undefined ? diffs[end] : end;
      const originalLen = originalEnd - originalStart + 1;

      return [originalStart, originalLen];
    },
    []
  );

  // Handle PDF document load
  const handleDocumentLoad = useCallback(
    async (pdf: PDFJS.PDFDocumentProxy) => {
      setPdfDocument(pdf);
      setNumPages(pdf.numPages);
      setCurrentPage(1);
      setLoading(false);

      // Extract text from all pages for search
      const texts = new Map<number, string>();
      const normalizedTexts = new Map<number, string>();
      const diffs = new Map<number, number[]>();
      let hasText = false;

      try {
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();

          const strBuf: string[] = [];
          for (const item of textContent.items) {
            if ("str" in item) {
              strBuf.push(item.str);
              if ("hasEOL" in item && item.hasEOL) {
                strBuf.push("\n");
              }
            }
          }

          const pageText = strBuf.join("");
          texts.set(i, pageText);

          const [normalizedText, diffsArray] = normalize(pageText);
          normalizedTexts.set(i, normalizedText);
          diffs.set(i, diffsArray);

          if (pageText.trim().length > 0) {
            hasText = true;
          }
        }

        setPageTexts(texts);
        setNormalizedPageTexts(normalizedTexts);
        setPageDiffs(diffs);
        setIsSearchable(hasText);

        if (!hasText) {
          logError("PDF contains no extractable text - search disabled", {
            message: "This PDF may be a scanned image without OCR text layer",
          });
        }
      } catch (err) {
        logError("Failed to extract text from PDF", { error: err });
        setIsSearchable(false);
      }
    },
    [normalize]
  );

  // Get bounding rectangles for text matches using PDF.js text layer
  const getTextBoundingRects = useCallback(
    async (pageNum: number, startIndex: number, length: number) => {
      if (!pdfDocument) return null;

      try {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });

        // Build character position map
        let charIndex = 0;
        const rects: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

        for (const item of textContent.items) {
          if (!("str" in item) || !("transform" in item)) continue;

          const str = item.str;
          const itemStartIndex = charIndex;
          const itemEndIndex = charIndex + str.length;

          // Check if match overlaps with this text item
          const matchStart = startIndex;
          const matchEnd = startIndex + length;

          if (matchStart < itemEndIndex && matchEnd > itemStartIndex) {
            // Calculate the overlap
            const overlapStart = Math.max(0, matchStart - itemStartIndex);
            const overlapEnd = Math.min(str.length, matchEnd - itemStartIndex);

            // Get text dimensions
            const tx = item.transform[4];
            const ty = item.transform[5];
            const fontSize = Math.sqrt(item.transform[2] ** 2 + item.transform[3] ** 2);
            const width = item.width;
            const height = item.height || fontSize;

            // Calculate character width (approximation)
            const charWidth = width / str.length;

            // Calculate rectangle for the matched portion
            const x1 = tx + overlapStart * charWidth;
            const y1 = viewport.height - ty;
            const x2 = tx + overlapEnd * charWidth;
            const y2 = viewport.height - (ty - height);

            rects.push({ x1, y1: Math.min(y1, y2), x2, y2: Math.max(y1, y2) });
          }

          charIndex += str.length;
          if ("hasEOL" in item && item.hasEOL) {
            charIndex++; // Account for newline
          }
        }

        if (rects.length === 0) return null;

        // Calculate bounding rect that encompasses all rects
        const x1 = Math.min(...rects.map((r) => r.x1));
        const y1 = Math.min(...rects.map((r) => r.y1));
        const x2 = Math.max(...rects.map((r) => r.x2));
        const y2 = Math.max(...rects.map((r) => r.y2));

        return {
          boundingRect: {
            x1,
            y1,
            x2,
            y2,
            width: x2 - x1,
            height: y2 - y1,
            pageNumber: pageNum,
          },
          rects: rects.map((r) => ({
            x1: r.x1,
            y1: r.y1,
            x2: r.x2,
            y2: r.y2,
            width: r.x2 - r.x1,
            height: r.y2 - r.y1,
            pageNumber: pageNum,
          })),
        };
      } catch (err) {
        logError("Failed to get text bounding rects", { error: err, pageNum });
        return null;
      }
    },
    [pdfDocument]
  );

  // Perform search and create highlights
  const performSearch = useCallback(
    async (query: string) => {
      if (!query.trim() || normalizedPageTexts.size === 0 || !pdfDocument) {
        setSearchHighlights([]);
        setCurrentMatch(0);
        return;
      }

      const [normalizedQuery] = normalize(query.toLowerCase());
      const newHighlights: Highlight[] = [];
      const highlightPages: number[] = [];
      let matchCounter = 0;

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const normalizedPageText = normalizedPageTexts.get(pageNum);
        const diffs = pageDiffs.get(pageNum);
        const pageText = pageTexts.get(pageNum);

        if (!normalizedPageText || !pageText) continue;

        const lowerPageText = normalizedPageText.toLowerCase();
        let startIndex = 0;

        while (true) {
          const normIndex = lowerPageText.indexOf(normalizedQuery, startIndex);
          if (normIndex === -1) break;

          const [originalIndex, originalLength] = getOriginalIndex(
            diffs || [],
            normIndex,
            normalizedQuery.length
          );

          // Get bounding rectangles for this match
          const position = await getTextBoundingRects(pageNum, originalIndex, originalLength);

          if (position) {
            const highlight: Highlight = {
              id: `search-${matchCounter}`,
              type: "text",
              position: position,
              content: {
                text: pageText.substring(originalIndex, originalIndex + originalLength),
              },
            };

            newHighlights.push(highlight);
            highlightPages.push(pageNum);
            matchCounter++;
          }

          startIndex = normIndex + 1;
        }
      }

      setSearchHighlights(newHighlights);
      setSearchHighlightPages(highlightPages);

      if (newHighlights.length > 0) {
        setCurrentMatch(1);
        setCurrentPage(highlightPages[0]);
      } else {
        setCurrentMatch(0);
      }
    },
    [
      normalizedPageTexts,
      pageDiffs,
      pageTexts,
      numPages,
      pdfDocument,
      normalize,
      getOriginalIndex,
      getTextBoundingRects,
    ]
  );

  // Debounced search handler
  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchText(text);

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      searchTimeoutRef.current = window.setTimeout(() => {
        performSearch(text);
      }, 300);
    },
    [performSearch]
  );

  const handleSearchNext = useCallback(() => {
    if (searchHighlights.length === 0) return;

    const nextMatch = currentMatch >= searchHighlights.length ? 1 : currentMatch + 1;
    setCurrentMatch(nextMatch);
    setCurrentPage(searchHighlightPages[nextMatch - 1]);
  }, [searchHighlights, searchHighlightPages, currentMatch]);

  const handleSearchPrevious = useCallback(() => {
    if (searchHighlights.length === 0) return;

    const prevMatch = currentMatch <= 1 ? searchHighlights.length : currentMatch - 1;
    setCurrentMatch(prevMatch);
    setCurrentPage(searchHighlightPages[prevMatch - 1]);
  }, [searchHighlights, searchHighlightPages, currentMatch]);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const searchInput = document.querySelector(
        'input[placeholder="Search..."]'
      ) as HTMLInputElement;
      const searchInputHasFocus = searchInput && document.activeElement === searchInput;

      if ((event.ctrlKey || event.metaKey) && event.key === "f") {
        event.preventDefault();
        setSearchPanelOpen(true);
        setTimeout(() => {
          const input = document.querySelector(
            'input[placeholder="Search..."]'
          ) as HTMLInputElement;
          if (input) {
            input.focus();
            input.select();
          }
        }, 100);
        return;
      }

      if (event.key === "F3") {
        event.preventDefault();
        if (event.shiftKey) {
          handleSearchPrevious();
        } else {
          handleSearchNext();
        }
        return;
      }

      if (searchInputHasFocus) return;

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
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPage, numPages, handlePageChange, handleSearchNext, handleSearchPrevious]);

  // Fetch PDF data and create blob URL
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let blobUrl: string | null = null;

    const fetchPdf = async () => {
      try {
        setLoading(true);
        setError(null);

        const blob = await apiService.getPdfBlob(connectionId, path);

        if (!blob || blob.size === 0) {
          throw new Error("Received empty PDF blob");
        }

        if (!isMounted) return;

        blobUrl = URL.createObjectURL(blob);
        setPdfBlobUrl(blobUrl);
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
        setLoading(false);
      }
    };

    fetchPdf();

    return () => {
      isMounted = false;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [connectionId, path]);

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
        <Box sx={{ flexShrink: 0, zIndex: 1 }}>
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
                  handleScaleChange(1.25);
                }
              },
              onZoomOut: () => {
                if (typeof scale === "number") {
                  handleScaleChange(Math.max(scale - 0.25, 0.1));
                } else {
                  handleScaleChange(0.75);
                }
              },
            }}
            search={{
              searchText,
              onSearchChange: handleSearchChange,
              searchMatches: searchHighlights.length,
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
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "auto",
            minHeight: 0,
            backgroundColor: "#525252",
            position: "relative",
          }}
        >
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
            >
              <CircularProgress />
            </Box>
          )}

          {error && (
            <Box p={2} color="error.main">
              {error}
            </Box>
          )}

          {!error && pdfBlobUrl && (
            <PdfLoader document={pdfBlobUrl}>
              {(pdfDoc) => {
                if (!pdfDocument) {
                  handleDocumentLoad(pdfDoc);
                }
                return (
                  <PdfHighlighter
                    pdfDocument={pdfDoc}
                    highlights={searchHighlights}
                    enableAreaSelection={() => false}
                    utilsRef={(utils) => {
                      highlighterUtilsRef.current = utils;
                    }}
                  >
                    <SearchHighlightContainer currentMatchIndex={currentMatch - 1} />
                  </PdfHighlighter>
                );
              }}
            </PdfLoader>
          )}
        </Box>
      </Box>
    </Dialog>
  );
};

export default PDFViewerHighlighter;
