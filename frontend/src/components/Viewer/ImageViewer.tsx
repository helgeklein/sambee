import { Box, CircularProgress, Dialog } from "@mui/material";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Swiper as SwiperType } from "swiper";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import { COMMON_SHORTCUTS, VIEWER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { useImageGalleryData } from "../../hooks/useImageGalleryData";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import apiService from "../../services/api";
import { error as logError, logger, info as logInfo } from "../../services/logger";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { KeyboardShortcutsHelp } from "../KeyboardShortcutsHelp";
import { ViewerControls } from "./ViewerControls";

/**
 * Detect if the device supports touch input
 */
const isTouchDevice = () => {
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    ((navigator as unknown as { msMaxTouchPoints?: number }).msMaxTouchPoints ?? 0) > 0
  );
};

// Number of slides to preload in each direction
const PRELOAD_COUNT = 5;

// Number of slides to cache in each direction (we cache aggressively)
const CACHE_COUNT = 20;

const ImageViewer: React.FC<ViewerComponentProps> = ({
  connectionId,
  path,
  onClose,
  images = [path],
  currentIndex: initialIndex = 0,
  onCurrentIndexChange,
}) => {
  const touchDevice = isTouchDevice();
  const [rotate, setRotate] = useState(0);
  const [scale, setScale] = useState(1);
  const [_isFullscreen, setIsFullscreen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [hideControls, setHideControls] = useState(false);
  const lastClickTimeRef = useRef<number>(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const swiperRef = useRef<SwiperType | null>(null);
  const mobileLoggingInitialized = useRef(false);
  const failedSwipeFlushTimer = useRef<NodeJS.Timeout | null>(null);
  const isTouching = useRef(false);
  const touchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    currentIndex,
    setCurrentIndex,
    currentPath,
    filename,
    imageCacheRef,
    loadingStates,
    errorStates,
    showLoadingSpinner,
    markCachedImagesAsLoaded,
    abortControllersRef,
  } = useImageGalleryData({
    connectionId,
    images,
    initialIndex,
    onIndexChange: onCurrentIndexChange,
    isTouchDevice: touchDevice,
    preloadRange: PRELOAD_COUNT,
    cacheRange: CACHE_COUNT,
    shouldDeferStateUpdates: () => isTouching.current,
    shouldSuspendPreload: () => isTouching.current,
  });

  //
  // clearTouchState
  //
  /**
   * Reset touch state and clear any pending timeout.
   * Called from onTouchEnd, onTouchCancel, timeout failsafe, and visibility change.
   */
  const clearTouchState = useCallback(() => {
    isTouching.current = false;
    if (touchTimeoutRef.current) {
      clearTimeout(touchTimeoutRef.current);
      touchTimeoutRef.current = null;
    }
  }, []);

  // Failsafe: Reset touch state when page visibility changes or window loses focus
  // This handles cases where browser intervention prevents touch end/cancel events
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isTouching.current) {
        if (isTouchDevice()) {
          logger.warn("Page hidden while touch active - resetting touch state", { timestamp: Date.now() }, "TouchFailsafe");
        }
        clearTouchState();
      }
    };

    const handleBlur = () => {
      if (isTouching.current) {
        if (isTouchDevice()) {
          logger.warn("Window blur while touch active - resetting touch state", { timestamp: Date.now() }, "TouchFailsafe");
        }
        clearTouchState();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      clearTouchState(); // Clean up on unmount
    };
  }, [clearTouchState]);

  // Enable mobile logging if on touch device (only once)
  useEffect(() => {
    if (isTouchDevice() && !mobileLoggingInitialized.current) {
      mobileLoggingInitialized.current = true;
      logger.enableBackendTracing(100, 30000); // 100 logs, 30s flush interval
      logger.info(
        "ImageViewer mounted on touch device",
        {
          imageCount: images.length,
          initialIndex,
        },
        "ImageViewer"
      );
    }
  }, [images.length, initialIndex]);

  // Cleanup mobile logging on unmount
  useEffect(() => {
    return () => {
      if (isTouchDevice() && mobileLoggingInitialized.current) {
        logger.info("ImageViewer unmounting", {}, "ImageViewer");
        void logger.flushBackendTraces();
        logger.disableBackendTracing();
      }
    };
  }, []);

  useEffect(() => {
    if (currentIndex < 0) {
      return;
    }
    setScale(1);
    setRotate(0);
  }, [currentIndex]);

  // Navigation handlers
  const handleNext = useCallback(
    (event?: KeyboardEvent) => {
      event?.preventDefault();
      if (currentIndex < images.length - 1) {
        swiperRef.current?.slideNext();
      }
    },
    [currentIndex, images.length]
  );

  const handlePrevious = useCallback(
    (event?: KeyboardEvent) => {
      event?.preventDefault();
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
    setScale((value) => {
      const newScale = value > 1 ? 1 : Math.min(value * 2, 3);
      if (isTouchDevice()) {
        logger.debug(
          "Scale changed via double-tap",
          {
            oldScale: value,
            newScale,
            timestamp: Date.now(),
          },
          "ImageViewer"
        );
      }
      return newScale;
    });
  }, []);

  // Toggle fullscreen mode for desktop (keyboard shortcut) - does NOT hide controls
  const toggleFullscreenDesktop = useCallback(() => {
    if (!dialogRef.current) return;

    if (!document.fullscreenElement) {
      // Try native fullscreen API
      dialogRef.current.requestFullscreen().catch((err) => {
        logError("Failed to enable fullscreen", { error: err });
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  // Handle Swiper click/tap events
  // Desktop: double-click for zoom only
  // Mobile: double-tap for zoom + fullscreen (with controls hidden)
  const handleSwiperClick = useCallback(() => {
    const now = Date.now();
    const timeSinceLastClick = now - lastClickTimeRef.current;

    if (timeSinceLastClick < 300 && timeSinceLastClick > 0) {
      // Double tap/click detected
      const isTouch = isTouchDevice();
      logInfo("Double tap/click detected", { isTouch });

      handleDoubleZoom();

      // On touch devices, enter fullscreen mode and hide controls
      if (isTouch) {
        logInfo("Entering fullscreen for touch device");

        // If already zoomed (scale > 1), exit fullscreen; otherwise enter it
        if (scale > 1) {
          // Exiting fullscreen - show controls
          setHideControls(false);
        } else {
          // Entering fullscreen - hide controls
          setHideControls(true);
        }
      }

      lastClickTimeRef.current = 0;
    } else {
      // Single tap/click
      lastClickTimeRef.current = now;
    }
  }, [handleDoubleZoom, scale]);

  // Disable/enable Swiper swiping based on zoom level
  useEffect(() => {
    if (swiperRef.current) {
      if (scale > 1) {
        swiperRef.current.allowSlideNext = false;
        swiperRef.current.allowSlidePrev = false;
        logInfo("Swiper sliding disabled (zoomed in)");
      } else {
        swiperRef.current.allowSlideNext = true;
        swiperRef.current.allowSlidePrev = true;
        logInfo("Swiper sliding enabled (zoomed out)");
      }
    }
  }, [scale]);

  // Extra scroll prevention when zoomed - lock body position
  useEffect(() => {
    if (scale > 1) {
      const bodyElement = document.body;
      const scrollY = window.scrollY;

      const originalPosition = bodyElement.style.position;
      const originalTop = bodyElement.style.top;
      const originalWidth = bodyElement.style.width;

      bodyElement.style.position = "fixed";
      bodyElement.style.top = `-${scrollY}px`;
      bodyElement.style.width = "100%";

      return () => {
        bodyElement.style.position = originalPosition;
        bodyElement.style.top = originalTop;
        bodyElement.style.width = originalWidth;
        window.scrollTo(0, scrollY);
      };
    }
  }, [scale]);

  // Prevent body scroll and pull-to-refresh when viewer is open
  useEffect(() => {
    // Save original styles
    const htmlElement = document.documentElement;
    const bodyElement = document.body;

    const originalHtmlOverscroll = htmlElement.style.overscrollBehavior;
    const originalHtmlOverflow = htmlElement.style.overflow;
    const originalHtmlTouchAction = htmlElement.style.touchAction;
    const originalBodyOverflow = bodyElement.style.overflow;
    const originalBodyOverscroll = bodyElement.style.overscrollBehavior;
    const originalBodyTouchAction = bodyElement.style.touchAction;

    // Set on BOTH html and body for maximum compatibility
    htmlElement.style.overscrollBehavior = "none";
    htmlElement.style.overflow = "hidden";
    htmlElement.style.touchAction = "none";
    bodyElement.style.overflow = "hidden";
    bodyElement.style.overscrollBehavior = "none";
    bodyElement.style.touchAction = "none";

    return () => {
      // Restore original styles when component unmounts
      htmlElement.style.overscrollBehavior = originalHtmlOverscroll;
      htmlElement.style.overflow = originalHtmlOverflow;
      htmlElement.style.touchAction = originalHtmlTouchAction;
      bodyElement.style.overflow = originalBodyOverflow;
      bodyElement.style.overscrollBehavior = originalBodyOverscroll;
      bodyElement.style.touchAction = originalBodyTouchAction;
    };
  }, []); // Listen for fullscreen changes (e.g., user pressing F11 or ESC)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Periodic check for stuck Swiper animations
  useEffect(() => {
    if (!isTouchDevice()) return;

    const checkInterval = setInterval(() => {
      const swiper = swiperRef.current;
      if (swiper?.animating) {
        // If animation has been running for more than 2 seconds, it's stuck
        logger.warn(
          "Stuck animation detected - forcing completion",
          {
            activeIndex: swiper.activeIndex,
            currentIndex,
            timestamp: Date.now(),
          },
          "TouchFailsafe"
        );

        // Force completion
        swiper.slideTo(swiper.activeIndex, 0);
        clearTouchState();
        void logger.flushBackendTraces();
      }
    }, 2000); // Check every 2 seconds

    return () => clearInterval(checkInterval);
  }, [currentIndex, clearTouchState]);

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
        handler: toggleFullscreenDesktop,
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
      toggleFullscreenDesktop,
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
    };
  }, []);

  // ImageSlide component for rendering individual carousel slides
  const ImageSlide: React.FC<{ index: number }> = useCallback(
    ({ index }) => {
      const imageUrl = imageCacheRef.current.get(index);
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
            overflow: index === currentIndex && scale > 1 ? "auto" : "hidden",
            overscrollBehavior: "none",
            WebkitOverflowScrolling: "touch",
            touchAction: index === currentIndex && scale > 1 ? "pan-x pan-y pinch-zoom" : "none",
          }}
        >
          {/* Loading state for this slide */}
          {isLoading && showLoadingSpinner && (
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
              decoding="async"
              onError={() => {
                logError("Error loading image in carousel", {
                  index,
                  path: imagePath,
                });
              }}
              sx={{
                maxWidth: index === currentIndex && scale > 1 ? "none" : "100%",
                maxHeight: index === currentIndex && scale > 1 ? "none" : "100%",
                width: index === currentIndex && scale > 1 ? `${scale * 100}%` : "auto",
                height: "auto",
                objectFit: "contain",
                transform: index === currentIndex ? `rotate(${rotate}deg)` : "none",
                transition: index === currentIndex ? "transform 0.3s ease" : "none",
                pointerEvents: index === currentIndex ? "auto" : "none",
              }}
            />
          )}
        </Box>
      );
    },
    [images, loadingStates, errorStates, currentIndex, rotate, scale, showLoadingSpinner, imageCacheRef]
  );

  return (
    <Dialog
      open={true}
      onClose={(_event, reason) => {
        // CRITICAL: On mobile, block ALL automatic close triggers (backdrop clicks, escape key)
        // Mobile Safari can send spurious escape key events during touch gestures
        // Only allow explicit close via the X button (which calls handleClose directly)
        if (isTouchDevice()) {
          if (reason === "backdropClick" || reason === "escapeKeyDown") {
            logger.warn(
              "Dialog close blocked on mobile",
              {
                reason,
                timestamp: Date.now(),
              },
              "DialogSafeguard"
            );
            return;
          }
          // Log any other close reasons for diagnostics
          logger.info(
            "Dialog close allowed on mobile",
            {
              reason,
              timestamp: Date.now(),
            },
            "DialogSafeguard"
          );
        }
        handleClose();
      }}
      maxWidth={false}
      fullScreen
      ref={dialogRef}
      disableScrollLock={false}
      sx={{
        "& .MuiDialog-container": {
          alignItems: "stretch",
          justifyContent: "stretch",
          padding: 0,
          height: "100dvh",
          width: "100dvw",
          overflow: "hidden",
          position: "fixed",
        },
        "& .MuiBackdrop-root": {
          position: "fixed",
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
          position: "fixed",
          top: 0,
          left: 0,
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
          overscrollBehavior: "none",
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
            overscrollBehavior: "none",
            touchAction: "pan-x",
          }}
        >
          <Swiper
            onSwiper={(swiper) => {
              swiperRef.current = swiper;
            }}
            onSlideChange={(swiper) => {
              // Log transition start
              if (isTouchDevice()) {
                logger.debug(
                  "Slide change started",
                  {
                    fromIndex: currentIndex,
                    toIndex: swiper.activeIndex,
                    timestamp: Date.now(),
                  },
                  "Swiper"
                );
              }
            }}
            onSlideChangeTransitionStart={(swiper) => {
              // Log when CSS transition begins
              if (isTouchDevice()) {
                logger.debug(
                  "Slide transition CSS started",
                  {
                    activeIndex: swiper.activeIndex,
                    timestamp: Date.now(),
                  },
                  "Swiper"
                );
              }
            }}
            onSlideChangeTransitionEnd={(swiper) => {
              const newIndex = swiper.activeIndex;

              // Clear failed swipe timer since transition succeeded
              if (failedSwipeFlushTimer.current) {
                clearTimeout(failedSwipeFlushTimer.current);
                failedSwipeFlushTimer.current = null;
              }

              // Safety: Clear any stuck loading states for cached images
              // This prevents the spinner from blocking touches if loading states weren't cleared
              markCachedImagesAsLoaded();

              // Failsafe: If touch state is still active after transition completes,
              // it means onTouchEnd was never fired - reset it now
              if (isTouchDevice() && isTouching.current) {
                logger.warn(
                  "Touch still active after transition end - resetting (onTouchEnd was not fired)",
                  {
                    currentIndex,
                    newIndex,
                    timestamp: Date.now(),
                  },
                  "TouchFailsafe"
                );
                clearTouchState();
              }

              // Log transition end with detailed swiper state
              if (isTouchDevice()) {
                logger.debug(
                  "Slide transition ended",
                  {
                    newIndex,
                    swiperRealIndex: swiper.realIndex,
                    swiperActiveIndex: swiper.activeIndex,
                    currentIndexBefore: currentIndex,
                    isBeginning: swiper.isBeginning,
                    isEnd: swiper.isEnd,
                    animating: swiper.animating,
                    timestamp: Date.now(),
                  },
                  "Swiper"
                );
                // Flush logs after successful transition
                void logger.flushBackendTraces();
              }

              // Update state immediately - RAF was causing issues where the callback
              // would sometimes never fire, leading to swiper freeze
              if (isTouchDevice()) {
                logger.debug(
                  "Setting currentIndex (immediately)",
                  {
                    newIndex,
                    timestamp: Date.now(),
                  },
                  "Swiper"
                );
              }
              setCurrentIndex(newIndex);
              logInfo("Navigated to image via swipe", { index: newIndex });
            }}
            onTouchStart={(swiper) => {
              if (isTouchDevice() && scale === 1) {
                // CRITICAL SAFEGUARD: If animation is in progress, stop it immediately
                // and allow the new touch to proceed
                if (swiper.animating) {
                  logger.warn(
                    "Animation in progress - stopping animation for new touch",
                    {
                      currentIndex,
                      activeIndex: swiper.activeIndex,
                      realIndex: swiper.realIndex,
                      timestamp: Date.now(),
                    },
                    "TouchFailsafe"
                  );

                  // Stop the animation by disabling transitions temporarily
                  const originalTransition = swiper.params.speed;
                  swiper.params.speed = 0;
                  swiper.slideTo(swiper.activeIndex, 0);
                  swiper.params.speed = originalTransition;
                  // Note: We DON'T return here - let the new touch proceed normally
                }

                // Clear any previous timeout first (in case previous touch didn't end properly)
                if (touchTimeoutRef.current) {
                  clearTimeout(touchTimeoutRef.current);
                  touchTimeoutRef.current = null;
                }

                // If touch is already active, previous touch end/cancel was missed
                if (isTouching.current) {
                  logger.warn(
                    "New touch starting while previous touch still active - resetting",
                    {
                      currentIndex,
                      timestamp: Date.now(),
                    },
                    "TouchFailsafe"
                  );
                }

                // Set touch state
                isTouching.current = true;

                // Failsafe: Reset touch state after 5 seconds if no touch end event
                // This handles edge cases where browser intervention prevents touch end/cancel
                touchTimeoutRef.current = setTimeout(() => {
                  if (isTouching.current) {
                    logger.warn(
                      "Touch timeout (5s) - resetting stuck touch state",
                      {
                        currentIndex,
                        timestamp: Date.now(),
                      },
                      "TouchFailsafe"
                    );
                    clearTouchState();
                    void logger.flushBackendTraces();
                  }
                }, 5000);

                // Abort in-flight fetches for images that are NOT already cached and NOT
                // immediately adjacent (current ±1). Already-cached images are safe to display.
                // Adjacent images we need for the swipe, so keep those fetches running.
                const adjacentIndices = new Set([currentIndex - 1, currentIndex, currentIndex + 1]);
                let abortCount = 0;
                for (const [index, controller] of abortControllersRef.current.entries()) {
                  const isAdjacent = adjacentIndices.has(index);
                  const isCached = imageCacheRef.current.has(index);
                  // Abort if: not adjacent AND not already cached
                  if (!isAdjacent && !isCached) {
                    controller.abort();
                    abortControllersRef.current.delete(index);
                    abortCount++;
                  }
                }

                logger.debug(
                  "Touch start on Swiper",
                  {
                    scale,
                    currentIndex,
                    timestamp: Date.now(),
                    abortedFetches: abortCount,
                    swiperState: {
                      activeIndex: swiper.activeIndex,
                      realIndex: swiper.realIndex,
                      animating: swiper.animating,
                      allowSlideNext: swiper.allowSlideNext,
                      allowSlidePrev: swiper.allowSlidePrev,
                    },
                  },
                  "Swiper"
                );
              }
            }}
            onTouchMove={() => {
              // Log periodically during swipe (throttled to avoid spam)
              if (isTouchDevice() && scale === 1 && Math.random() < 0.1) {
                logger.debug(
                  "Touch move during swipe",
                  {
                    currentIndex,
                    timestamp: Date.now(),
                  },
                  "Swiper"
                );
              }
            }}
            onTouchEnd={() => {
              if (isTouchDevice() && scale === 1) {
                const swiper = swiperRef.current;

                // Reset touch state immediately and clear timeout
                clearTouchState();

                logger.debug(
                  "Touch end on Swiper",
                  {
                    currentIndex,
                    timestamp: Date.now(),
                    swiperState: swiper
                      ? {
                          activeIndex: swiper.activeIndex,
                          realIndex: swiper.realIndex,
                          animating: swiper.animating,
                          allowSlideNext: swiper.allowSlideNext,
                          allowSlidePrev: swiper.allowSlidePrev,
                          isBeginning: swiper.isBeginning,
                          isEnd: swiper.isEnd,
                        }
                      : null,
                  },
                  "Swiper"
                );

                // Update loading states for any images that finished during the touch
                // Now that touch is complete, these updates will be visible immediately
                if (isTouchDevice()) {
                  logger.debug(
                    "Updated loading states after touch end",
                    {
                      timestamp: Date.now(),
                    },
                    "ImageLoader"
                  );
                }
                markCachedImagesAsLoaded();

                // Set timer to flush logs if no slide change occurs within 1 second
                // (this captures failed swipes)
                if (failedSwipeFlushTimer.current) {
                  clearTimeout(failedSwipeFlushTimer.current);
                }
                failedSwipeFlushTimer.current = setTimeout(() => {
                  logger.debug(
                    "No slide change after touch end - possible failed swipe",
                    {
                      currentIndex,
                      timestamp: Date.now(),
                    },
                    "Swiper"
                  );
                  void logger.flushBackendTraces();
                }, 1000);
              }
            }}
            onTouchCancel={() => {
              if (isTouchDevice() && scale === 1) {
                // Reset touch state immediately and clear timeout
                clearTouchState();

                logger.warn(
                  "Touch CANCELLED on Swiper",
                  {
                    currentIndex,
                    timestamp: Date.now(),
                  },
                  "Swiper"
                );
                // Flush logs immediately to capture cancellation
                void logger.flushBackendTraces();
              }
            }}
            onClick={handleSwiperClick}
            initialSlide={initialIndex} // Start at the selected image
            spaceBetween={32} // 32px gap between slides for visual separation
            slidesPerView={1} // Show one image at a time (not multiple)
            centeredSlides={true} // Keep active slide centered in viewport
            speed={400} // Slide transition duration: 400ms (smooth but responsive)
            cssMode={false} // Use JavaScript for sliding (more control than CSS transforms)
            keyboard={{ enabled: false }} // Disable Swiper's keyboard nav (we handle it ourselves)
            allowTouchMove={scale === 1} // Enable swiping only when not zoomed in
            simulateTouch={scale === 1} // Enable mouse dragging only when not zoomed in
            touchRatio={scale === 1 ? 1 : 0} // Touch movement ratio: 1:1 when not zoomed, 0 when zoomed (no sliding)
            threshold={scale > 1 ? 50 : 10} // Min swipe distance to trigger slide: 10px normal, 50px zoomed (prevent accidental swipes)
            resistanceRatio={0} // No resistance at edges (slides stop immediately)
            preventInteractionOnTransition={false} // Allow new swipes during the 400ms transition (enables rapid swiping)
            passiveListeners={false} // Use active event listeners for preventDefault capability
            touchStartPreventDefault={false} // Don't prevent default on touch start (allows browser's native behavior)
            touchStartForcePreventDefault={false} // Don't force prevent default (allows scrolling when zoomed)
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
