import { Box, CircularProgress, Dialog } from "@mui/material";
import type { MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Swiper as SwiperType } from "swiper";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import { COMMON_SHORTCUTS, VIEWER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { checkIsTransientError, getTransientErrorMessage, useApiRetry } from "../../hooks/useApiRetry";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import apiService from "../../services/api";
import { error as logError, info as logInfo } from "../../services/logger";
import { isApiError } from "../../types";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { KeyboardShortcutsHelp } from "../KeyboardShortcutsHelp";
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
  const [_isFullscreen, setIsFullscreen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [hideControls, setHideControls] = useState(false);
  const lastClickTimeRef = useRef<number>(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const swiperRef = useRef<SwiperType | null>(null);

  // Carousel image caching
  const imageCache = useRef<Map<number, string>>(new Map());
  const [_cachedIndices, setCachedIndices] = useState<Set<number>>(new Set());
  const [loadingStates, setLoadingStates] = useState<Map<number, boolean>>(new Map());
  const [errorStates, setErrorStates] = useState<Map<number, string | null>>(new Map());

  // Abort controllers for ongoing fetches
  const abortControllers = useRef<Map<number, AbortController>>(new Map());
  const fetchWithRetry = useApiRetry();

  // Get current image path
  const currentPath = images[currentIndex];
  const filename = currentPath.split("/").pop() || currentPath;

  useEffect(() => {
    setScale(1);
    setRotate(0);
    onCurrentIndexChange?.(currentIndex);
  }, [currentIndex, onCurrentIndexChange]);

  // Function to fetch and cache a single image
  const fetchAndCacheImage = useCallback(
    async (index: number) => {
      if (index < 0 || index >= images.length) return;
      if (imageCache.current.has(index)) return;
      if (loadingStates.get(index)) return; // Already loading

      // Cancel any existing fetch for this index
      const existingController = abortControllers.current.get(index);
      if (existingController) {
        existingController.abort();
      }

      const abortController = new AbortController();
      abortControllers.current.set(index, abortController);

      setLoadingStates((prev) => new Map(prev).set(index, true));
      setErrorStates((prev) => new Map(prev).set(index, null));

      try {
        const imagePath = images[index];
        logInfo("Fetching image for carousel", {
          index,
          path: imagePath,
          connectionId,
        });

        const blob = await fetchWithRetry(
          () =>
            apiService.getImageBlob(connectionId, imagePath, {
              signal: abortController.signal,
            }),
          {
            signal: abortController.signal,
            maxRetries: 1,
            retryDelay: 1000,
          }
        );

        if (!blob || blob.size === 0) {
          throw new Error("Received empty image blob");
        }

        const blobUrl = URL.createObjectURL(blob);
        imageCache.current.set(index, blobUrl);
        setCachedIndices((prev) => new Set(prev).add(index));

        logInfo("Cached image for carousel", {
          index,
          blobUrl,
          size: blob.size,
        });

        setLoadingStates((prev) => new Map(prev).set(index, false));
      } catch (err) {
        if (abortController.signal.aborted) {
          logInfo("Image fetch aborted", { index });
          return;
        }

        logError("Failed to fetch image for carousel", {
          index,
          error: err,
          detail: isApiError(err) ? err.response?.data?.detail : undefined,
          status: isApiError(err) ? err.response?.status : undefined,
        });

        // Show "server busy" only for actual transient/network errors
        // For other errors, show the specific error message from backend
        const errorMessage = checkIsTransientError(err) ? getTransientErrorMessage() : getErrorMessage(err);

        setErrorStates((prev) => new Map(prev).set(index, errorMessage));
        setLoadingStates((prev) => new Map(prev).set(index, false));
      } finally {
        abortControllers.current.delete(index);
      }
    },
    [connectionId, images, loadingStates, fetchWithRetry]
  );

  // Preload current and adjacent images
  useEffect(() => {
    const indicesToLoad = [
      currentIndex - 1, // Previous
      currentIndex, // Current
      currentIndex + 1, // Next
    ].filter((i) => i >= 0 && i < images.length);

    indicesToLoad.forEach((index) => {
      fetchAndCacheImage(index);
    });
  }, [currentIndex, images.length, fetchAndCacheImage]);

  // Cleanup: revoke blob URLs for images far from current position
  useEffect(() => {
    const activeRange = 2; // Keep ±2 images cached
    const indicesToKeep = new Set(
      Array.from({ length: activeRange * 2 + 1 }, (_, i) => currentIndex - activeRange + i).filter((i) => i >= 0 && i < images.length)
    );

    imageCache.current.forEach((url, index) => {
      if (!indicesToKeep.has(index)) {
        logInfo("Revoking blob URL for distant image", { index, url });
        URL.revokeObjectURL(url);
        imageCache.current.delete(index);
        setCachedIndices((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
      }
    });
  }, [currentIndex, images.length]);

  // Navigation handlers
  const handleNext = useCallback(
    (_event?: KeyboardEvent) => {
      if (currentIndex < images.length - 1) {
        swiperRef.current?.slideNext();
      }
    },
    [currentIndex, images.length]
  );

  const handlePrevious = useCallback(
    (_event?: KeyboardEvent) => {
      if (currentIndex > 0) {
        swiperRef.current?.slidePrev();
      }
    },
    [currentIndex]
  );

  // Handle close
  const handleClose = useCallback(
    (_event?: KeyboardEvent) => {
      onClose();
    },
    [onClose]
  );

  // Zoom handlers
  const handleZoomIn = useCallback((_event?: KeyboardEvent) => {
    setScale((value) => Math.min(value * 1.2, 3));
  }, []);

  const handleZoomOut = useCallback((_event?: KeyboardEvent) => {
    setScale((value) => Math.max(value * 0.8, 0.3));
  }, []);

  const handleZoomReset = useCallback((_event?: KeyboardEvent) => {
    setScale(1);
  }, []);

  // Rotation handlers
  const handleRotateRight = useCallback((_event?: KeyboardEvent) => {
    setRotate((value) => value + 90);
  }, []);

  const handleRotateLeft = useCallback((_event?: KeyboardEvent) => {
    setRotate((value) => value - 90);
  }, []);

  // Navigation handlers for gallery
  const handleFirst = useCallback(
    (_event?: KeyboardEvent) => {
      if (images.length > 1) {
        swiperRef.current?.slideTo(0);
      }
    },
    [images.length]
  );

  const handleLast = useCallback(
    (_event?: KeyboardEvent) => {
      if (images.length > 1) {
        swiperRef.current?.slideTo(images.length - 1);
      }
    },
    [images.length]
  );

  // Download handler
  const handleDownload = useCallback(
    async (_event?: KeyboardEvent) => {
      try {
        await apiService.downloadFile(connectionId, currentPath, filename);
      } catch (err) {
        logError("Failed to download file", { error: err, path: currentPath, connectionId });
      }
    },
    [connectionId, currentPath, filename]
  );

  // Context-aware Escape handler
  const handleEscape = useCallback(
    (_event?: KeyboardEvent) => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        handleClose();
      }
    },
    [handleClose]
  );

  const handleDoubleZoom = useCallback(() => {
    setScale((value) => (value > 1 ? 1 : Math.min(value * 2, 3)));
  }, []);

  // Toggle fullscreen mode
  const toggleFullscreen = useCallback(() => {
    if (!dialogRef.current) return;

    if (!document.fullscreenElement) {
      // Try native fullscreen API
      dialogRef.current.requestFullscreen().catch((err) => {
        logError("Failed to enable fullscreen", { error: err });
      });
    } else {
      document.exitFullscreen();
    }

    // Toggle controls visibility for mobile (works even if fullscreen API fails)
    setHideControls((prev) => {
      const newValue = !prev;
      logInfo("Toggling controls visibility", { hideControls: newValue });
      return newValue;
    });
  }, []);

  // Handle Swiper click/tap events (works on mobile without interfering with swipe)
  const handleSwiperClick = useCallback(() => {
    const now = Date.now();
    const timeSinceLastClick = now - lastClickTimeRef.current;

    if (timeSinceLastClick < 300 && timeSinceLastClick > 0) {
      // Double tap/click detected
      handleDoubleZoom();
      toggleFullscreen();
      lastClickTimeRef.current = 0;
    } else {
      // Single tap/click
      lastClickTimeRef.current = now;
    }
  }, [handleDoubleZoom, toggleFullscreen]);

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

  const handleShowHelp = useCallback(() => {
    setShowHelp(true);
  }, []);

  // Keyboard shortcuts using centralized system
  const imageShortcuts = useMemo(
    () => [
      // Download
      {
        ...COMMON_SHORTCUTS.DOWNLOAD,
        handler: handleDownload,
      },
      // Navigation - Arrow keys
      {
        ...COMMON_SHORTCUTS.NEXT_ARROW,
        handler: handleNext,
        enabled: images.length > 1,
      },
      {
        ...COMMON_SHORTCUTS.PREVIOUS_ARROW,
        handler: handlePrevious,
        enabled: images.length > 1,
      },
      // Navigation - Home/End
      {
        ...COMMON_SHORTCUTS.FIRST_PAGE,
        description: "First image",
        handler: handleFirst,
        enabled: images.length > 1,
      },
      {
        ...COMMON_SHORTCUTS.LAST_PAGE,
        description: "Last image",
        handler: handleLast,
        enabled: images.length > 1,
      },
      // Zoom
      {
        ...VIEWER_SHORTCUTS.ZOOM_IN,
        handler: handleZoomIn,
      },
      {
        ...VIEWER_SHORTCUTS.ZOOM_OUT,
        handler: handleZoomOut,
      },
      {
        ...VIEWER_SHORTCUTS.ZOOM_RESET,
        handler: handleZoomReset,
      },
      // Rotation
      {
        ...VIEWER_SHORTCUTS.ROTATE_RIGHT,
        handler: handleRotateRight,
      },
      {
        ...VIEWER_SHORTCUTS.ROTATE_LEFT,
        handler: handleRotateLeft,
      },
      // Fullscreen
      {
        ...VIEWER_SHORTCUTS.FULLSCREEN,
        handler: toggleFullscreen,
      },
      // Close viewer or exit fullscreen on Escape
      {
        ...COMMON_SHORTCUTS.CLOSE,
        handler: handleEscape,
      },
      // Show help
      {
        id: "show-help",
        keys: ["?"],
        label: "?",
        description: "Show keyboard shortcuts",
        handler: handleShowHelp,
      },
    ],
    [
      handleDownload,
      handleNext,
      handlePrevious,
      handleFirst,
      handleLast,
      images.length,
      handleZoomIn,
      handleZoomOut,
      handleZoomReset,
      handleRotateRight,
      handleRotateLeft,
      toggleFullscreen,
      handleEscape,
      handleShowHelp,
    ]
  );

  useKeyboardShortcuts({
    shortcuts: imageShortcuts,
  });

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

      // Abort any ongoing fetches
      for (const controller of abortControllers.current.values()) {
        controller.abort();
      }
      abortControllers.current.clear();

      // Revoke all blob URLs
      imageCache.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      imageCache.current.clear();
    };
  }, []);

  // ImageSlide component for rendering individual carousel slides
  const ImageSlide: React.FC<{ index: number }> = useCallback(
    ({ index }) => {
      const imageUrl = imageCache.current.get(index);
      const isLoading = loadingStates.get(index);
      const error = errorStates.get(index);
      const imagePath = images[index];
      const slideFilename = imagePath?.split("/").pop() || "";

      return (
        <Box
          sx={{
            width: "100%",
            height: "100%",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {/* Loading state for this slide */}
          {isLoading && (
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              position="absolute"
              sx={{
                backgroundColor: "rgba(0, 0, 0, 0.3)",
              }}
            >
              <CircularProgress />
            </Box>
          )}

          {/* Error state for this slide */}
          {error && (
            <Box color="error.main" textAlign="center" px={2}>
              {error}
            </Box>
          )}

          {/* Image */}
          {!error && imageUrl && (
            <Box
              component="img"
              src={imageUrl}
              alt={slideFilename}
              onError={() => {
                logError("Error loading image in carousel", {
                  index,
                  path: imagePath,
                });
              }}
              onDoubleClick={index === currentIndex ? handleDoubleClick : undefined}
              sx={{
                maxWidth: "100%",
                maxHeight: "100%",
                width: "auto",
                height: "auto",
                objectFit: "contain",
                transform: index === currentIndex ? `rotate(${rotate}deg) scale(${scale})` : "none",
                transition: index === currentIndex ? "transform 0.3s ease" : "none",
                pointerEvents: index === currentIndex ? "auto" : "none",
              }}
            />
          )}
        </Box>
      );
    },
    [images, loadingStates, errorStates, currentIndex, rotate, scale, handleDoubleClick]
  );

  return (
    <Dialog
      open={true}
      onClose={handleClose}
      maxWidth={false}
      fullScreen
      ref={dialogRef}
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
        {!hideControls && (
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
                onZoomIn: handleZoomIn,
                onZoomOut: handleZoomOut,
              }}
              rotation={{
                onRotateLeft: handleRotateLeft,
                onRotateRight: handleRotateRight,
              }}
            />
          </Box>
        )}

        {/* Carousel container - horizontal scrolling */}
        <Box
          sx={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            minHeight: 0,
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <Swiper
            onSwiper={(swiper) => {
              swiperRef.current = swiper;
            }}
            onSlideChange={(swiper) => {
              const newIndex = swiper.activeIndex;
              setCurrentIndex(newIndex);
              logInfo("Navigated to image via swipe", { index: newIndex });
            }}
            onClick={handleSwiperClick}
            initialSlide={initialIndex}
            spaceBetween={32}
            slidesPerView={1}
            centeredSlides={true}
            style={{ height: "100%", width: "100%" }}
          >
            {images.map((_imagePath, index) => (
              <SwiperSlide key={`slide-${images[index]}`}>
                <ImageSlide index={index} />
              </SwiperSlide>
            ))}
          </Swiper>
        </Box>
      </Box>
      <KeyboardShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} shortcuts={imageShortcuts} title="Image Viewer Shortcuts" />
    </Dialog>
  );
};

export default ImageViewer;
