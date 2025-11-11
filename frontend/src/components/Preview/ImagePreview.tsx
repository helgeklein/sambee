import { Box, CircularProgress, Dialog } from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import { error as logError, info as logInfo } from "../../services/logger";
import { ImageControls } from "./ImageControls";
import type { PreviewComponentProps } from "./PreviewRegistry";

/**
 * Image Preview Component
 * Displays images with zoom, pan, rotate, and gallery navigation features
 * Uses react-photo-view for smooth image interactions
 */
const ImagePreview: React.FC<PreviewComponentProps> = ({
  connectionId,
  path,
  onClose,
  images = [path],
  currentIndex: initialIndex = 0,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [photoVisible, setPhotoVisible] = useState(false);
  const [rotate, setRotate] = useState(0);
  const [scale, setScale] = useState(1);

  // Get current image path
  const currentPath = images[currentIndex];
  const filename = currentPath.split("/").pop() || currentPath;

  // Construct all image URLs for PhotoProvider
  const imageData = useMemo(
    () =>
      images.map((imgPath) => ({
        src: `/api/preview/${connectionId}/file?path=${encodeURIComponent(imgPath)}`,
        key: imgPath,
      })),
    [images, connectionId]
  );

  // Open photo view on mount
  useEffect(() => {
    setPhotoVisible(true);
  }, []);

  // Navigation handlers
  const handleNext = useCallback(() => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setScale(1);
      setRotate(0);
      logInfo("Navigated to next image", { index: currentIndex + 1 });
    }
  }, [currentIndex, images.length]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setScale(1);
      setRotate(0);
      logInfo("Navigated to previous image", { index: currentIndex - 1 });
    }
  }, [currentIndex]);

  // Jump to first/last image
  const handleJumpToFirst = useCallback(() => {
    if (currentIndex !== 0) {
      setCurrentIndex(0);
      setScale(1);
      setRotate(0);
      logInfo("Jumped to first image");
    }
  }, [currentIndex]);

  const handleJumpToLast = useCallback(() => {
    const lastIndex = images.length - 1;
    if (currentIndex !== lastIndex) {
      setCurrentIndex(lastIndex);
      setScale(1);
      setRotate(0);
      logInfo("Jumped to last image");
    }
  }, [currentIndex, images.length]);

  // Handle close
  const handleClose = useCallback(() => {
    setPhotoVisible(false);
    onClose();
  }, [onClose]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!photoVisible) return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          handlePrevious();
          break;
        case "ArrowRight":
          e.preventDefault();
          handleNext();
          break;
        case "Escape":
          e.preventDefault();
          handleClose();
          break;
        case "+":
        case "=":
          e.preventDefault();
          setScale((s) => s * 1.2);
          break;
        case "-":
        case "_":
          e.preventDefault();
          setScale((s) => s * 0.8);
          break;
        case "r":
        case "R":
          e.preventDefault();
          if (e.shiftKey) {
            setRotate((r) => r - 90);
          } else {
            setRotate((r) => r + 90);
          }
          break;
        case "Home":
          e.preventDefault();
          handleJumpToFirst();
          break;
        case "End":
          e.preventDefault();
          handleJumpToLast();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [photoVisible, handleNext, handlePrevious, handleJumpToFirst, handleJumpToLast, handleClose]);

  // Preload adjacent images for smooth navigation
  useEffect(() => {
    if (images.length > 1) {
      const preloadImage = (imgPath: string) => {
        const img = new Image();
        img.src = `/api/preview/${connectionId}/file?path=${encodeURIComponent(imgPath)}`;
      };

      // Preload next image
      if (currentIndex < images.length - 1) {
        preloadImage(images[currentIndex + 1]);
      }

      // Preload previous image
      if (currentIndex > 0) {
        preloadImage(images[currentIndex - 1]);
      }

      // Optionally preload one more ahead for smoother experience
      if (currentIndex < images.length - 2) {
        preloadImage(images[currentIndex + 2]);
      }
    }
  }, [currentIndex, images, connectionId]);

  // Log when image preview opens
  useEffect(() => {
    logInfo("Image preview opened", {
      filename,
      gallerySize: images.length,
      isGallery: images.length > 1,
    });

    return () => {
      logInfo("Image preview closed", { filename });
    };
  }, [filename, images.length]);

  // Handle errors
  const handleError = useCallback(() => {
    logError("Error loading image", {
      path: currentPath,
      connectionId,
    });
  }, [currentPath, connectionId]);

  return (
    <PhotoProvider
      overlayRender={() => (
        <ImageControls
          filename={filename}
          onRotate={setRotate}
          onScale={setScale}
          rotate={rotate}
          scale={scale}
          onClose={handleClose}
          onNext={handleNext}
          onPrevious={handlePrevious}
          currentIndex={currentIndex}
          totalImages={images.length}
        />
      )}
      maskOpacity={0.9}
    >
      <Dialog
        open={true}
        onClose={handleClose}
        maxWidth={false}
        fullScreen
        PaperProps={{
          style: {
            backgroundColor: "transparent",
            boxShadow: "none",
          },
        }}
      >
        {imageData.map((img, idx) => (
          <PhotoView key={img.key} src={img.src}>
            {idx === currentIndex && (
              <img
                src={img.src}
                alt={img.key.split("/").pop() || ""}
                style={{
                  maxWidth: "100%",
                  maxHeight: "100vh",
                  cursor: "pointer",
                  display: idx === currentIndex ? "block" : "none",
                }}
                onError={handleError}
              />
            )}
          </PhotoView>
        ))}
        {!photoVisible && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100vh",
              bgcolor: "rgba(0, 0, 0, 0.9)",
            }}
          >
            <CircularProgress size={60} sx={{ color: "white" }} />
          </Box>
        )}
      </Dialog>
    </PhotoProvider>
  );
};

export default ImagePreview;
