import { Box, CircularProgress, Dialog } from "@mui/material";
import type { MouseEvent, TouchEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import apiService from "../../services/api";
import { error as logError, info as logInfo } from "../../services/logger";
import { isApiError } from "../../types";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { ViewerControls } from "./ViewerControls";

/**
 * Extract error message from API error or exception
 */
const getErrorMessage = (err: unknown): string => {
  // Check if it's an Axios API error with backend response
  if (isApiError(err) && err.response?.data?.detail) {
    // Return backend error directly - it already has context
    return err.response.data.detail;
  }

  // Check for Axios error message (e.g., "Request failed with status code 422")
  // This happens when the detail field is not properly extracted
  if (isApiError(err) && err.message) {
    // If it's a generic axios message but we have response data, extract detail
    if (err.response?.data) {
      const data = err.response.data as Record<string, unknown>;
      if (typeof data.detail === "string") {
        // Return backend error directly - it already has context
        return data.detail;
      }
    }
    return `Failed to load image: ${err.message}`;
  }

  // Generic fallback
  return "Failed to load image";
};

/**
 * Image Viewer Component
 * Displays images with zoom, pan, rotate, and gallery navigation features.
 * Uses react-photo-view for advanced image viewing capabilities.
 * Fetches images via Axios to include authentication headers, then creates blob URLs.
 */
const ImageViewer: React.FC<ViewerComponentProps> = ({
  connectionId,
  path,
  onClose,
  images = [path],
  currentIndex: initialIndex = 0,
  onCurrentIndexChange,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [rotate, setRotate] = useState(0);
  const [scale, setScale] = useState(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [_isFullscreen, setIsFullscreen] = useState(false);
  const lastTapRef = useRef<number>(0);

  // Get current image path
  const currentPath = images[currentIndex];
  const filename = currentPath.split("/").pop() || currentPath;

  useEffect(() => {
    setScale(1);
    setRotate(0);
    onCurrentIndexChange?.(currentIndex);
  }, [currentIndex, onCurrentIndexChange]);

  // Fetch image via Axios to include Authorization header, then create blob URL
  useEffect(() => {
    let isMounted = true;
    let blobUrl: string | null = null;
    const abortController = new AbortController();

    const fetchImage = async () => {
      try {
        setError(null);
        setLoading(true);
        // Don't clear imageUrl yet - keep showing the previous image during load

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

        // Extract detailed error message from backend or network error
        const errorMessage = getErrorMessage(err);

        logError("Failed to fetch image", {
          path: currentPath,
          error: err,
          detail: isApiError(err) ? err.response?.data?.detail : undefined,
          status: isApiError(err) ? err.response?.status : undefined,
        });
        setError(errorMessage);
        setLoading(false);
      }
    };

    fetchImage();

    // Cleanup: revoke blob URL when component unmounts or image changes
    return () => {
      isMounted = false;
      abortController.abort();

      if (blobUrl) {
        logInfo("Revoking blob URL", { blobUrl });
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [connectionId, currentPath]);

  // Navigation handlers
  const handleNext = useCallback(() => {
    if (currentIndex < images.length - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      logInfo("Navigated to next image", { index: nextIndex });
    }
  }, [currentIndex, images.length]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      logInfo("Navigated to previous image", { index: prevIndex });
    }
  }, [currentIndex]);

  // Handle close
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleDoubleZoom = useCallback(() => {
    setScale((value) => (value > 1 ? 1 : Math.min(value * 2, 3)));
  }, []);

  const handleTouchEnd = useCallback(
    (event: TouchEvent<HTMLImageElement>) => {
      if (event.touches.length > 0 || event.changedTouches.length !== 1) {
        return;
      }

      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        event.preventDefault();
        handleDoubleZoom();
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    },
    [handleDoubleZoom]
  );

  // Toggle fullscreen mode
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        // Enter fullscreen
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
        logInfo("Entered fullscreen mode");
      } else {
        // Exit fullscreen
        await document.exitFullscreen();
        setIsFullscreen(false);
        logInfo("Exited fullscreen mode");
      }
    } catch (err) {
      logError("Failed to toggle fullscreen", { error: err });
    }
  }, []);

  const handleDoubleClick = useCallback(
    (event: MouseEvent<HTMLImageElement>) => {
      event.preventDefault();
      toggleFullscreen();
    },
    [toggleFullscreen]
  );

  // Listen for fullscreen changes (e.g., user pressing F11 or ESC)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Keyboard shortcuts for gallery navigation while dialog is open
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      switch (event.key) {
        case "Enter":
          event.preventDefault();
          toggleFullscreen();
          break;
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
        case "ArrowUp":
        case "ArrowDown":
          // Prevent default scrolling behavior on mobile when image viewer is open
          event.preventDefault();
          break;
        case "Home":
          if (images.length > 1) {
            event.preventDefault();
            setCurrentIndex(0);
          }
          break;
        case "End":
          if (images.length > 1) {
            event.preventDefault();
            setCurrentIndex(images.length - 1);
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
          // If in fullscreen, exit fullscreen first, otherwise close dialog
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            handleClose();
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
  }, [handleClose, handleNext, handlePrevious, images.length, toggleFullscreen]);

  // Log when image viewer opens
  useEffect(() => {
    logInfo("Image viewer opened", {
      filename,
      gallerySize: images.length,
      isGallery: images.length > 1,
    });
  }, [filename, images.length]);

  // Cleanup when component unmounts
  useEffect(() => {
    return () => {
      logInfo("Image viewer closed");
      // Exit fullscreen if still active when component unmounts
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    };
  }, []);

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
      sx={{
        "& .MuiDialog-container": {
          alignItems: "stretch",
          justifyContent: "stretch",
          padding: 0,
          height: "100dvh",
          width: "100dvw",
        },
      }}
      PaperProps={{
        sx: {
          backgroundColor: "rgba(0, 0, 0, 0.9)",
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
        {/* Image Controls Overlay */}
        <Box
          sx={{
            flexShrink: 0,
            zIndex: 1,
          }}
        >
          <ViewerControls
            filename={filename}
            config={{
              navigation: images.length > 1,
              zoom: true,
              rotation: true,
            }}
            onClose={handleClose}
            navigation={
              images.length > 1
                ? {
                    currentIndex,
                    totalItems: images.length,
                    onNext: handleNext,
                    onPrevious: handlePrevious,
                  }
                : undefined
            }
            zoom={{
              onZoomIn: () => setScale(scale * 1.2),
              onZoomOut: () => setScale(scale * 0.8),
            }}
            rotation={{
              onRotateLeft: () => setRotate(rotate - 90),
              onRotateRight: () => setRotate(rotate + 90),
            }}
          />
        </Box>

        {/* Image content area - flex grows to fill remaining space */}
        <Box
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            minHeight: 0, // Important for flex child with overflow
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          {/* Loading state - show spinner when loading */}
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
                backgroundColor: imageUrl ? "rgba(0, 0, 0, 0.3)" : "transparent",
              }}
            >
              <CircularProgress />
            </Box>
          )}

          {/* Error state */}
          {error && (
            <Box color="error.main" textAlign="center">
              {error}
            </Box>
          )}

          {/* Image with zoom, pan, and rotate functionality */}
          {/* Keep showing image even while loading next one to avoid flicker */}
          {!error && imageUrl && (
            <Box
              component="img"
              src={imageUrl}
              alt={filename}
              onError={handleError}
              onDoubleClick={handleDoubleClick}
              onTouchEnd={handleTouchEnd}
              sx={{
                maxWidth: "100%",
                maxHeight: "100%",
                width: "auto",
                height: "auto",
                objectFit: "contain",
                transform: `rotate(${rotate}deg) scale(${scale})`,
                transition: "transform 0.3s ease",
              }}
            />
          )}
        </Box>
      </Box>
    </Dialog>
  );
};

export default ImageViewer;
