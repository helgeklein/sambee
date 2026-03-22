import { Box, CircularProgress, Dialog } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Lightbox, { type Slide } from "yet-another-react-lightbox";
import Fullscreen from "yet-another-react-lightbox/plugins/fullscreen";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import "./ImageViewer.css";

import { BROWSER_SHORTCUTS, COMMON_SHORTCUTS, VIEWER_SHORTCUTS } from "../../config/keyboardShortcuts";
import { useCachedImageGallery } from "../../hooks/useCachedImageGallery";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import apiService from "../../services/api";
import { error as logError, info as logInfo } from "../../services/logger";
import { useSambeeTheme } from "../../theme";
import { getViewerColors } from "../../theme/viewerStyles";
import type { ViewerComponentProps } from "../../utils/FileTypeRegistry";
import { blurActiveToolbarControl } from "../../utils/keyboardUtils";
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

const ImageViewer: React.FC<ViewerComponentProps> = ({
  connectionId,
  path,
  onClose,
  images = [path],
  currentIndex: initialIndex = 0,
  onCurrentIndexChange,
  sessionId,
}) => {
  const { t } = useTranslation();
  const [rotate, setRotate] = useState(0);
  const [hideControls, setHideControls] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const zoomRef = useRef<ZoomRef | null>(null);
  const fullscreenRef = useRef<FullscreenRef | null>(null);

  // Callback-ref + state ensures the Lightbox only renders once the portal
  // container is mounted.  Without this, portalRef.current is null on the
  // first render and yarl falls back to document.body, setting "inert" on
  // siblings — including the MUI Dialog root — which disables our toolbar
  // and keyboard handling until a re-render moves the portal.
  const [portalElement, setPortalElement] = useState<HTMLDivElement | null>(null);
  const portalRef = useCallback((node: HTMLDivElement | null) => {
    setPortalElement(node);
  }, []);

  const { currentTheme } = useSambeeTheme();
  const { viewerBg, toolbarBg, toolbarText } = getViewerColors(currentTheme, "image");

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
        logInfo("Image viewer opened", meta);
      }
    } else {
      logInfo("Image viewer opened", meta);
    }

    return () => {
      if (sessionId) {
        const timer = setTimeout(() => {
          logInfo("Image viewer closed");
          viewerSessionCloseTimers.delete(sessionId);
          activeViewerSessions.delete(sessionId);
        }, 0);
        viewerSessionCloseTimers.set(sessionId, timer);
      } else {
        logInfo("Image viewer closed");
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

  /**
   * Escape handler for useKeyboardShortcuts (window-level).
   * Blur-first logic lives on the Dialog Paper's onKeyDown instead,
   * because it must fire before the parent FileBrowser's window listener.
   */
  const handleEscape = useCallback(
    (_event?: KeyboardEvent) => {
      onClose();
    },
    [onClose]
  );

  /**
   * Paper-level keydown handler — single authority for all Escape logic.
   * MUI Dialogs render in a portal at document.body (outside the React root),
   * so native events may not reliably reach window listeners. Handling
   * everything here and calling preventDefault() makes close robust.
   * 1. If a toolbar button/input has focus → blur it (hide focus ring)
   * 2. Otherwise → close the viewer
   */
  const handlePaperKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (blurActiveToolbarControl()) return;
      onClose();
    },
    [onClose]
  );

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
                zIndex: 2,
                pointerEvents: "none",
              }}
            >
              <CircularProgress sx={{ color: toolbarText }} />
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
    [errorStates, loadingStates, showLoadingSpinner, toolbarText]
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
        handler: handleEscape,
      },
      {
        ...BROWSER_SHORTCUTS.SHOW_HELP,
        handler: handleShowHelp,
      },
    ],
    [
      handleDownload,
      handleEscape,
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
      {/* Full-screen dialog overlay — consistent with PDFViewer and MarkdownViewer.
          Provides built-in focus trapping, aria-modal, and portal isolation. */}
      <Dialog
        open={true}
        onClose={handleClose}
        maxWidth={false}
        fullScreen
        disableEscapeKeyDown // Escape handled by useKeyboardShortcuts
        disableEnforceFocus // yarl lightbox manages its own focus
        sx={{
          "& .MuiDialog-container": {
            alignItems: "stretch",
            justifyContent: "stretch",
          },
        }}
        PaperProps={{
          onKeyDown: handlePaperKeyDown,
          sx: {
            backgroundColor: viewerBg,
            boxShadow: "none",
            margin: 0,
            width: "100dvw",
            maxWidth: "100dvw",
            height: "100dvh",
            maxHeight: "100dvh",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          },
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
              toolbarBackground={toolbarBg}
              toolbarText={toolbarText}
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

        {/* Lightbox container - fills remaining space below toolbar */}
        <Box
          ref={portalRef}
          sx={{
            flex: 1,
            position: "relative",
          }}
        >
          {portalElement && (
            <Lightbox
              open={true}
              close={handleClose}
              index={currentIndex}
              slides={slides}
              portal={{ root: portalElement }}
              noScroll={{ disabled: true }} // Dialog handles scroll lock
              render={{
                slideContainer: renderSlideContainer,
                slideHeader: renderSlideHeader,
                buttonPrev: () => null,
                buttonNext: () => null,
                buttonClose: () => null,
                iconPrev: () => null,
                iconNext: () => null,
                controls: () => null, // Controls rendered in our custom toolbar
              }}
              toolbar={{ buttons: [] }}
              controller={{ focus: true }} // Auto-focus yarl container on mount for keyboard nav
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
                  backgroundColor: `${viewerBg} !important`,
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: 0,
                  right: 0,
                },
                navigationPrev: {
                  backgroundColor: `${viewerBg} !important`,
                },
                navigationNext: {
                  backgroundColor: `${viewerBg} !important`,
                },
                toolbar: {
                  display: "none", // Hide library's default toolbar
                },
                slide: {
                  // Allow images to scale up to fill viewport (removes library's default max-width/max-height limits)
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
          )}
        </Box>
      </Dialog>

      <KeyboardShortcutsHelp
        open={showHelp}
        onClose={() => setShowHelp(false)}
        shortcuts={imageShortcuts}
        title={t("keyboardShortcutsHelp.titles.imageViewer")}
      />
    </>
  );
};
export default ImageViewer;
