import { ArrowBack, ArrowForward, Close, Download, IosShare, RotateLeft, RotateRight, Search, ZoomIn, ZoomOut } from "@mui/icons-material";
import { Box, IconButton, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { COMMON_SHORTCUTS, VIEWER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { withShortcut } from "../../hooks/useKeyboardShortcuts";
import { PAGE_INPUT, RESPONSIVE_FONT_SIZE, TOOLBAR_HEIGHT, Z_INDEX } from "../../theme/constants";
import { VIEWER_DEFAULTS } from "../../theme/viewerStyles";

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
  /** Show share button */
  share?: boolean;
}

/**
 * Navigation state for gallery/multi-item viewing
 */
export interface NavigationState {
  currentIndex: number;
  totalItems: number;
  onNext?: () => void;
  onPrevious?: () => void;
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
  /** Share handler (optional) */
  onShare?: () => void;
  /** Warm share payload on early user intent (optional) */
  onShareIntent?: () => void;
  /** Disable share button while work is in progress */
  shareDisabled?: boolean;
  /** Toolbar background color from theme */
  toolbarBackground?: string;
  /** Toolbar text color from theme */
  toolbarText?: string;
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
  onShare,
  onShareIntent,
  shareDisabled = false,
  toolbarBackground = VIEWER_DEFAULTS.TOOLBAR_BG,
  toolbarText = VIEWER_DEFAULTS.TOOLBAR_TEXT,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { t } = useTranslation();
  const [pageInput, setPageInput] = useState(pageNavigation ? pageNavigation.currentPage.toString() : "");
  const [localShowSearch, setLocalShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Use controlled search panel state if provided, otherwise use local state
  const showSearch = search?.searchPanelOpen !== undefined ? search.searchPanelOpen : localShowSearch;
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

  // Focus search input when panel opens
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }
  }, [showSearch]);

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
        bgcolor: toolbarBackground,
        color: toolbarText,
        display: "flex",
        flexDirection: isMobile && showSearch ? "column" : "row",
        alignItems: isMobile && showSearch ? "stretch" : "center",
        gap: isMobile ? theme.spacing(0.5) : theme.spacing(2),
        minHeight: isMobile ? `${TOOLBAR_HEIGHT.MOBILE_PX}px` : `${TOOLBAR_HEIGHT.DESKTOP_PX}px`,
        paddingTop: isMobile ? `calc(${theme.spacing(1)} + env(safe-area-inset-top, 0px))` : 0,
        paddingBottom: isMobile ? theme.spacing(1) : 0,
        paddingLeft: isMobile ? theme.spacing(1) : theme.spacing(2),
        paddingRight: isMobile ? theme.spacing(1) : theme.spacing(2),
        zIndex: Z_INDEX.VIEWER_TOOLBAR,
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
            fontSize: RESPONSIVE_FONT_SIZE.BODY,
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
                fontSize: RESPONSIVE_FONT_SIZE.CAPTION,
                display: { xs: "block", sm: "inline" },
              }}
            >
              {navigation.currentIndex + 1} / {navigation.totalItems}
            </Typography>
          )}
        </Typography>

        {/* Gallery navigation */}
        {config.navigation && navigation && navigation.totalItems > 1 && !isMobile && (
          <>
            <IconButton
              color="inherit"
              onClick={navigation.onPrevious}
              disabled={navigation.currentIndex === 0}
              title={withShortcut(COMMON_SHORTCUTS.PREVIOUS_ARROW)}
              aria-label={t("viewer.controls.previous")}
              size={isMobile ? "small" : "medium"}
              sx={{
                "&.Mui-disabled": {
                  color: toolbarBackground,
                },
              }}
            >
              <ArrowBack fontSize={isMobile ? "small" : "medium"} />
            </IconButton>

            <IconButton
              color="inherit"
              onClick={navigation.onNext}
              disabled={navigation.currentIndex === navigation.totalItems - 1}
              title={withShortcut(COMMON_SHORTCUTS.NEXT_ARROW)}
              aria-label={t("viewer.controls.next")}
              size={isMobile ? "small" : "medium"}
              sx={{
                "&.Mui-disabled": {
                  color: toolbarBackground,
                },
              }}
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
              title={withShortcut(COMMON_SHORTCUTS.PAGE_UP)}
              aria-label={t("viewer.controls.previousPage")}
              size={isMobile ? "small" : "medium"}
              sx={{
                "&.Mui-disabled": {
                  color: toolbarBackground,
                },
              }}
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
                width: isMobile ? `${PAGE_INPUT.WIDTH_MOBILE_PX}px` : `${PAGE_INPUT.WIDTH_DESKTOP_PX}px`,
                "& .MuiInputBase-root": {
                  color: toolbarText,
                  fontSize: isMobile ? "0.75rem" : "0.875rem",
                },
                "& .MuiOutlinedInput-notchedOutline": {
                  borderColor: `${toolbarText}4D`,
                },
                "&:hover .MuiOutlinedInput-notchedOutline": {
                  borderColor: `${toolbarText}80`,
                },
                "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": {
                  borderColor: "primary.main",
                },
                "& .MuiInputBase-input": {
                  textAlign: "center",
                  padding: isMobile ? `${PAGE_INPUT.PADDING_MOBILE_PX}px` : `${PAGE_INPUT.PADDING_DESKTOP_PX}px`,
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
              title={withShortcut(COMMON_SHORTCUTS.PAGE_DOWN)}
              aria-label={t("viewer.controls.nextPage")}
              size={isMobile ? "small" : "medium"}
              sx={{
                "&.Mui-disabled": {
                  color: toolbarBackground,
                },
              }}
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
              title={withShortcut(VIEWER_SHORTCUTS.ZOOM_OUT)}
              aria-label={t("viewer.controls.zoomOut")}
              size="medium"
            >
              <ZoomOut />
            </IconButton>

            <IconButton
              color="inherit"
              onClick={zoom.onZoomIn}
              title={withShortcut(VIEWER_SHORTCUTS.ZOOM_IN)}
              aria-label={t("viewer.controls.zoomIn")}
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
                title={withShortcut(VIEWER_SHORTCUTS.ROTATE_LEFT)}
                aria-label={t("viewer.controls.rotateLeft")}
                size="medium"
              >
                <RotateLeft />
              </IconButton>
            )}

            <IconButton
              color="inherit"
              onClick={rotation.onRotateRight}
              title={withShortcut(VIEWER_SHORTCUTS.ROTATE_RIGHT)}
              aria-label={t("viewer.controls.rotateRight")}
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
            title={search.isSearchable === false ? t("viewer.controls.searchUnavailable") : withShortcut(COMMON_SHORTCUTS.SEARCH)}
            aria-label={t("common.search.action")}
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
            aria-label={t("common.actions.download")}
            size="medium"
          >
            <Download />
          </IconButton>
        )}

        {/* Share button */}
        {config.share && onShare && isMobile && (
          <IconButton
            color="inherit"
            onClick={onShare}
            onPointerDown={onShareIntent}
            aria-label={t("common.actions.share")}
            title={t("common.actions.share")}
            size="small"
            disabled={shareDisabled}
          >
            <IosShare fontSize="small" />
          </IconButton>
        )}

        {/* Close button */}
        <IconButton
          color="inherit"
          onClick={onClose}
          title={withShortcut(COMMON_SHORTCUTS.CLOSE)}
          aria-label={t("common.actions.close")}
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
            placeholder={t("common.search.placeholder")}
            size="small"
            inputRef={searchInputRef}
            sx={{
              flex: 1,
              minWidth: 0,
              "& .MuiInputBase-root": {
                color: toolbarText,
                fontSize: "0.875rem",
              },
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: `${toolbarText}4D`,
              },
              "&:hover .MuiOutlinedInput-notchedOutline": {
                borderColor: `${toolbarText}80`,
              },
              "& .MuiInputBase-input::placeholder": {
                color: `${toolbarText}80`,
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
              title={t("common.search.previousMatch")}
              aria-label={t("common.search.previousMatch")}
              size="small"
              sx={{
                "&.Mui-disabled": {
                  color: toolbarBackground,
                },
              }}
            >
              <ArrowBack fontSize="small" />
            </IconButton>
          )}

          {search.onSearchNext && (
            <IconButton
              color="inherit"
              onClick={search.onSearchNext}
              disabled={!search.searchMatches || search.searchMatches === 0}
              title={t("common.search.nextMatch")}
              aria-label={t("common.search.nextMatch")}
              size="small"
              sx={{
                "&.Mui-disabled": {
                  color: toolbarBackground,
                },
              }}
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
