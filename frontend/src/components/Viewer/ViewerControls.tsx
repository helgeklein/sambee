import {
  ArrowBack,
  ArrowForward,
  Close,
  Download,
  RotateLeft,
  RotateRight,
  Search,
  ZoomIn,
  ZoomOut,
} from "@mui/icons-material";
import { Box, IconButton, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import React, { useState } from "react";
import { COMMON_SHORTCUTS, PDF_SHORTCUTS } from "../../config/shortcuts";
import { withShortcut } from "../../hooks/useKeyboardShortcuts";

/**
 * Configuration for which controls to display
 */
export interface ViewerControlsConfig {
  /** Show navigation buttons (Previous/Next) */
  navigation?: boolean;
  /** Show page navigation with input field (for PDFs) */
  pageNavigation?: boolean;
  /** Show zoom controls (desktop only, mobile uses pinch-to-zoom) */
  zoom?: boolean;
  /** Show rotation controls (for images) */
  rotation?: boolean;
  /** Show search toggle/functionality */
  search?: boolean;
  /** Show download button */
  download?: boolean;
}

/**
 * Navigation state for gallery/multi-item viewing
 */
export interface NavigationState {
  currentIndex: number;
  totalItems: number;
  onNext: () => void;
  onPrevious: () => void;
}

/**
 * Page navigation state for PDFs
 */
export interface PageNavigationState {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/**
 * Zoom control state
 */
export interface ZoomState {
  onZoomIn: () => void;
  onZoomOut: () => void;
}

/**
 * Rotation control state (for images)
 */
export interface RotationState {
  onRotateLeft: () => void;
  onRotateRight: () => void;
}

/**
 * Search control state
 */
export interface SearchState {
  searchText: string;
  onSearchChange: (text: string) => void;
  searchMatches?: number;
  currentMatch?: number;
  onSearchNext?: () => void;
  onSearchPrevious?: () => void;
  searchPanelOpen?: boolean;
  onSearchPanelToggle?: (open: boolean) => void;
  isSearchable?: boolean;
}

export interface ViewerControlsProps {
  /** Filename to display in the toolbar */
  filename: string;
  /** Configuration for which controls to show */
  config: ViewerControlsConfig;
  /** Close handler */
  onClose: () => void;
  /** Navigation state (optional) */
  navigation?: NavigationState;
  /** Page navigation state (optional, for PDFs) */
  pageNavigation?: PageNavigationState;
  /** Zoom state (optional) */
  zoom?: ZoomState;
  /** Rotation state (optional, for images) */
  rotation?: RotationState;
  /** Search state (optional) */
  search?: SearchState;
  /** Download handler (optional) */
  onDownload?: () => void;
}

/**
 * Centralized viewer controls component
 * Shared toolbar for image and PDF viewers with configurable buttons
 */
export const ViewerControls: React.FC<ViewerControlsProps> = ({
  filename,
  config,
  onClose,
  navigation,
  pageNavigation,
  zoom,
  rotation,
  search,
  onDownload,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [pageInput, setPageInput] = useState(
    pageNavigation ? pageNavigation.currentPage.toString() : ""
  );
  const [localShowSearch, setLocalShowSearch] = useState(false);

  // Use controlled search panel state if provided, otherwise use local state
  const showSearch =
    search?.searchPanelOpen !== undefined ? search.searchPanelOpen : localShowSearch;
  const setShowSearch = (open: boolean) => {
    if (search?.onSearchPanelToggle) {
      search.onSearchPanelToggle(open);
    } else {
      setLocalShowSearch(open);
    }
  };

  // Update page input when page changes externally
  React.useEffect(() => {
    if (pageNavigation) {
      setPageInput(pageNavigation.currentPage.toString());
    }
  }, [pageNavigation]);

  const handlePageInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(event.target.value);
  };

  const handlePageInputBlur = () => {
    if (!pageNavigation) return;
    const pageNum = Number.parseInt(pageInput, 10);
    if (pageNum >= 1 && pageNum <= pageNavigation.totalPages) {
      pageNavigation.onPageChange(pageNum);
    } else {
      // Reset to current page if invalid
      setPageInput(pageNavigation.currentPage.toString());
    }
  };

  const handlePageInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      handlePageInputBlur();
    }
  };

  const handlePreviousPage = () => {
    if (!pageNavigation) return;
    if (pageNavigation.currentPage > 1) {
      pageNavigation.onPageChange(pageNavigation.currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (!pageNavigation) return;
    if (pageNavigation.currentPage < pageNavigation.totalPages) {
      pageNavigation.onPageChange(pageNavigation.currentPage + 1);
    }
  };

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        bgcolor: "rgba(0,0,0,0.8)",
        color: "white",
        display: "flex",
        flexDirection: isMobile && showSearch ? "column" : "row",
        alignItems: isMobile && showSearch ? "stretch" : "center",
        gap: isMobile ? theme.spacing(0.5) : theme.spacing(2),
        paddingTop: isMobile
          ? `calc(${theme.spacing(1)} + env(safe-area-inset-top, 0px))`
          : theme.spacing(2),
        paddingBottom: isMobile ? theme.spacing(1) : theme.spacing(2),
        paddingLeft: isMobile ? theme.spacing(1) : theme.spacing(2),
        paddingRight: isMobile ? theme.spacing(1) : theme.spacing(2),
        zIndex: 9999,
        boxSizing: "border-box",
      }}
    >
      {/* First row: Filename and main controls */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: isMobile ? theme.spacing(0.5) : theme.spacing(2),
          flex: 1,
          minWidth: 0,
        }}
      >
        <Typography
          variant={isMobile ? "body2" : "h6"}
          sx={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: { xs: "0.875rem", sm: "1.25rem" },
            minWidth: 0,
          }}
        >
          {filename}
          {navigation && navigation.totalItems > 1 && (
            <Typography
              component="span"
              variant="caption"
              sx={{
                ml: { xs: 0.5, sm: 2 },
                opacity: 0.7,
                fontSize: { xs: "0.7rem", sm: "0.875rem" },
                display: { xs: "block", sm: "inline" },
              }}
            >
              {navigation.currentIndex + 1} / {navigation.totalItems}
            </Typography>
          )}
        </Typography>

        {/* Gallery navigation */}
        {config.navigation && navigation && navigation.totalItems > 1 && (
          <>
            <IconButton
              color="inherit"
              onClick={navigation.onPrevious}
              disabled={navigation.currentIndex === 0}
              title="Previous (Left arrow)"
              aria-label="Previous"
              size={isMobile ? "small" : "medium"}
            >
              <ArrowBack fontSize={isMobile ? "small" : "medium"} />
            </IconButton>

            <IconButton
              color="inherit"
              onClick={navigation.onNext}
              disabled={navigation.currentIndex === navigation.totalItems - 1}
              title="Next (Right arrow)"
              aria-label="Next"
              size={isMobile ? "small" : "medium"}
            >
              <ArrowForward fontSize={isMobile ? "small" : "medium"} />
            </IconButton>
          </>
        )}

        {/* Page navigation (for PDFs) */}
        {config.pageNavigation && pageNavigation && pageNavigation.totalPages > 0 && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 0.5 : 1,
            }}
          >
            <IconButton
              color="inherit"
              onClick={handlePreviousPage}
              disabled={pageNavigation.currentPage <= 1}
              title="Previous page (Left arrow, Page Up)"
              aria-label="Previous page"
              size={isMobile ? "small" : "medium"}
            >
              <ArrowBack fontSize={isMobile ? "small" : "medium"} />
            </IconButton>

            <TextField
              value={pageInput}
              onChange={handlePageInputChange}
              onBlur={handlePageInputBlur}
              onKeyDown={handlePageInputKeyDown}
              size="small"
              sx={{
                width: isMobile ? "40px" : "60px",
                "& .MuiInputBase-root": {
                  color: "white",
                  fontSize: isMobile ? "0.75rem" : "0.875rem",
                },
                "& .MuiOutlinedInput-notchedOutline": {
                  borderColor: "rgba(255,255,255,0.3)",
                },
                "&:hover .MuiOutlinedInput-notchedOutline": {
                  borderColor: "rgba(255,255,255,0.5)",
                },
                "& .MuiInputBase-input": {
                  textAlign: "center",
                  padding: isMobile ? "4px" : "6px",
                },
              }}
              inputProps={{
                inputMode: "numeric",
                pattern: "[0-9]*",
              }}
            />

            <Typography variant={isMobile ? "caption" : "body2"} sx={{ whiteSpace: "nowrap" }}>
              / {pageNavigation.totalPages}
            </Typography>

            <IconButton
              color="inherit"
              onClick={handleNextPage}
              disabled={pageNavigation.currentPage >= pageNavigation.totalPages}
              title="Next page (Right arrow, Page Down)"
              aria-label="Next page"
              size={isMobile ? "small" : "medium"}
            >
              <ArrowForward fontSize={isMobile ? "small" : "medium"} />
            </IconButton>
          </Box>
        )}

        {/* Zoom controls - desktop only, mobile uses pinch-to-zoom */}
        {config.zoom && zoom && !isMobile && (
          <Box sx={{ display: "flex", gap: 0 }}>
            <IconButton
              color="inherit"
              onClick={zoom.onZoomOut}
              title={withShortcut(PDF_SHORTCUTS.ZOOM_OUT)}
              aria-label="Zoom out"
              size="medium"
            >
              <ZoomOut />
            </IconButton>

            <IconButton
              color="inherit"
              onClick={zoom.onZoomIn}
              title={withShortcut(PDF_SHORTCUTS.ZOOM_IN)}
              aria-label="Zoom in"
              size="medium"
            >
              <ZoomIn />
            </IconButton>
          </Box>
        )}

        {/* Rotation controls */}
        {config.rotation && rotation && (
          <Box sx={{ display: "flex", gap: 0 }}>
            {!isMobile && (
              <IconButton
                color="inherit"
                onClick={rotation.onRotateLeft}
                title={withShortcut(PDF_SHORTCUTS.ROTATE_LEFT)}
                aria-label="Rotate left"
                size="medium"
              >
                <RotateLeft />
              </IconButton>
            )}

            <IconButton
              color="inherit"
              onClick={rotation.onRotateRight}
              title={withShortcut(PDF_SHORTCUTS.ROTATE_RIGHT)}
              aria-label="Rotate right"
              size={isMobile ? "small" : "medium"}
            >
              <RotateRight fontSize={isMobile ? "small" : "medium"} />
            </IconButton>
          </Box>
        )}

        {/* Search toggle */}
        {config.search && search && (
          <IconButton
            color="inherit"
            onClick={() => setShowSearch(!showSearch)}
            title={
              search.isSearchable === false
                ? "Search unavailable - PDF contains no text layer (may be a scanned image)"
                : withShortcut(PDF_SHORTCUTS.SEARCH)
            }
            aria-label="Search"
            size={isMobile ? "small" : "medium"}
            disabled={search.isSearchable === false}
            sx={{
              ...(search.isSearchable === false && {
                opacity: 0.5,
                cursor: "not-allowed",
              }),
            }}
          >
            <Search fontSize={isMobile ? "small" : "medium"} />
          </IconButton>
        )}

        {/* Download button */}
        {config.download && onDownload && !isMobile && (
          <IconButton
            color="inherit"
            onClick={onDownload}
            title={withShortcut(COMMON_SHORTCUTS.DOWNLOAD)}
            aria-label="Download"
            size="medium"
          >
            <Download />
          </IconButton>
        )}

        {/* Close button */}
        <IconButton
          color="inherit"
          onClick={onClose}
          title={withShortcut(COMMON_SHORTCUTS.CLOSE)}
          aria-label="Close"
          size={isMobile ? "small" : "medium"}
        >
          <Close fontSize={isMobile ? "small" : "medium"} />
        </IconButton>
      </Box>

      {/* Second row: Search (when expanded) */}
      {config.search && search && showSearch && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            width: isMobile ? "100%" : "auto",
            minWidth: isMobile ? undefined : "300px",
          }}
        >
          <TextField
            value={search.searchText}
            onChange={(e) => search.onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && search.onSearchNext) {
                e.preventDefault();
                search.onSearchNext();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setShowSearch(false);
                // Clear search text to remove highlights
                search.onSearchChange("");
              }
            }}
            placeholder="Search..."
            size="small"
            autoFocus
            sx={{
              flex: 1,
              minWidth: 0,
              "& .MuiInputBase-root": {
                color: "white",
                fontSize: "0.875rem",
              },
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(255,255,255,0.3)",
              },
              "&:hover .MuiOutlinedInput-notchedOutline": {
                borderColor: "rgba(255,255,255,0.5)",
              },
              "& .MuiInputBase-input::placeholder": {
                color: "rgba(255,255,255,0.5)",
                opacity: 1,
              },
            }}
          />

          {search.searchMatches !== undefined && search.searchMatches > 0 && (
            <Typography variant="caption" sx={{ whiteSpace: "nowrap" }}>
              {search.currentMatch} / {search.searchMatches}
            </Typography>
          )}

          {search.onSearchPrevious && (
            <IconButton
              color="inherit"
              onClick={search.onSearchPrevious}
              disabled={!search.searchMatches || search.searchMatches === 0}
              title="Previous match"
              aria-label="Previous match"
              size="small"
            >
              <ArrowBack fontSize="small" />
            </IconButton>
          )}

          {search.onSearchNext && (
            <IconButton
              color="inherit"
              onClick={search.onSearchNext}
              disabled={!search.searchMatches || search.searchMatches === 0}
              title="Next match"
              aria-label="Next match"
              size="small"
            >
              <ArrowForward fontSize="small" />
            </IconButton>
          )}
        </Box>
      )}
    </Box>
  );
};

export default ViewerControls;
