import { Box, CircularProgress } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Lightbox, { type Slide } from "yet-another-react-lightbox";
import Fullscreen from "yet-another-react-lightbox/plugins/fullscreen";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

import { COMMON_SHORTCUTS, VIEWER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { useCachedImageGallery } from "../../hooks/useCachedImageGallery";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import apiService from "../../services/api";
import { error as logError, info as logInfo } from "../../services/logger";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { KeyboardShortcutsHelp } from "../KeyboardShortcutsHelp";
import { ViewerControls } from "./ViewerControls";

type ZoomRef = import("yet-another-react-lightbox").ZoomRef;
type FullscreenRef = import("yet-another-react-lightbox").FullscreenRef;
interface LightboxImageSlide extends Slide {
  imageIndex: number;
  originalPath: string;
}

const isTouchDevice = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return (
    "ontouchstart" in window ||
    (nav?.maxTouchPoints ?? 0) > 0 ||
    ((nav as unknown as { msMaxTouchPoints?: number })?.msMaxTouchPoints ?? 0) > 0
  );
};

const activeViewerSessions = new Set<string>();
const viewerSessionCloseTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Slide spacing for mobile-style transitions where both slides are visible
const SLIDE_GAP_PX = 32;

// Number of slides to preload in each direction (matches Lightbox carousel.preload)
const PRELOAD_COUNT = 5;

// Number of slides to cache in each direction (we cache aggressively)
const CACHE_COUNT = 20;

// Transparent 1x1 pixel PNG as placeholder to avoid broken image icon while loading
const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const YarlImageViewer: React.FC<ViewerComponentProps> = ({
  connectionId,
  path,
  onClose,
  images = [path],
  currentIndex: initialIndex = 0,
  onCurrentIndexChange,
  sessionId,
}) => {
  const [rotate, setRotate] = useState(0);
  const [hideControls, setHideControls] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const zoomRef = useRef<ZoomRef | null>(null);
  const fullscreenRef = useRef<FullscreenRef | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);

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
  } = useCachedImageGallery({
    connectionId,
    images,
    initialIndex,
    onIndexChange: onCurrentIndexChange,
    isTouchDevice: isTouchDevice(),
    preloadRange: PRELOAD_COUNT,
    cacheRange: CACHE_COUNT,
  });
  const viewerSessionMetaRef = useRef({
    filename,
    gallerySize: images.length,
  });

  useEffect(() => {
    viewerSessionMetaRef.current = {
      filename,
      gallerySize: images.length,
    };
  }, [filename, images.length]);

  useEffect(() => {
    if (currentIndex < 0) {
      return;
    }

    setRotate(0);
    setHideControls(false);
    zoomRef.current?.changeZoom(1, true);
  }, [currentIndex]);

  useEffect(() => {
    const meta = viewerSessionMetaRef.current;

    if (sessionId) {
      const pendingTimer = viewerSessionCloseTimers.get(sessionId);
      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
        viewerSessionCloseTimers.delete(sessionId);
      }

      if (!activeViewerSessions.has(sessionId)) {
        activeViewerSessions.add(sessionId);
        logInfo("YARL image viewer opened", meta);
      }
    } else {
      logInfo("YARL image viewer opened", meta);
    }

    return () => {
      if (sessionId) {
        const timer = setTimeout(() => {
          logInfo("YARL image viewer closed");
          viewerSessionCloseTimers.delete(sessionId);
          activeViewerSessions.delete(sessionId);
        }, 0);
        viewerSessionCloseTimers.set(sessionId, timer);
      } else {
        logInfo("YARL image viewer closed");
      }
    };
  }, [sessionId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadingStates/errorStates trigger re-render when images load (imageCacheRef is a ref)
  const slides = useMemo<LightboxImageSlide[]>(() => {
    return images.map((imagePath, index) => ({
      type: "image",
      src: imageCacheRef.current.get(index) ?? TRANSPARENT_PIXEL,
      alt: imagePath.split("/").pop() ?? imagePath,
      imageIndex: index,
      originalPath: imagePath,
    }));
  }, [images, imageCacheRef, loadingStates, errorStates]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleViewChange = useCallback(
    ({ index }: { index: number }) => {
      // Lightbox handles its own navigation - sync our state with it
      if (index !== currentIndex) {
        setCurrentIndex(index);
      }
      markCachedImagesAsLoaded();
    },
    [currentIndex, setCurrentIndex, markCachedImagesAsLoaded]
  );

  const handleZoomChange = useCallback(({ zoom }: { zoom: number }) => {
    // Auto-hide controls when zoomed in, but only if in fullscreen mode
    // On desktop (non-fullscreen), keep controls visible so user can zoom out via toolbar
    const isFullscreen = fullscreenRef.current?.fullscreen ?? false;

    if (zoom > 1.01 && isFullscreen) {
      setHideControls(true);
    } else if (zoom <= 1.01) {
      setHideControls(false);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    try {
      await apiService.downloadFile(connectionId, currentPath, filename);
    } catch (err) {
      logError("Failed to download file", { error: err, path: currentPath, connectionId });
    }
  }, [connectionId, currentPath, filename]);

  const handleRotateLeft = useCallback(() => {
    setRotate((value) => value - 90);
  }, []);

  const handleRotateRight = useCallback(() => {
    setRotate((value) => value + 90);
  }, []);

  const handleZoomIn = useCallback(() => {
    zoomRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    zoomRef.current?.zoomOut();
  }, []);

  const handleZoomReset = useCallback(() => {
    zoomRef.current?.changeZoom(1, true);
    setHideControls(false);
  }, []);

  const handleShowHelp = useCallback(() => {
    setShowHelp(true);
  }, []);

  const handleNavigateNext = useCallback(() => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, images.length, setCurrentIndex]);

  const handleNavigatePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex, setCurrentIndex]);

  const handleToggleFullscreen = useCallback(() => {
    if (fullscreenRef.current?.fullscreen) {
      fullscreenRef.current?.exit();
    } else {
      fullscreenRef.current?.enter();
    }
  }, []);

  const renderSlideContainer = useCallback(
    ({ children }: { children?: React.ReactNode }) => (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          transform: `rotate(${rotate}deg)`,
        }}
      >
        {children}
      </Box>
    ),
    [rotate]
  );

  const renderSlideHeader = useCallback(
    ({ slide }: { slide: Slide }) => {
      const typedSlide = slide as LightboxImageSlide;
      const imageIndex = typedSlide.imageIndex;
      const isLoading = loadingStates.get(imageIndex);
      const error = errorStates.get(imageIndex);

      return (
        <>
          {isLoading && showLoadingSpinner && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(0,0,0,0.3)",
                zIndex: 2,
                pointerEvents: "none",
              }}
            >
              <CircularProgress />
            </Box>
          )}

          {error && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 2,
                pointerEvents: "none",
              }}
            >
              <Box color="error.main" textAlign="center" px={2}>
                {error}
              </Box>
            </Box>
          )}
        </>
      );
    },
    [errorStates, loadingStates, showLoadingSpinner]
  );

  const imageShortcuts = useMemo(
    () => [
      {
        ...COMMON_SHORTCUTS.DOWNLOAD,
        handler: handleDownload,
      },
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
      {
        ...VIEWER_SHORTCUTS.ROTATE_RIGHT,
        handler: handleRotateRight,
      },
      {
        ...VIEWER_SHORTCUTS.ROTATE_LEFT,
        handler: handleRotateLeft,
      },
      {
        ...VIEWER_SHORTCUTS.FULLSCREEN,
        handler: handleToggleFullscreen,
      },
      {
        ...COMMON_SHORTCUTS.CLOSE,
        handler: handleClose,
      },
      {
        id: "show-help",
        keys: ["?"],
        label: "?",
        description: "Show keyboard shortcuts",
        handler: handleShowHelp,
      },
    ],
    [
      handleClose,
      handleDownload,
      handleRotateLeft,
      handleRotateRight,
      handleShowHelp,
      handleToggleFullscreen,
      handleZoomIn,
      handleZoomOut,
      handleZoomReset,
    ]
  );

  useKeyboardShortcuts({
    shortcuts: imageShortcuts,
  });

  return (
    <>
      {/* Full viewport overlay to hide browser UI */}
      <Box
        sx={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.95)",
          zIndex: 1300, // MUI Dialog z-index
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Our toolbar at top */}
        {!hideControls && (
          <Box
            sx={{
              flexShrink: 0,
              zIndex: 10,
            }}
          >
            <ViewerControls
              filename={filename}
              config={{
                navigation: images.length > 1,
                zoom: true,
                rotation: true,
                download: true,
              }}
              onClose={handleClose}
              navigation={
                images.length > 1
                  ? {
                      currentIndex,
                      totalItems: images.length,
                      onNext: handleNavigateNext,
                      onPrevious: handleNavigatePrevious,
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
              onDownload={handleDownload}
            />
          </Box>
        )}

        {/* YARL container - fills remaining space below toolbar */}
        <Box
          ref={portalRef}
          sx={{
            flex: 1,
            position: "relative",
          }}
        >
          <Lightbox
            open={true}
            close={handleClose}
            index={currentIndex}
            slides={slides}
            portal={{ root: portalRef.current }}
            render={{
              slideContainer: renderSlideContainer,
              slideHeader: renderSlideHeader,
              buttonPrev: () => null,
              buttonNext: () => null,
              buttonClose: () => null,
              iconPrev: () => null,
              iconNext: () => null,
              controls: () => null, // Controls rendered outside YARL now
            }}
            toolbar={{ buttons: [] }}
            controller={{}}
            carousel={{
              finite: true,
              padding: 0,
              spacing: SLIDE_GAP_PX,
              imageFit: "contain",
              preload: PRELOAD_COUNT,
              imageProps: {
                style: {
                  maxWidth: "100%",
                  maxHeight: "100%",
                },
              },
            }}
            animation={{
              fade: 0,
              swipe: 400,
            }}
            styles={{
              root: {
                backgroundColor: "transparent", // Parent handles background
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
              },
              toolbar: {
                display: "none", // Hide YARL's toolbar completely
              },
              slide: {
                // Allow images to scale up to fill viewport (removes YARL's max-width/max-height limits)
                maxWidth: "100% !important",
                maxHeight: "100% !important",
              },
            }}
            on={{
              view: handleViewChange,
              zoom: handleZoomChange,
            }}
            plugins={[Fullscreen, Zoom]}
            fullscreen={{
              ref: fullscreenRef,
            }}
            zoom={{
              ref: zoomRef,
              scrollToZoom: true, // Allow scroll wheel to zoom
              pinchZoomV4: true,
              maxZoomPixelRatio: 3, // Allow up to 3x upscaling for closer inspection
            }}
          />
        </Box>
      </Box>

      <KeyboardShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} shortcuts={imageShortcuts} title="Image Viewer Shortcuts" />
    </>
  );
};
export default YarlImageViewer;
