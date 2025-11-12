import { Box, CircularProgress, Dialog } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import apiService from "../../services/api";
import { error as logError, info as logInfo } from "../../services/logger";
import { ImageControls } from "./ImageControls";
import type { PreviewComponentProps } from "./PreviewRegistry";

/**
 * Image Preview Component
 * Displays images with zoom, pan, rotate, and gallery navigation features.
 * Uses react-photo-view for advanced image viewing capabilities.
 * Fetches images via Axios to include authentication headers, then creates blob URLs.
 */
const ImagePreview: React.FC<PreviewComponentProps> = ({
  connectionId,
  path,
  onClose,
  images = [path],
  currentIndex: initialIndex = 0,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [rotate, setRotate] = useState(0);
  const [scale, setScale] = useState(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get current image path
  const currentPath = images[currentIndex];
  const filename = currentPath.split("/").pop() || currentPath;

  // Fetch image via Axios to include Authorization header, then create blob URL
  useEffect(() => {
    let isMounted = true;
    let blobUrl: string | null = null;
    let loadingTimeoutId: number | null = null;
    const abortController = new AbortController();

    const fetchImage = async () => {
      try {
        setError(null);
        // Don't clear imageUrl yet - keep showing the previous image during load

        // Delay showing loading indicator by 250ms to avoid flickering on fast loads
        // If image loads quickly (<250ms), user never sees the loading state
        loadingTimeoutId = window.setTimeout(() => {
          if (isMounted) {
            setLoading(true);
          }
        }, 250);

        logInfo("Fetching image via Axios with auth header", {
          path: currentPath,
          connectionId,
        });

        // Fetch with Axios - this will include Authorization header via interceptor
        const blob = await apiService.getImageBlob(connectionId, currentPath, {
          signal: abortController.signal,
        });

        if (!blob || blob.size === 0) {
          throw new Error("Received empty image blob");
        }

        if (!isMounted) return;

        // Clear the loading timeout since we're done (may not have triggered yet)
        if (loadingTimeoutId !== null) {
          clearTimeout(loadingTimeoutId);
          loadingTimeoutId = null;
        }

        // Create blob URL from response
        blobUrl = URL.createObjectURL(blob);
        logInfo("Created blob URL for image", {
          path: currentPath,
          blobUrl,
          size: blob.size,
        });

        // Update to new image URL - this triggers a re-render with the new image
        setImageUrl(blobUrl);
        setLoading(false);
      } catch (err) {
        if (!isMounted) return;

        // Clear loading timeout on error
        if (loadingTimeoutId !== null) {
          clearTimeout(loadingTimeoutId);
          loadingTimeoutId = null;
        }

        logError("Failed to fetch image", {
          path: currentPath,
          error: err,
        });
        setError("Failed to load image");
        setLoading(false);
      }
    };

    fetchImage();

    // Cleanup: revoke blob URL when component unmounts or image changes
    return () => {
      isMounted = false;
      abortController.abort();

      // Clear any pending loading timeout
      if (loadingTimeoutId !== null) {
        clearTimeout(loadingTimeoutId);
      }

      if (blobUrl) {
        logInfo("Revoking blob URL", { blobUrl });
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [connectionId, currentPath]);

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

  // Handle close
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Keyboard shortcuts for gallery navigation while dialog is open
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      switch (event.key) {
        case "ArrowRight":
        case "d":
        case "D":
          if (images.length > 1) {
            event.preventDefault();
            handleNext();
          }
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          if (images.length > 1) {
            event.preventDefault();
            handlePrevious();
          }
          break;
        case "Home":
          if (images.length > 1) {
            event.preventDefault();
            setCurrentIndex(0);
            setScale(1);
            setRotate(0);
          }
          break;
        case "End":
          if (images.length > 1) {
            event.preventDefault();
            setCurrentIndex(images.length - 1);
            setScale(1);
            setRotate(0);
          }
          break;
        case "+":
        case "=":
          event.preventDefault();
          setScale((value) => Math.min(value * 1.2, 3));
          break;
        case "-":
        case "_":
          event.preventDefault();
          setScale((value) => Math.max(value * 0.8, 0.3));
          break;
        case "r":
          event.preventDefault();
          setRotate((value) => value + 90);
          break;
        case "R":
          event.preventDefault();
          if (event.shiftKey) {
            setRotate((value) => value - 90);
          } else {
            setRotate((value) => value + 90);
          }
          break;
        case "Escape":
          event.preventDefault();
          handleClose();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleClose, handleNext, handlePrevious, images.length]);

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
    <Dialog
      open={true}
      onClose={handleClose}
      maxWidth={false}
      fullScreen
      PaperProps={{
        style: {
          backgroundColor: "rgba(0, 0, 0, 0.9)",
          boxShadow: "none",
        },
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: "100%",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Image Controls Overlay */}
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1,
          }}
        >
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
        </Box>

        {/* Loading state - only show if loading is true AND we don't have an image yet */}
        {loading && !imageUrl && (
          <Box display="flex" flexDirection="column" alignItems="center" gap={2}>
            <CircularProgress />
            <Box color="white">Loading image...</Box>
          </Box>
        )}

        {/* Error state */}
        {error && (
          <Box color="error.main" textAlign="center">
            {error}
          </Box>
        )}

        {/* Image with react-photo-view for zoom functionality */}
        {/* Keep showing image even while loading next one to avoid flicker */}
        {!error && imageUrl && (
          <PhotoProvider>
            <PhotoView src={imageUrl}>
              <img
                src={imageUrl}
                alt={filename}
                style={{
                  maxWidth: "90vw",
                  maxHeight: "90vh",
                  objectFit: "contain",
                  transform: `rotate(${rotate}deg) scale(${scale})`,
                  transition: "transform 0.3s ease",
                  cursor: "zoom-in",
                }}
                onError={handleError}
              />
            </PhotoView>
          </PhotoProvider>
        )}
      </Box>
    </Dialog>
  );
};

export default ImagePreview;
