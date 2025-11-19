import {
  ArrowBack,
  ArrowForward,
  Close,
  Download,
  Search,
  ZoomIn,
  ZoomOut,
} from "@mui/icons-material";
import {
  Box,
  IconButton,
  MenuItem,
  Select,
  type SelectChangeEvent,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import React, { useState } from "react";

type ZoomMode = "fit-page" | "fit-width" | number;

interface PDFControlsProps {
  filename: string;
  currentPage: number;
  totalPages: number;
  scale: ZoomMode;
  onPageChange: (page: number) => void;
  onScaleChange: (scale: ZoomMode) => void;
  onClose: () => void;
  onDownload: () => void;
  searchText: string;
  onSearchChange: (text: string) => void;
  searchMatches: number;
  currentMatch: number;
  onSearchNext: () => void;
  onSearchPrevious: () => void;
}

/**
 * PDF Viewer Controls Component
 * Toolbar with navigation, zoom, search, and download controls
 */
export const PDFControls: React.FC<PDFControlsProps> = ({
  filename,
  currentPage,
  totalPages,
  scale,
  onPageChange,
  onScaleChange,
  onClose,
  onDownload,
  searchText,
  onSearchChange,
  searchMatches,
  currentMatch,
  onSearchNext,
  onSearchPrevious,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [pageInput, setPageInput] = useState(currentPage.toString());
  const [showSearch, setShowSearch] = useState(false);

  // Update page input when page changes externally
  React.useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  const handlePageInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(event.target.value);
  };

  const handlePageInputBlur = () => {
    const pageNum = Number.parseInt(pageInput, 10);
    if (pageNum >= 1 && pageNum <= totalPages) {
      onPageChange(pageNum);
    } else {
      // Reset to current page if invalid
      setPageInput(currentPage.toString());
    }
  };

  const handlePageInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      handlePageInputBlur();
    }
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  const handleZoomIn = () => {
    if (typeof scale === "number") {
      onScaleChange(Math.min(scale + 0.25, 3.0));
    } else {
      onScaleChange(1.25);
    }
  };

  const handleZoomOut = () => {
    if (typeof scale === "number") {
      onScaleChange(Math.max(scale - 0.25, 0.5));
    } else {
      onScaleChange(0.75);
    }
  };

  const handleScaleChange = (event: SelectChangeEvent<string>) => {
    const value = event.target.value;
    if (value === "fit-page" || value === "fit-width") {
      onScaleChange(value);
    } else {
      onScaleChange(Number.parseFloat(value));
    }
  };

  const getScaleDisplayValue = (): string => {
    if (scale === "fit-page") return "fit-page";
    if (scale === "fit-width") return "fit-width";
    return scale.toString();
  };

  const getScalePercentage = (): string => {
    if (typeof scale === "number") {
      return `${Math.round(scale * 100)}%`;
    }
    return scale === "fit-page" ? "Fit Page" : "Fit Width";
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
        </Typography>

        {/* Page navigation */}
        {totalPages > 0 && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 0.5 : 1,
            }}
          >
            <Tooltip title="Previous page">
              <span>
                <IconButton
                  color="inherit"
                  onClick={handlePreviousPage}
                  disabled={currentPage <= 1}
                  size={isMobile ? "small" : "medium"}
                >
                  <ArrowBack fontSize={isMobile ? "small" : "medium"} />
                </IconButton>
              </span>
            </Tooltip>

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
              / {totalPages}
            </Typography>

            <Tooltip title="Next page">
              <span>
                <IconButton
                  color="inherit"
                  onClick={handleNextPage}
                  disabled={currentPage >= totalPages}
                  size={isMobile ? "small" : "medium"}
                >
                  <ArrowForward fontSize={isMobile ? "small" : "medium"} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        )}

        {/* Zoom controls */}
        {!isMobile && (
          <>
            <Tooltip title="Zoom out">
              <IconButton color="inherit" onClick={handleZoomOut} size="medium">
                <ZoomOut />
              </IconButton>
            </Tooltip>

            <Select
              value={getScaleDisplayValue()}
              onChange={handleScaleChange}
              size="small"
              sx={{
                color: "white",
                minWidth: "120px",
                "& .MuiOutlinedInput-notchedOutline": {
                  borderColor: "rgba(255,255,255,0.3)",
                },
                "&:hover .MuiOutlinedInput-notchedOutline": {
                  borderColor: "rgba(255,255,255,0.5)",
                },
                "& .MuiSvgIcon-root": {
                  color: "white",
                },
              }}
            >
              <MenuItem value="fit-page">Fit Page</MenuItem>
              <MenuItem value="fit-width">Fit Width</MenuItem>
              <MenuItem value="0.5">50%</MenuItem>
              <MenuItem value="0.75">75%</MenuItem>
              <MenuItem value="1">100%</MenuItem>
              <MenuItem value="1.25">125%</MenuItem>
              <MenuItem value="1.5">150%</MenuItem>
              <MenuItem value="2">200%</MenuItem>
              <MenuItem value="3">300%</MenuItem>
            </Select>

            <Tooltip title="Zoom in">
              <IconButton color="inherit" onClick={handleZoomIn} size="medium">
                <ZoomIn />
              </IconButton>
            </Tooltip>
          </>
        )}

        {/* Mobile zoom display */}
        {isMobile && (
          <Typography variant="caption" sx={{ whiteSpace: "nowrap" }}>
            {getScalePercentage()}
          </Typography>
        )}

        {/* Search toggle */}
        <Tooltip title="Search">
          <IconButton
            color="inherit"
            onClick={() => setShowSearch(!showSearch)}
            size={isMobile ? "small" : "medium"}
          >
            <Search fontSize={isMobile ? "small" : "medium"} />
          </IconButton>
        </Tooltip>

        {/* Download button */}
        {!isMobile && (
          <Tooltip title="Download">
            <IconButton color="inherit" onClick={onDownload} size="medium">
              <Download />
            </IconButton>
          </Tooltip>
        )}

        {/* Close button */}
        <Tooltip title="Close">
          <IconButton color="inherit" onClick={onClose} size={isMobile ? "small" : "medium"}>
            <Close fontSize={isMobile ? "small" : "medium"} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Second row: Search (when expanded) */}
      {showSearch && (
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
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search in PDF..."
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

          {searchMatches > 0 && (
            <Typography variant="caption" sx={{ whiteSpace: "nowrap" }}>
              {currentMatch} / {searchMatches}
            </Typography>
          )}

          <Tooltip title="Previous match">
            <span>
              <IconButton
                color="inherit"
                onClick={onSearchPrevious}
                disabled={searchMatches === 0}
                size="small"
              >
                <ArrowBack fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Next match">
            <span>
              <IconButton
                color="inherit"
                onClick={onSearchNext}
                disabled={searchMatches === 0}
                size="small"
              >
                <ArrowForward fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
};

export default PDFControls;
