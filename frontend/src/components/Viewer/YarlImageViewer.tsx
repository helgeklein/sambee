import { Box, CircularProgress } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Lightbox, { type RenderSlideProps, type Slide } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

import { COMMON_SHORTCUTS, VIEWER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { useImageGalleryData } from "../../hooks/useImageGalleryData";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import apiService from "../../services/api";
import { error as logError, info as logInfo } from "../../services/logger";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { KeyboardShortcutsHelp } from "../KeyboardShortcutsHelp";
import { ViewerControls } from "./ViewerControls";

type ZoomRef = import("yet-another-react-lightbox").ZoomRef;
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

const YarlImageViewer: React.FC<ViewerComponentProps> = ({
  connectionId,
  path,
  onClose,
  images = [path],
  currentIndex: initialIndex = 0,
  onCurrentIndexChange,
  sessionId,
}) => {
  const touchDevice = isTouchDevice();
  const [rotate, setRotate] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hideControls, setHideControls] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const zoomRef = useRef<ZoomRef | null>(null);
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
  } = useImageGalleryData({
    connectionId,
    images,
    initialIndex,
    onIndexChange: onCurrentIndexChange,
    isTouchDevice: touchDevice,
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
    setZoomLevel(1);
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

  const slides = useMemo<LightboxImageSlide[]>(() => {
    return images.map((imagePath, index) => ({
      type: "image",
      src: imageCacheRef.current.get(index) ?? "data:",
      alt: imagePath.split("/").pop() ?? imagePath,
      imageIndex: index,
      originalPath: imagePath,
    }));
  }, [images, imageCacheRef]);

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

  const handleZoomChange = useCallback(
    ({ zoom }: { zoom: number }) => {
      setZoomLevel(zoom);
      if (zoom <= 1.01) {
        setHideControls(false);
      } else if (!hideControls) {
        setHideControls(true);
      }
    },
    [hideControls]
  );

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
    setZoomLevel(1);
    setHideControls(false);
  }, []);

  const handleEscape = useCallback(() => {
    handleClose();
  }, [handleClose]);

  const handleShowHelp = useCallback(() => {
    setShowHelp(true);
  }, []);

  const handleSlideTap = useCallback(() => {
    if (zoomLevel > 1.01) {
      return;
    }
    setHideControls((value) => !value);
  }, [zoomLevel]);

  const renderSlide = useCallback(
    ({ slide }: RenderSlideProps) => {
      const typedSlide = slide as LightboxImageSlide;
      const imageIndex = typedSlide.imageIndex;
      const imageUrl = imageCacheRef.current.get(imageIndex);
      const isLoading = loadingStates.get(imageIndex);
      const error = errorStates.get(imageIndex);
      const alt = typedSlide.alt ?? typedSlide.originalPath;

      return (
        <Box
          onClick={handleSlideTap}
          sx={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            backgroundColor: "rgba(0,0,0,0.9)",
            overflow: "hidden",
            touchAction: "none",
          }}
        >
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
              }}
            >
              <CircularProgress />
            </Box>
          )}

          {error && (
            <Box color="error.main" textAlign="center" px={2}>
              {error}
            </Box>
          )}

          {!error && imageUrl && (
            <Box
              component="img"
              src={imageUrl}
              alt={alt}
              decoding="async"
              sx={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                transform: `rotate(${rotate}deg)`,
              }}
            />
          )}
        </Box>
      );
    },
    [errorStates, handleSlideTap, imageCacheRef, loadingStates, rotate, showLoadingSpinner]
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
        handler: () => setHideControls((value) => !value),
      },
      {
        ...COMMON_SHORTCUTS.CLOSE,
        handler: handleEscape,
      },
      {
        id: "show-help",
        keys: ["?"],
        label: "?",
        description: "Show keyboard shortcuts",
        handler: handleShowHelp,
      },
    ],
    [handleDownload, handleEscape, handleRotateLeft, handleRotateRight, handleShowHelp, handleZoomIn, handleZoomOut, handleZoomReset]
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
              slide: renderSlide,
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
            }}
            on={{
              view: handleViewChange,
              zoom: handleZoomChange,
            }}
            plugins={[Zoom]}
            zoom={{
              ref: zoomRef,
              scrollToZoom: true,
              pinchZoomV4: true,
            }}
          />
        </Box>
      </Box>

      <KeyboardShortcutsHelp open={showHelp} onClose={() => setShowHelp(false)} shortcuts={imageShortcuts} title="Image Viewer Shortcuts" />
    </>
  );
};
export default YarlImageViewer;
