import {
  ArrowBack,
  ArrowForward,
  Close,
  RotateLeft,
  RotateRight,
  ZoomIn,
  ZoomOut,
} from "@mui/icons-material";
import { Box, IconButton, Typography, useMediaQuery, useTheme } from "@mui/material";
import type React from "react";

interface ImageControlsProps {
  filename: string;
  onRotate: (angle: number) => void;
  onScale: (scale: number) => void;
  rotate: number;
  scale: number;
  onClose: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  currentIndex?: number;
  totalImages?: number;
}

/**
 * Custom toolbar for image viewer with zoom, rotate, and navigation controls
 */
export const ImageControls: React.FC<ImageControlsProps> = ({
  filename,
  onRotate,
  onScale,
  rotate,
  scale,
  onClose,
  onNext,
  onPrevious,
  currentIndex,
  totalImages,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  return (
    <Box
      sx={(theme) => ({
        position: isMobile ? "relative" : "absolute",
        top: isMobile ? undefined : 0,
        left: isMobile ? undefined : 0,
        right: isMobile ? undefined : 0,
        width: "100%",
        bgcolor: "rgba(0,0,0,0.8)",
        color: "white",
        display: "flex",
        alignItems: "center",
        gap: isMobile ? theme.spacing(0.5) : theme.spacing(2),
        paddingTop: isMobile
          ? `calc(${theme.spacing(1)} + env(safe-area-inset-top, 0px))`
          : theme.spacing(2),
        paddingBottom: isMobile ? theme.spacing(1) : theme.spacing(2),
        paddingLeft: isMobile ? theme.spacing(1) : theme.spacing(2),
        paddingRight: isMobile ? theme.spacing(1) : theme.spacing(2),
        zIndex: 9999,
        boxSizing: "border-box",
      })}
    >
      <Typography
        variant={isMobile ? "body2" : "h6"}
        sx={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: { xs: "0.875rem", sm: "1.25rem" },
          minWidth: 0, // Critical for text truncation in flex container
        }}
      >
        {filename}
        {totalImages && totalImages > 1 && (
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
            {currentIndex !== undefined ? currentIndex + 1 : 1} / {totalImages}
          </Typography>
        )}
      </Typography>

      {/* Gallery navigation */}
      {totalImages && totalImages > 1 && (
        <>
          <IconButton
            color="inherit"
            onClick={onPrevious}
            disabled={currentIndex === 0}
            title="Previous image (Left arrow)"
            aria-label="Previous image"
            size={isMobile ? "small" : "medium"}
          >
            <ArrowBack fontSize={isMobile ? "small" : "medium"} />
          </IconButton>

          <IconButton
            color="inherit"
            onClick={onNext}
            disabled={currentIndex === totalImages - 1}
            title="Next image (Right arrow)"
            aria-label="Next image"
            size={isMobile ? "small" : "medium"}
          >
            <ArrowForward fontSize={isMobile ? "small" : "medium"} />
          </IconButton>
        </>
      )}

      {/* Zoom controls - hide zoom out on mobile to save space */}
      {!isMobile && (
        <Box sx={{ display: "flex", gap: 0 }}>
          <IconButton
            color="inherit"
            onClick={() => onScale(scale * 0.8)}
            title="Zoom out (-)"
            aria-label="Zoom out"
            size="medium"
          >
            <ZoomOut />
          </IconButton>

          <IconButton
            color="inherit"
            onClick={() => onScale(scale * 1.2)}
            title="Zoom in (+)"
            aria-label="Zoom in"
            size="medium"
          >
            <ZoomIn />
          </IconButton>
        </Box>
      )}

      {isMobile && (
        <IconButton
          color="inherit"
          onClick={() => onScale(scale * 1.2)}
          title="Zoom in (+)"
          aria-label="Zoom in"
          size="small"
        >
          <ZoomIn fontSize="small" />
        </IconButton>
      )}

      {/* Rotation controls - hide rotate left on mobile to save space */}
      {!isMobile && (
        <IconButton
          color="inherit"
          onClick={() => onRotate(rotate - 90)}
          title="Rotate left (Shift+R)"
          aria-label="Rotate left"
          size={isMobile ? "small" : "medium"}
        >
          <RotateLeft fontSize={isMobile ? "small" : "medium"} />
        </IconButton>
      )}

      <IconButton
        color="inherit"
        onClick={() => onRotate(rotate + 90)}
        title="Rotate right (R)"
        aria-label="Rotate right"
        size={isMobile ? "small" : "medium"}
      >
        <RotateRight fontSize={isMobile ? "small" : "medium"} />
      </IconButton>

      {/* Close button */}
      <IconButton
        color="inherit"
        onClick={onClose}
        title="Close (Escape)"
        aria-label="Close"
        size={isMobile ? "small" : "medium"}
      >
        <Close fontSize={isMobile ? "small" : "medium"} />
      </IconButton>
    </Box>
  );
};
