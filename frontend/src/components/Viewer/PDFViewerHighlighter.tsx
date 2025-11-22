import { Box, CircularProgress, Dialog } from "@mui/material";
import * as pdfjs from "pdfjs-dist";
// Configure PDF.js worker for react-pdf-highlighter-extended (uses pdfjs-dist 4.10.38)
// Import worker from node_modules to ensure version match
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type * as PDFJS from "pdfjs-dist/types/src/pdf";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Highlight,
  PdfHighlighter,
  type PdfHighlighterUtils,
  PdfLoader,
  type PdfScaleValue,
} from "react-pdf-highlighter-extended";
import "pdfjs-dist/web/pdf_viewer.css";
import "react-pdf-highlighter-extended/dist/esm/style/PdfHighlighter.css";
import "react-pdf-highlighter-extended/dist/esm/style/pdf_viewer.css";
import apiService from "../../services/api";
import { error as logError } from "../../services/logger";
import { isApiError } from "../../types";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { SearchHighlightContainer } from "./SearchHighlightContainer";
import { ViewerControls } from "./ViewerControls";

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Map our simple zoom modes to PdfScaleValue
// fit-page -> page-fit, fit-width -> page-width, number -> number
type ZoomMode = "fit-page" | "fit-width" | number;

const toPdfScaleValue = (zoom: ZoomMode): PdfScaleValue => {
  if (zoom === "fit-page") return "page-fit";
  if (zoom === "fit-width") return "page-width";
  return zoom;
};

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
  const highlighterUtilsRef = useRef<PdfHighlighterUtils>();

  const loadedDocRef = useRef<PDFJS.PDFDocumentProxy | null>(null);
  const pendingScrollHighlightRef = useRef<Highlight | null>(null);
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

  // Get text layer for a page (should already be rendered when user searches)
  const getTextLayer = useCallback((pageNum: number): HTMLElement | null => {
    const viewer = highlighterUtilsRef.current?.getViewer?.();
    if (!viewer) {
      return null;
    }

    const viewerContainer = viewer.viewer;
    if (!viewerContainer) {
      return null;
    }

    const pageDiv = viewerContainer.querySelector(`[data-page-number="${pageNum}"]`) as HTMLElement;
    if (!pageDiv) {
      return null;
    }

    const textLayer = pageDiv.querySelector(".textLayer") as HTMLElement;
    if (!textLayer || textLayer.children.length === 0) {
      return null;
    }

    return textLayer;
  }, []);

  // Fallback: Get bounding rectangles using PDF.js coordinates (for non-rendered pages)
  const getTextBoundingRectsFromPdfJs = useCallback(
    async (pageNum: number, startIndex: number, length: number) => {
      if (!pdfDocument) return null;

      try {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();

        let charIndex = 0;
        const rects: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

        for (const item of textContent.items) {
          if (!("str" in item) || !("transform" in item)) continue;

          const str = item.str;
          const itemStartIndex = charIndex;
          const itemEndIndex = charIndex + str.length;

          const matchStart = startIndex;
          const matchEnd = startIndex + length;

          if (matchStart < itemEndIndex && matchEnd > itemStartIndex) {
            const overlapStart = Math.max(0, matchStart - itemStartIndex);
            const overlapEnd = Math.min(str.length, matchEnd - itemStartIndex);

            const tx = item.transform[4];
            const ty = item.transform[5];
            const fontSize = Math.sqrt(item.transform[2] ** 2 + item.transform[3] ** 2);
            const width = item.width;
            const height = item.height || fontSize;

            const avgCharWidth = width / str.length;
            const startOffset = overlapStart * avgCharWidth;
            const matchWidth = (overlapEnd - overlapStart) * avgCharWidth;

            const pdfX1 = tx + startOffset;
            const pdfY1 = ty;
            const pdfX2 = tx + startOffset + matchWidth;
            const pdfY2 = ty + height;

            rects.push({ x1: pdfX1, y1: pdfY1, x2: pdfX2, y2: pdfY2 });
          }

          charIndex += str.length;
          if ("hasEOL" in item && item.hasEOL) {
            charIndex++;
          }
        }

        if (rects.length === 0) return null;

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
          usePdfCoordinates: true,
        };
      } catch (err) {
        logError("Failed to get PDF.js text bounding rects", { error: err, pageNum });
        return null;
      }
    },
    [pdfDocument]
  );

  // Get bounding rectangles using text layer DOM and Range API (accurate for proportional fonts!)
  // Falls back to PDF.js coordinates when text layer isn't rendered yet
  const getTextBoundingRects = useCallback(
    async (pageNum: number, startIndex: number, length: number) => {
      if (!pdfDocument) return null;

      try {
        // Try to get text layer (only available for rendered pages)
        const textLayer = getTextLayer(pageNum);
        if (!textLayer) {
          // Fallback: Use PDF.js coordinates for non-rendered pages
          return getTextBoundingRectsFromPdfJs(pageNum, startIndex, length);
        }

        // Find all text nodes in the text layer
        const textNodes: Text[] = [];
        const walk = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);

        let node: Node | null = walk.nextNode();
        while (node) {
          if (node.textContent) {
            textNodes.push(node as Text);
          }
          node = walk.nextNode();
        }

        // Build character index map
        let charIndex = 0;
        let startNode: Text | null = null;
        let endNode: Text | null = null;
        let startOffset = 0;
        let endOffset = 0;

        for (const textNode of textNodes) {
          const text = textNode.textContent || "";
          const nodeStart = charIndex;
          const nodeEnd = charIndex + text.length;

          // Check if match starts in this node
          if (startIndex >= nodeStart && startIndex < nodeEnd) {
            startNode = textNode;
            startOffset = startIndex - nodeStart;
          }

          // Check if match ends in this node
          if (startIndex + length > nodeStart && startIndex + length <= nodeEnd) {
            endNode = textNode;
            endOffset = startIndex + length - nodeStart;
          }

          charIndex += text.length;
        }

        if (!startNode || !endNode) {
          logError("Could not find text nodes for match", { pageNum, startIndex, length });
          return null;
        }

        // Create a Range and get client rects (accurate for proportional fonts!)
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);

        const clientRects = Array.from(range.getClientRects());

        if (clientRects.length === 0) {
          return null;
        }

        // Get the page div to convert client rects to page-relative coordinates
        const pageDiv = textLayer.closest("[data-page-number]") as HTMLElement;
        if (!pageDiv) {
          return null;
        }

        const pageRect = pageDiv.getBoundingClientRect();

        // Convert client rects to page-relative viewport coordinates
        const rects = clientRects.map((rect) => {
          // Convert to page-relative coordinates
          const x1 = rect.left - pageRect.left;
          const y1 = rect.top - pageRect.top;
          const x2 = rect.right - pageRect.left;
          const y2 = rect.bottom - pageRect.top;

          return { x1, y1, x2, y2 };
        });

        // Calculate bounding rect
        const x1 = Math.min(...rects.map((r) => r.x1));
        const y1 = Math.min(...rects.map((r) => r.y1));
        const x2 = Math.max(...rects.map((r) => r.x2));
        const y2 = Math.max(...rects.map((r) => r.y2));

        // Return ScaledPosition with viewport coordinates
        // The library expects these to be in the current scale's viewport coordinates
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
    [pdfDocument, getTextLayer, getTextBoundingRectsFromPdfJs]
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
        pendingScrollHighlightRef.current = newHighlights[0];
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

  // Search handler with debouncing
  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchText(text);

      // Clear existing timeout
      if (searchTimeoutRef.current !== null) {
        window.clearTimeout(searchTimeoutRef.current);
      }

      // Only perform search if there's actual text
      if (text.trim()) {
        // Debounce: wait 300ms after user stops typing
        searchTimeoutRef.current = window.setTimeout(() => {
          performSearch(text);
          searchTimeoutRef.current = null;
        }, 300);
      } else {
        // Clear highlights immediately when search is empty
        setSearchHighlights([]);
        setCurrentMatch(0);
      }
    },
    [performSearch]
  );

  const handleSearchNext = useCallback(() => {
    if (searchHighlights.length === 0) return;

    const nextMatch = currentMatch >= searchHighlights.length ? 1 : currentMatch + 1;

    const highlight = searchHighlights[nextMatch - 1];
    if (highlight) {
      pendingScrollHighlightRef.current = highlight;
    }

    setCurrentMatch(nextMatch);
    setCurrentPage(searchHighlightPages[nextMatch - 1]);
  }, [searchHighlights, searchHighlightPages, currentMatch]);

  const handleSearchPrevious = useCallback(() => {
    if (searchHighlights.length === 0) return;

    const prevMatch = currentMatch <= 1 ? searchHighlights.length : currentMatch - 1;

    const highlight = searchHighlights[prevMatch - 1];
    if (highlight) {
      pendingScrollHighlightRef.current = highlight;
    }

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

  // Fetch PDF data as Uint8Array
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const fetchPdf = async () => {
      try {
        setLoading(true);
        setError(null);

        const blob = await apiService.getPdfBlob(connectionId, path, {
          signal: abortController.signal,
        });

        if (!isMounted) {
          return;
        }

        // Skip if blob is empty (can happen in StrictMode double-render)
        if (blob.size === 0) {
          return;
        }

        // Convert blob to Uint8Array for PdfLoader
        const arrayBuffer = await blob.arrayBuffer();

        if (!isMounted) {
          return;
        }

        const uint8Array = new Uint8Array(arrayBuffer);

        setPdfData(uint8Array);
        setLoading(false);
      } catch (err) {
        // Ignore errors from aborted requests
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

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
      abortController.abort();
    };
  }, [connectionId, path]);

  // Handle scrolling when we have a pending scroll after state updates
  useEffect(() => {
    if (pendingScrollHighlightRef.current && highlighterUtilsRef.current) {
      const highlight = pendingScrollHighlightRef.current;
      highlighterUtilsRef.current.scrollToHighlight(highlight);
      pendingScrollHighlightRef.current = null;
    }
  });

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

          {!error && pdfData && (
            <PdfLoader document={pdfData} workerSrc={pdfjsWorker}>
              {(pdfDoc) => {
                // Check if we need to load this document (avoid setState during render)
                if (pdfDoc && loadedDocRef.current !== pdfDoc) {
                  loadedDocRef.current = pdfDoc;
                  // Schedule document load for next tick
                  Promise.resolve().then(() => handleDocumentLoad(pdfDoc));
                }

                return (
                  <PdfHighlighter
                    pdfDocument={pdfDoc}
                    highlights={searchHighlights}
                    pdfScaleValue={toPdfScaleValue(scale)}
                    enableAreaSelection={() => false}
                    utilsRef={(utils) => {
                      highlighterUtilsRef.current = utils;
                    }}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      width: "100%",
                      height: "100%",
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
