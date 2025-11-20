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
  const [currentMatch, setCurrentMatch] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const [pdfPageWidth, setPdfPageWidth] = useState<number>(612); // Default to US Letter
  const [pdfPageHeight, setPdfPageHeight] = useState<number>(792);
  const containerRef = useRef<HTMLDivElement>(null);

  // Search state
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());
  const [normalizedPageTexts, setNormalizedPageTexts] = useState<Map<number, string>>(new Map());
  const [pageDiffs, setPageDiffs] = useState<Map<number, number[]>>(new Map());
  // Store original text content strings per page (like Firefox's textContentItemsStr)
  const originalTextContentRef = useRef<Map<number, string[]>>(new Map());
  const [matchLocations, setMatchLocations] = useState<
    Array<{ page: number; index: number; length: number }>
  >([]);
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

  // Normalize function with position mapping (simplified Firefox approach)
  const normalize = useCallback((text: string): [string, number[]] => {
    const result: string[] = [];
    const diffs: number[] = [];
    let origIdx = 0;

    while (origIdx < text.length) {
      const char = text[origIdx];

      // Store mapping from result position to original position
      diffs[result.length] = origIdx;

      if (/\s/.test(char)) {
        // Collapse consecutive whitespace into a single space
        result.push(" ");
        origIdx++;
        // Skip remaining consecutive whitespace
        while (origIdx < text.length && /\s/.test(text[origIdx])) {
          origIdx++;
        }
      } else {
        // Regular character
        result.push(char);
        origIdx++;
      }
    }

    // Final position mapping
    diffs[result.length] = origIdx;

    return [result.join(""), diffs];
  }, []);

  // Firefox's getOriginalIndex function: maps position in normalized text back to original text
  const getOriginalIndex = useCallback(
    (diffs: number[], pos: number, len: number): [number, number] => {
      if (!diffs || diffs.length === 0) {
        return [pos, len];
      }

      // Find where pos falls in the diffs array
      // diffs[i] tells us: normalized position i came from original position diffs[i]
      const start = pos;
      const end = pos + len - 1;

      // Map start position
      const originalStart = diffs[start] !== undefined ? diffs[start] : start;
      // Map end position
      const originalEnd = diffs[end] !== undefined ? diffs[end] : end;
      const originalLen = originalEnd - originalStart + 1;

      return [originalStart, originalLen];
    },
    []
  );

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

      // Clear stored text content for previous document
      originalTextContentRef.current.clear();

      // Extract text from all pages for search functionality
      const extractAllText = async () => {
        setExtractingText(true);
        const texts = new Map<number, string>();
        const normalizedTexts = new Map<number, string>();
        const diffs = new Map<number, number[]>();
        let hasText = false;

        try {
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            // Extract text like Firefox: include \n for EOL markers
            const strBuf: string[] = [];
            for (const textItem of textContent.items) {
              // biome-ignore lint/suspicious/noExplicitAny: PDF.js text item type not fully typed
              strBuf.push((textItem as any).str);
              // biome-ignore lint/suspicious/noExplicitAny: PDF.js text item type not fully typed
              if ((textItem as any).hasEOL) {
                strBuf.push("\n");
              }
            }
            const pageText = strBuf.join("");
            texts.set(i, pageText);

            // Normalize and store diffs like Firefox
            const [normalizedText, diffsArray] = normalize(pageText);
            normalizedTexts.set(i, normalizedText);
            diffs.set(i, diffsArray);

            // Check if this page has any non-whitespace text
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
        } finally {
          setExtractingText(false);
        }
      };

      extractAllText();
    },
    [normalize]
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
      if (!query.trim() || normalizedPageTexts.size === 0) {
        setMatchLocations([]);
        setCurrentMatch(0);
        return;
      }

      const [normalizedQuery] = normalize(query.toLowerCase());
      const matches: Array<{ page: number; index: number; length: number }> = [];

      // Search through all pages in normalized text
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const normalizedPageText = normalizedPageTexts.get(pageNum);
        const diffs = pageDiffs.get(pageNum);
        if (!normalizedPageText) continue;

        const lowerPageText = normalizedPageText.toLowerCase();

        // Find all occurrences in normalized text
        let startIndex = 0;
        while (true) {
          const normIndex = lowerPageText.indexOf(normalizedQuery, startIndex);
          if (normIndex === -1) break;

          // Map normalized position back to original using Firefox's getOriginalIndex
          const [originalIndex, originalLength] = getOriginalIndex(
            diffs || [],
            normIndex,
            normalizedQuery.length
          );

          matches.push({ page: pageNum, index: originalIndex, length: originalLength });
          startIndex = normIndex + 1;
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
    [normalizedPageTexts, pageDiffs, numPages, normalize, getOriginalIndex]
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

  // Effect to highlight matches in the text layer
  // Apply highlights to the text layer
  useEffect(() => {
    console.log("*** Highlight effect running ***", {
      searchText,
      matchCount: matchLocations.length,
      currentPage,
    });
    if (!searchText.trim() || matchLocations.length === 0) {
      // Clear all highlights - restore original text content
      const textLayer = document.querySelector(".react-pdf__Page__textContent");
      if (textLayer) {
        const spans = textLayer.querySelectorAll("span");
        const storedTextContent = originalTextContentRef.current.get(currentPage);

        if (storedTextContent && storedTextContent.length === spans.length) {
          // Restore from stored original text
          for (let i = 0; i < spans.length; i++) {
            spans[i].textContent = storedTextContent[i];
            spans[i].className = "";
          }
        } else {
          // Fallback: just clear styling
          for (const span of spans) {
            span.style.backgroundColor = "";
          }
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

      // Get or store original text content (like Firefox's textContentItemsStr)
      let textContentItems = originalTextContentRef.current.get(currentPage);
      if (!textContentItems) {
        // First time seeing this page's text layer - store the original strings
        textContentItems = [];
        for (const span of spans) {
          textContentItems.push(span.textContent || "");
        }
        originalTextContentRef.current.set(currentPage, textContentItems);
      } else {
        // Restore all spans to their original text (clear previous highlights)
        for (let i = 0; i < spans.length; i++) {
          spans[i].textContent = textContentItems[i];
          spans[i].className = "";
        }
      }

      // DEBUG: Compare DOM concatenated text with extracted text
      const domConcat = textContentItems.join("");
      const extractedText = pageText;
      const extractedWithoutNewlines = pageText.replace(/\n/g, "");
      console.log("=== TEXT COMPARISON ===");
      console.log("DOM length:", domConcat.length);
      console.log("Extracted length (with \\n):", extractedText.length);
      console.log("Extracted length (without \\n):", extractedWithoutNewlines.length);
      console.log("DOM === Extracted (no \\n):", domConcat === extractedWithoutNewlines);
      if (domConcat !== extractedWithoutNewlines) {
        console.log(
          "First diff at:",
          [...domConcat].findIndex((c, i) => c !== extractedWithoutNewlines[i])
        );
        const diffPos = [...domConcat].findIndex((c, i) => c !== extractedWithoutNewlines[i]);
        console.log(
          `DOM [${diffPos - 10}:${diffPos + 10}]:`,
          domConcat.substring(diffPos - 10, diffPos + 10)
        );
        console.log(
          `Extracted [${diffPos - 10}:${diffPos + 10}]:`,
          extractedWithoutNewlines.substring(diffPos - 10, diffPos + 10)
        );
      }

      // Get matches on current page
      const pageMatches = matchLocations
        .map((loc, idx) => ({ ...loc, globalIndex: idx }))
        .filter((loc) => loc.page === currentPage);

      if (pageMatches.length === 0) return true;

      // Firefox's _convertMatches approach: match positions are in original concatenated text
      // Simply walk through text items and find which div each position falls into
      const convertedMatches: Array<{
        begin: { divIdx: number; offset: number };
        end: { divIdx: number; offset: number };
        globalIndex: number;
      }> = [];

      for (const pageMatch of pageMatches) {
        // pageMatch.index is already in ORIGINAL text (we mapped it during search)
        const matchStart = pageMatch.index;
        const matchEnd = matchStart + pageMatch.length;

        console.log("=== Match Debug ===");
        console.log("matchStart:", matchStart, "matchEnd:", matchEnd, "length:", pageMatch.length);
        console.log("textContentItems:", textContentItems);

        // Find div indices like Firefox's _convertMatches does
        // Start fresh for each match
        let iIndex = 0;
        let i = 0;
        const end = textContentItems.length - 1;

        // Find start position
        while (i !== end && matchStart >= iIndex + textContentItems[i].length) {
          iIndex += textContentItems[i].length;
          i++;
        }

        const beginDiv = i;
        const beginOffset = matchStart - iIndex;

        console.log(
          "beginDiv:",
          beginDiv,
          "beginOffset:",
          beginOffset,
          "text:",
          textContentItems[beginDiv]
        );

        // Reset for end position search - start from the beginning again
        iIndex = 0;
        i = 0;

        // Find end position
        while (i !== end && matchEnd > iIndex + textContentItems[i].length) {
          iIndex += textContentItems[i].length;
          i++;
        }

        const endDiv = i;
        const endOffset = matchEnd - iIndex;

        console.log("endDiv:", endDiv, "endOffset:", endOffset, "text:", textContentItems[endDiv]);

        convertedMatches.push({
          begin: { divIdx: beginDiv, offset: beginOffset },
          end: { divIdx: endDiv, offset: endOffset },
          globalIndex: pageMatch.globalIndex,
        });
      } // Render highlights following Firefox's approach
      // Process matches sequentially and track what's been cleared
      const infinity = { divIdx: -1, offset: undefined };
      let prevEnd: { divIdx: number; offset: number } | null = null;

      const appendTextToDiv = (
        divIdx: number,
        fromOffset: number,
        toOffset: number | undefined,
        className?: string
      ) => {
        const div = spans[divIdx];
        const content = textContentItems[divIdx].substring(
          fromOffset,
          toOffset ?? textContentItems[divIdx].length
        );
        const node = document.createTextNode(content);

        if (className) {
          const span = document.createElement("span");
          span.className = className;
          span.style.backgroundColor = className.includes("selected")
            ? "rgba(255, 152, 0, 0.4)"
            : "rgba(255, 235, 59, 0.4)";
          span.style.color = "inherit";
          span.append(node);
          div.append(span);
        } else {
          div.append(node);
        }
      };

      const beginText = (begin: { divIdx: number; offset: number }) => {
        const divIdx = begin.divIdx;
        spans[divIdx].textContent = "";
        appendTextToDiv(divIdx, 0, begin.offset);
      };

      for (const match of convertedMatches) {
        const begin = match.begin;
        const end = match.end;
        const isCurrentMatch = currentMatch > 0 && match.globalIndex === currentMatch - 1;
        const highlightClass = isCurrentMatch ? "highlight selected" : "highlight";

        // Check if we need to start a new div
        if (!prevEnd || begin.divIdx !== prevEnd.divIdx) {
          // If there was a previous div, add the remaining text
          if (prevEnd !== null) {
            appendTextToDiv(prevEnd.divIdx, prevEnd.offset, infinity.offset);
          }
          // Clear the div and add text before the match
          beginText(begin);
        } else {
          // Add text between previous match and this match in same div
          appendTextToDiv(prevEnd.divIdx, prevEnd.offset, begin.offset);
        }

        // Add the highlighted match
        if (begin.divIdx === end.divIdx) {
          // Match within single div
          appendTextToDiv(begin.divIdx, begin.offset, end.offset, highlightClass);
        } else {
          // Match spans multiple divs
          appendTextToDiv(begin.divIdx, begin.offset, infinity.offset, highlightClass);

          // Highlight middle divs
          for (let n = begin.divIdx + 1; n < end.divIdx; n++) {
            spans[n].className = highlightClass;
            spans[n].style.backgroundColor = highlightClass.includes("selected")
              ? "rgba(255, 152, 0, 0.4)"
              : "rgba(255, 235, 59, 0.4)";
          }

          beginText(end);
          appendTextToDiv(end.divIdx, 0, end.offset, highlightClass);
        }

        prevEnd = end;
      }

      // Add remaining text in the last div
      if (prevEnd) {
        appendTextToDiv(prevEnd.divIdx, prevEnd.offset, infinity.offset);
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
