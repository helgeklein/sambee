import {
  ArrowBack,
  ArrowForward,
  Close,
  RotateLeft,
  RotateRight,
  ZoomIn,
  ZoomOut,
} from "@mui/icons-material";
import { Box, IconButton, Typography } from "@mui/material";
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
 * Custom toolbar for image preview with zoom, rotate, and navigation controls
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
  return (
    <Box
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bgcolor: "rgba(0,0,0,0.8)",
        color: "white",
        p: 2,
        display: "flex",
        alignItems: "center",
        gap: 2,
        zIndex: 9999,
      }}
    >
      <Typography
        variant="h6"
        sx={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {filename}
        {totalImages && totalImages > 1 && (
          <Typography component="span" variant="caption" sx={{ ml: 2, opacity: 0.7 }}>
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
          >
            <ArrowBack />
          </IconButton>

          <IconButton
            color="inherit"
            onClick={onNext}
            disabled={currentIndex === totalImages - 1}
            title="Next image (Right arrow)"
            aria-label="Next image"
          >
            <ArrowForward />
          </IconButton>
        </>
      )}

      {/* Zoom controls */}
      <IconButton
        color="inherit"
        onClick={() => onScale(scale * 1.2)}
        title="Zoom in (+)"
        aria-label="Zoom in"
      >
        <ZoomIn />
      </IconButton>

      <IconButton
        color="inherit"
        onClick={() => onScale(scale * 0.8)}
        title="Zoom out (-)"
        aria-label="Zoom out"
      >
        <ZoomOut />
      </IconButton>

      {/* Rotation controls */}
      <IconButton
        color="inherit"
        onClick={() => onRotate(rotate + 90)}
        title="Rotate right (R)"
        aria-label="Rotate right"
      >
        <RotateRight />
      </IconButton>

      <IconButton
        color="inherit"
        onClick={() => onRotate(rotate - 90)}
        title="Rotate left (Shift+R)"
        aria-label="Rotate left"
      >
        <RotateLeft />
      </IconButton>

      {/* Close button */}
      <IconButton color="inherit" onClick={onClose} title="Close (Escape)" aria-label="Close">
        <Close />
      </IconButton>
    </Box>
  );
};
