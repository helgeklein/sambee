/**
 * Hook for managing image gallery data with intelligent caching, preloading, and viewport optimization.
 *
 * Features:
 * - Fetches images on-demand with viewport-aware sizing
 * - Preloads images around the current index for smooth navigation
 * - Manages blob URL cache with automatic cleanup of distant images
 * - Handles loading states with delayed spinner to avoid flicker
 * - Supports retry logic for transient errors
 * - Abortable requests to prevent race conditions
 */

import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import apiService from "../services/api";
import { error as logError, logger, info as logInfo } from "../services/logger";
import { isApiError } from "../types";
import { checkIsTransientError, getTransientErrorMessage, useApiRetry } from "./useApiRetry";

// Delay before showing spinner to avoid flicker on fast loads
const SPINNER_DELAY_MS_DEFAULT = 300;
// Number of images to keep cached on each side of current index
const CACHE_RANGE_DEFAULT = 2;
// Number of images to preload ahead/behind current index
const PRELOAD_RANGE_DEFAULT = 1;

// Clamp value to ensure index stays within valid range
const clamp = (value: number, min: number, max: number) => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

// Extract user-friendly error message from API error
const getErrorMessage = (err: unknown): string => {
  if (isApiError(err) && err.response?.data?.detail) {
    return err.response.data.detail;
  }

  if (isApiError(err) && err.message) {
    if (err.response?.data) {
      const data = err.response.data as Record<string, unknown>;
      if (typeof data["detail"] === "string") {
        return data["detail"];
      }
    }
    return `Failed to load image: ${err.message}`;
  }

  return "Failed to load image";
};

export interface UseImageGalleryDataParams {
  connectionId: string;
  images: string[];
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
  spinnerDelayMs?: number;
  cacheRange?: number;
  preloadRange?: number;
  isTouchDevice?: boolean;
  shouldDeferStateUpdates?: () => boolean;
  shouldSuspendPreload?: () => boolean;
}

export interface UseImageGalleryDataResult {
  currentIndex: number;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  currentPath: string;
  filename: string;
  imageCacheRef: React.MutableRefObject<Map<number, string>>;
  loadingStates: Map<number, boolean>;
  errorStates: Map<number, string | null>;
  showLoadingSpinner: boolean;
  markCachedImagesAsLoaded: () => void;
  abortControllersRef: React.MutableRefObject<Map<number, AbortController>>;
}

//
// useCachedImageGallery
//
export const useCachedImageGallery = ({
  connectionId,
  images,
  initialIndex = 0,
  onIndexChange,
  spinnerDelayMs = SPINNER_DELAY_MS_DEFAULT,
  cacheRange = CACHE_RANGE_DEFAULT,
  preloadRange = PRELOAD_RANGE_DEFAULT,
  isTouchDevice = false,
  shouldDeferStateUpdates,
  shouldSuspendPreload,
}: UseImageGalleryDataParams): UseImageGalleryDataResult => {
  const safeInitialIndex = clamp(initialIndex, 0, Math.max(images.length - 1, 0));

  // Current index in the gallery
  const [currentIndex, setCurrentIndex] = useState(safeInitialIndex);
  // Track loading state per image index
  const [loadingStates, setLoadingStates] = useState<Map<number, boolean>>(new Map());
  // Track error messages per image index
  const [errorStates, setErrorStates] = useState<Map<number, string | null>>(new Map());
  // Controls spinner visibility after delay to avoid flicker
  const [showLoadingSpinner, setShowLoadingSpinner] = useState(false);

  // AbortControllers for in-flight requests, keyed by index
  const abortControllersRef = useRef<Map<number, AbortController>>(new Map());
  // Cache of blob URLs for loaded images, keyed by index
  const imageCacheRef = useRef<Map<number, string>>(new Map());
  // Timer for delayed spinner display
  const loadingTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Track in-flight fetch promises to avoid duplicate requests
  const fetchPromisesRef = useRef<Map<number, Promise<void>>>(new Map());

  const fetchWithRetry = useApiRetry();

  // Derive current path and filename from index
  const currentPath = images[currentIndex] ?? images[images.length - 1] ?? "";
  const filename = useMemo(() => {
    if (!currentPath) {
      return "";
    }
    const parts = currentPath.split("/");
    return parts[parts.length - 1] ?? currentPath;
  }, [currentPath]);

  // Optional callbacks for deferring updates during animations or suspending preload during zoom
  // Memoize to prevent creating new functions on every render (which would cause effect loops)
  const shouldDeferRef = useRef(shouldDeferStateUpdates ?? (() => false));
  shouldDeferRef.current = shouldDeferStateUpdates ?? (() => false);
  const shouldDefer = useCallback(() => shouldDeferRef.current(), []);

  const shouldSuspendRef = useRef(shouldSuspendPreload ?? (() => false));
  shouldSuspendRef.current = shouldSuspendPreload ?? (() => false);
  const suspendPreload = useCallback(() => shouldSuspendRef.current(), []);

  // Keep currentIndex within valid range when gallery size changes
  useEffect(() => {
    setCurrentIndex((prev) => clamp(prev, 0, Math.max(images.length - 1, 0)));
  }, [images.length]);

  // Sync with external initialIndex changes
  useEffect(() => {
    setCurrentIndex(clamp(initialIndex, 0, Math.max(images.length - 1, 0)));
  }, [initialIndex, images.length]);

  // Notify parent component of index changes
  useEffect(() => {
    onIndexChange?.(currentIndex);
  }, [currentIndex, onIndexChange]);

  // Show spinner only after delay to avoid flicker on fast image loads
  useEffect(() => {
    const isLoading = loadingStates.get(currentIndex) || false;

    if (isLoading) {
      loadingTimerRef.current = setTimeout(() => {
        setShowLoadingSpinner(true);
      }, spinnerDelayMs);
    } else {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
      setShowLoadingSpinner(false);
    }

    return () => {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
  }, [loadingStates, currentIndex, spinnerDelayMs]);

  //
  // fetchAndCacheImage
  //
  /**
   * Fetches image at given index with viewport-optimized sizing and caches as blob URL.
   * Aborts any existing request for same index. Handles errors and loading states.
   * Returns a promise that resolves when the fetch completes (or reuses existing in-flight promise).
   */
  const fetchAndCacheImage = useCallback(
    async (index: number): Promise<void> => {
      // Guard: skip invalid indices
      if (index < 0 || index >= images.length) {
        return;
      }

      // If already cached, return immediately
      if (imageCacheRef.current.has(index)) {
        return;
      }

      // If already loading, return the existing promise to wait for it
      const existingPromise = fetchPromisesRef.current.get(index);
      if (existingPromise) {
        return existingPromise;
      }

      // Store promise ref FIRST to prevent race condition from duplicate calls
      let resolvePromise!: () => void;
      const fetchPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      fetchPromisesRef.current.set(index, fetchPromise);

      // Now start the actual fetch work
      try {
        const imagePath = images[index];
        if (!imagePath) {
          throw new Error("Invalid image path");
        }

        const abortController = new AbortController();
        abortControllersRef.current.set(index, abortController);

        // Mark as loading and clear any previous error
        setLoadingStates((prev) => new Map(prev).set(index, true));
        setErrorStates((prev) => new Map(prev).set(index, null));

        const fetchStartTime = Date.now();

        logInfo("Fetching image for carousel", {
          index,
          path: imagePath,
          connectionId,
        });

        if (isTouchDevice) {
          logger.debug(
            "Image fetch started",
            {
              index,
              timestamp: fetchStartTime,
            },
            "image-cache"
          );
        }

        // Pass viewport dimensions for server-side image optimization
        // Use actual viewport size for efficiency - library will upscale if needed for fullscreen
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const blob = await fetchWithRetry(
          () =>
            apiService.getImageBlob(connectionId, imagePath, {
              signal: abortController.signal,
              viewportWidth,
              viewportHeight,
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

        // Create blob URL and cache it (must be revoked later to prevent memory leaks)
        const blobUrl = URL.createObjectURL(blob);
        imageCacheRef.current.set(index, blobUrl);

        const fetchDuration = Date.now() - fetchStartTime;

        logInfo("Cached image for carousel", {
          index,
          blobUrl,
          size: blob.size,
        });

        logger.debug(
          "Image cache updated (add)",
          {
            cachedCount: imageCacheRef.current.size,
            cachedIndexes: Array.from(imageCacheRef.current.keys()).sort((a, b) => a - b),
          },
          "image-cache"
        );
        if (isTouchDevice) {
          logger.debug(
            "Image fetch completed",
            {
              index,
              duration: fetchDuration,
              size: blob.size,
              timestamp: Date.now(),
            },
            "image-cache"
          );
        }

        // Optionally defer state updates during animations to prevent jank
        if (!shouldDefer()) {
          setLoadingStates((prev) => new Map(prev).set(index, false));
        }

        abortControllersRef.current.delete(index);
        resolvePromise();
      } catch (err) {
        abortControllersRef.current.delete(index);

        // Aborted/cancelled requests are expected behavior, not errors - resolve normally
        if (axios.isCancel(err) || (err instanceof Error && err.message?.includes("abort"))) {
          logInfo("Image fetch aborted", { index });
          resolvePromise();
          return;
        }

        logError("Failed to fetch image for carousel", {
          index,
          error: err,
          detail: isApiError(err) ? err.response?.data?.detail : undefined,
          status: isApiError(err) ? err.response?.status : undefined,
        });

        const errorMessage = checkIsTransientError(err) ? getTransientErrorMessage() : getErrorMessage(err);

        // Use RAF to batch state updates and avoid layout thrashing
        requestAnimationFrame(() => {
          setErrorStates((prev) => new Map(prev).set(index, errorMessage));
          setLoadingStates((prev) => new Map(prev).set(index, false));
        });

        // Resolve instead of reject - we've handled the error, don't break preload chain
        resolvePromise();
      } finally {
        fetchPromisesRef.current.delete(index);
      }
    },
    [connectionId, images, fetchWithRetry, isTouchDevice, shouldDefer]
  );

  // Store fetchAndCacheImage in a ref to avoid recreating the effect
  const fetchAndCacheImageRef = useRef(fetchAndCacheImage);
  fetchAndCacheImageRef.current = fetchAndCacheImage;

  // Preload images around current index for smooth navigation
  // Sequential strategy: load current, then ±1, then ±2, etc.
  // This prevents overwhelming the backend with simultaneous resize operations
  useEffect(() => {
    if (suspendPreload()) {
      return;
    }
    if (!images.length) {
      return;
    }

    let cancelled = false;
    // Track which controllers were created by THIS effect run
    const effectControllers = new Set<number>();

    const loadImages = async () => {
      // Load current image first
      effectControllers.add(currentIndex);
      await fetchAndCacheImageRef.current(currentIndex);
      if (cancelled) {
        return;
      }

      // Then load surrounding images sequentially, one offset at a time
      // Wait for each pair (±offset) to complete before starting next
      for (let offset = 1; offset <= preloadRange; offset += 1) {
        const prevIndex = currentIndex - offset;
        const nextIndex = currentIndex + offset;

        // Load both prev and next at this offset level concurrently
        const promises: Promise<void>[] = [];
        if (prevIndex >= 0) {
          effectControllers.add(prevIndex);
          promises.push(fetchAndCacheImageRef.current(prevIndex));
        }
        if (nextIndex < images.length) {
          effectControllers.add(nextIndex);
          promises.push(fetchAndCacheImageRef.current(nextIndex));
        }

        // Wait for this offset level to complete before moving to next
        await Promise.all(promises);
        if (cancelled) {
          return;
        }
      }
    };

    loadImages().catch((err) => {
      logError("Failed to preload images", { error: err });
    });

    return () => {
      cancelled = true;
      // Don't abort any controllers on cleanup
      // The next effect run will reuse in-flight fetches for overlapping ranges
      // Only the cache cleanup effect will determine which images to keep
    };
  }, [currentIndex, images.length, preloadRange, suspendPreload]);

  // Clean up blob URLs for images outside cache range to prevent memory leaks
  useEffect(() => {
    // Determine which indices should remain cached
    const indicesToKeep = new Set<number>();
    for (let offset = -cacheRange; offset <= cacheRange; offset += 1) {
      const candidate = currentIndex + offset;
      if (candidate >= 0 && candidate < images.length) {
        indicesToKeep.add(candidate);
      }
    }

    // Revoke blob URLs for images that have moved outside cache range
    const removedIndexes: number[] = [];
    imageCacheRef.current.forEach((url, index) => {
      if (!indicesToKeep.has(index)) {
        logInfo("Revoking blob URL for distant image", { index, url });
        URL.revokeObjectURL(url);
        imageCacheRef.current.delete(index);
        removedIndexes.push(index);
      }
    });

    if (removedIndexes.length > 0) {
      logger.debug(
        "Image cache updated (remove)",
        {
          cachedCount: imageCacheRef.current.size,
          cachedIndexes: Array.from(imageCacheRef.current.keys()).sort((a, b) => a - b),
          removedIndexes: removedIndexes.sort((a, b) => a - b),
        },
        "image-cache"
      );
    }
  }, [currentIndex, images.length, cacheRange]);

  // Cleanup: abort all pending requests and revoke all blob URLs on unmount
  // Note: Don't abort in cleanup - let requests complete naturally
  // Aborting causes issues in React StrictMode dev which unmounts/remounts components
  useEffect(() => {
    return () => {
      // Only revoke blob URLs - abort would interrupt StrictMode remounts
      imageCacheRef.current.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      imageCacheRef.current.clear();
    };
  }, []);

  //
  // markCachedImagesAsLoaded
  //
  /**
   * Marks all currently cached images as loaded. Useful after navigation events
   * to sync loading states with the cache.
   */
  const markCachedImagesAsLoaded = useCallback(() => {
    setLoadingStates((prev) => {
      const updated = new Map(prev);
      let changed = false;

      imageCacheRef.current.forEach((_, index) => {
        if (prev.get(index) !== false) {
          updated.set(index, false);
          changed = true;
        }
      });

      // Only trigger re-render if state actually changed
      return changed ? updated : prev;
    });
  }, []);

  return {
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
  };
};
