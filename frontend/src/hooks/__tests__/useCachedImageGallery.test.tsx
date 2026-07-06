import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import apiService from "../../services/api";
import { logger } from "../../services/logger";
import { useCachedImageGallery } from "../useCachedImageGallery";

vi.mock("../../services/api", () => ({
  default: {
    getImageBlob: vi.fn(),
  },
}));

interface DeferredRequest {
  resolve: (blob: Blob) => void;
}

function registerAbortableDeferredRequest(deferredByPath: Map<string, DeferredRequest>, path: string, options?: { signal?: AbortSignal }) {
  return new Promise<Blob>((resolve, reject) => {
    options?.signal?.addEventListener(
      "abort",
      () => {
        reject({
          code: "ERR_CANCELED",
          message: "canceled",
          config: { signal: options.signal },
        });
      },
      { once: true }
    );

    deferredByPath.set(path, {
      resolve: (blob) => resolve(blob),
    });
  });
}

describe("useCachedImageGallery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aborts stale in-flight preload requests when the desired preload window moves", async () => {
    const capturedSignals: AbortSignal[] = [];

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, _path: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal) {
        capturedSignals.push(options.signal);
      }

      return new Promise<Blob>(() => {
        // Intentionally unresolved to simulate a long-running preload.
      });
    });

    const { rerender } = renderHook(
      ({ initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images: ["/0.jpg", "/1.jpg", "/2.jpg", "/3.jpg"],
          initialIndex,
          preloadRange: 1,
        }),
      {
        initialProps: { initialIndex: 0 },
      }
    );

    await waitFor(() => {
      expect(capturedSignals.length).toBeGreaterThan(0);
    });

    const firstSignal = capturedSignals[0];
    expect(firstSignal?.aborted).toBe(false);

    rerender({ initialIndex: 3 });

    await waitFor(() => {
      expect(firstSignal?.aborted).toBe(true);
    });
  });

  it("does not surface a stale preload abort as a failed image fetch when the transport reports a generic network error", async () => {
    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, _path: string, options?: { signal?: AbortSignal }) => {
      return new Promise<Blob>((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => {
            reject({
              code: "ERR_NETWORK",
              message: "Network Error",
              config: { signal: options.signal },
            });
          },
          { once: true }
        );
      });
    });

    const { result, rerender } = renderHook(
      ({ initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images: ["/0.jpg", "/1.jpg", "/2.jpg", "/3.jpg"],
          initialIndex,
          preloadRange: 1,
        }),
      {
        initialProps: { initialIndex: 0 },
      }
    );

    rerender({ initialIndex: 3 });

    await waitFor(() => {
      expect(result.current.abortControllersRef.current.size).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(result.current.errorStates.get(0) ?? null).toBeNull();
    });
  });

  it("keeps the previous current-image request alive when it remains inside the one-step overlap window", async () => {
    const capturedSignals = new Map<string, AbortSignal>();

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal) {
        capturedSignals.set(path, options.signal);
      }

      return new Promise<Blob>((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => {
            reject({
              code: "ERR_CANCELED",
              message: "canceled",
              config: { signal: options.signal },
            });
          },
          { once: true }
        );
      });
    });

    const { rerender } = renderHook(
      ({ initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images: ["/0.jpg", "/1.jpg", "/2.jpg", "/3.jpg"],
          initialIndex,
          preloadRange: 1,
        }),
      {
        initialProps: { initialIndex: 0 },
      }
    );

    await waitFor(() => {
      expect(capturedSignals.has("/0.jpg")).toBe(true);
    });

    const firstSignal = capturedSignals.get("/0.jpg");
    expect(firstSignal?.aborted).toBe(false);

    rerender({ initialIndex: 1 });

    await waitFor(() => {
      expect(capturedSignals.has("/1.jpg")).toBe(true);
    });

    expect(firstSignal?.aborted).toBe(false);
  });

  it("retries an in-flight preload once after it is promoted to the current image", async () => {
    const requestedPaths: string[] = [];
    let rejectFirstPreloadAttempt: ((error: unknown) => void) | null = null;
    let preloadAttempts = 0;

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string, options?: { signal?: AbortSignal }) => {
      requestedPaths.push(path);

      if (path === "/0.jpg") {
        return Promise.resolve(new Blob([path], { type: "image/jpeg" }));
      }

      if (path === "/1.jpg") {
        preloadAttempts += 1;

        if (preloadAttempts === 1) {
          return new Promise<Blob>((_resolve, reject) => {
            rejectFirstPreloadAttempt = reject;
          });
        }

        return Promise.resolve(new Blob([path], { type: "image/jpeg" }));
      }

      return new Promise<Blob>((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => {
            reject({
              code: "ERR_CANCELED",
              message: "canceled",
              config: { signal: options.signal },
            });
          },
          { once: true }
        );

        // Keep later preload slots idle for this assertion.
      });
    });

    const { rerender, result } = renderHook(
      ({ initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images: ["/0.jpg", "/1.jpg", "/2.jpg"],
          initialIndex,
          preloadRange: 1,
        }),
      {
        initialProps: { initialIndex: 0 },
      }
    );

    await waitFor(() => {
      expect(requestedPaths).toEqual(["/0.jpg", "/1.jpg"]);
    });

    rerender({ initialIndex: 1 });

    await waitFor(() => {
      expect(result.current.currentIndex).toBe(1);
    });

    await act(async () => {});

    rejectFirstPreloadAttempt?.({
      code: "ERR_NETWORK",
      message: "Network Error",
    });

    await waitFor(
      () => {
        expect(requestedPaths.filter((path) => path === "/1.jpg")).toHaveLength(2);
      },
      { timeout: 2500 }
    );
  });

  it("does not start another queued preload while the current image and preserved overlap already occupy the total request budget", async () => {
    const requestedPaths: string[] = [];
    const budgetDeferredByPath = new Map<string, DeferredRequest>();

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string, options?: { signal?: AbortSignal }) => {
      requestedPaths.push(path);

      if (path === "/3.jpg") {
        return Promise.resolve(new Blob([path], { type: "image/jpeg" }));
      }

      const request = registerAbortableDeferredRequest(budgetDeferredByPath, path, options);
      expect(budgetDeferredByPath.has(path)).toBe(true);
      return request;
    });

    const { rerender } = renderHook(
      ({ initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images: ["/0.jpg", "/1.jpg", "/2.jpg", "/3.jpg", "/4.jpg", "/5.jpg", "/6.jpg"],
          initialIndex,
          preloadRange: 2,
        }),
      {
        initialProps: { initialIndex: 3 },
      }
    );

    await waitFor(() => {
      expect(requestedPaths[0]).toBe("/3.jpg");
      expect(requestedPaths[1]).toBe("/2.jpg");
    });

    rerender({ initialIndex: 4 });

    await waitFor(() => {
      expect(requestedPaths).toContain("/4.jpg");
    });

    budgetDeferredByPath.get("/2.jpg")?.resolve(new Blob(["/2.jpg"], { type: "image/jpeg" }));

    await waitFor(() => {
      expect(requestedPaths.filter((path) => path === "/5.jpg")).toHaveLength(1);
    });
  });

  it("does not retry a request after it is demoted from current to overlap", async () => {
    const requestedPaths: string[] = [];
    let rejectCurrentAttempt: ((error: unknown) => void) | null = null;
    let firstPathAttempts = 0;

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string, _options?: { signal?: AbortSignal }) => {
      requestedPaths.push(path);

      if (path === "/0.jpg") {
        firstPathAttempts += 1;

        if (firstPathAttempts === 1) {
          return new Promise<Blob>((_resolve, reject) => {
            rejectCurrentAttempt = reject;
          });
        }

        return Promise.resolve(new Blob([path], { type: "image/jpeg" }));
      }

      if (path === "/1.jpg") {
        return Promise.resolve(new Blob([path], { type: "image/jpeg" }));
      }

      return new Promise<Blob>(() => {
        // Keep later preload slots idle for this assertion.
      });
    });

    const { rerender, result } = renderHook(
      ({ initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images: ["/0.jpg", "/1.jpg", "/2.jpg"],
          initialIndex,
          preloadRange: 1,
        }),
      {
        initialProps: { initialIndex: 0 },
      }
    );

    await waitFor(() => {
      expect(requestedPaths[0]).toBe("/0.jpg");
    });

    rerender({ initialIndex: 1 });

    await waitFor(() => {
      expect(result.current.currentIndex).toBe(1);
    });

    await act(async () => {});

    rejectCurrentAttempt?.({
      code: "ERR_NETWORK",
      message: "Network Error",
    });

    await waitFor(() => {
      expect(requestedPaths.filter((path) => path === "/0.jpg")).toHaveLength(1);
    });
  });

  it("preserves the overlap and appends only the newly exposed edge image during one-step navigation", async () => {
    const requestedPaths: string[] = [];
    const overlapDeferredByPath = new Map<string, DeferredRequest>();

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string, options?: { signal?: AbortSignal }) => {
      requestedPaths.push(path);

      if (path === "/3.jpg") {
        return Promise.resolve(new Blob([path], { type: "image/jpeg" }));
      }

      const request = registerAbortableDeferredRequest(overlapDeferredByPath, path, options);
      expect(overlapDeferredByPath.has(path)).toBe(true);
      return request;
    });

    const { rerender, result } = renderHook(
      ({ initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images: ["/0.jpg", "/1.jpg", "/2.jpg", "/3.jpg", "/4.jpg", "/5.jpg", "/6.jpg"],
          initialIndex,
          preloadRange: 2,
        }),
      {
        initialProps: { initialIndex: 3 },
      }
    );

    await waitFor(() => {
      expect(requestedPaths[0]).toBe("/3.jpg");
      expect(requestedPaths[1]).toBe("/2.jpg");
    });

    rerender({ initialIndex: 4 });

    await waitFor(() => {
      expect(requestedPaths).toContain("/4.jpg");
    });

    await waitFor(() => {
      expect(result.current.currentIndex).toBe(4);
    });

    overlapDeferredByPath.get("/2.jpg")?.resolve(new Blob(["/2.jpg"], { type: "image/jpeg" }));
    overlapDeferredByPath.get("/4.jpg")?.resolve(new Blob(["/4.jpg"], { type: "image/jpeg" }));

    await waitFor(() => {
      expect(requestedPaths).toContain("/5.jpg");
    });
  });

  it("does not retry or error-log a transiently failing background preload while it stays in the preload window", async () => {
    const requestedPaths: string[] = [];
    const errorSpy = vi.spyOn(logger, "error");

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string) => {
      requestedPaths.push(path);

      if (path === "/3.jpg" || path === "/4.jpg") {
        return Promise.resolve(new Blob([path], { type: "image/jpeg" }));
      }

      if (path === "/2.jpg") {
        return Promise.reject({
          code: "ERR_NETWORK",
          message: "Network Error",
        });
      }

      return new Promise<Blob>(() => {
        // Keep later preload slots idle for this assertion.
      });
    });

    const { rerender } = renderHook(
      ({ initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images: ["/0.jpg", "/1.jpg", "/2.jpg", "/3.jpg", "/4.jpg", "/5.jpg", "/6.jpg"],
          initialIndex,
          preloadRange: 2,
        }),
      {
        initialProps: { initialIndex: 3 },
      }
    );

    await waitFor(() => {
      expect(requestedPaths[0]).toBe("/3.jpg");
      expect(requestedPaths[1]).toBe("/2.jpg");
    });

    rerender({ initialIndex: 4 });

    await waitFor(() => {
      expect(requestedPaths).toContain("/4.jpg");
    });

    await waitFor(() => {
      expect(requestedPaths.filter((path) => path === "/2.jpg")).toHaveLength(1);
    });

    expect(errorSpy).not.toHaveBeenCalledWith(
      "Failed to fetch image for carousel",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it("does not relaunch a request that fails after being demoted from current to overlap", async () => {
    const requestedPaths: string[] = [];
    let rejectDemotedAttempt: ((error: unknown) => void) | null = null;

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string) => {
      requestedPaths.push(path);

      if (path === "/0.jpg") {
        return new Promise<Blob>((_resolve, reject) => {
          rejectDemotedAttempt = reject;
        });
      }

      if (path === "/1.jpg" || path === "/2.jpg") {
        return Promise.resolve(new Blob([path], { type: "image/jpeg" }));
      }

      return new Promise<Blob>(() => {
        // Keep later preload slots idle for this assertion.
      });
    });

    const { rerender, result } = renderHook(
      ({ initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images: ["/0.jpg", "/1.jpg", "/2.jpg", "/3.jpg"],
          initialIndex,
          preloadRange: 2,
        }),
      {
        initialProps: { initialIndex: 0 },
      }
    );

    await waitFor(() => {
      expect(requestedPaths[0]).toBe("/0.jpg");
    });

    rerender({ initialIndex: 1 });

    await waitFor(() => {
      expect(result.current.currentIndex).toBe(1);
    });

    rejectDemotedAttempt?.({
      code: "ERR_NETWORK",
      message: "Network Error",
    });

    rerender({ initialIndex: 2 });

    await waitFor(() => {
      expect(result.current.currentIndex).toBe(2);
    });

    await waitFor(() => {
      expect(requestedPaths.filter((path) => path === "/0.jpg")).toHaveLength(1);
    });
  });

  it("does not leak failed background preload suppression across gallery changes with reused paths", async () => {
    const requestedPaths: string[] = [];

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string) => {
      requestedPaths.push(path);

      if (path === "/a0.jpg" || path === "/b0.jpg") {
        return Promise.resolve(new Blob([path], { type: "image/jpeg" }));
      }

      if (path === "/shared.jpg") {
        return Promise.reject({
          code: "ERR_NETWORK",
          message: "Network Error",
        });
      }

      return new Promise<Blob>(() => {
        // Keep later preload slots idle for this assertion.
      });
    });

    const { rerender } = renderHook(
      ({ connectionId, images }) =>
        useCachedImageGallery({
          connectionId,
          images,
          initialIndex: 0,
          preloadRange: 1,
        }),
      {
        initialProps: {
          connectionId: "conn-1",
          images: ["/a0.jpg", "/shared.jpg", "/a2.jpg"],
        },
      }
    );

    await waitFor(() => {
      expect(requestedPaths.filter((path) => path === "/shared.jpg")).toHaveLength(1);
    });

    rerender({
      connectionId: "conn-1",
      images: ["/b0.jpg", "/shared.jpg", "/b2.jpg"],
    });

    await waitFor(() => {
      expect(requestedPaths.filter((path) => path === "/shared.jpg")).toHaveLength(2);
    });
  });

  it("does not expose the previous gallery cache at the same index on the first render after a gallery switch", async () => {
    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, _path: string) => {
      return new Promise<Blob>(() => {
        // Keep requests idle for this assertion.
      });
    });

    const { rerender, result } = renderHook(
      ({ images, initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images,
          initialIndex,
          preloadRange: 0,
        }),
      {
        initialProps: {
          images: ["/a0.jpg", "/a1.jpg", "/a2.jpg"],
          initialIndex: 1,
        },
      }
    );

    act(() => {
      result.current.imageCacheRef.current.set(1, "blob:old-gallery");
    });

    rerender({
      images: ["/b0.jpg", "/b1.jpg", "/b2.jpg"],
      initialIndex: 1,
    });

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.getCachedImageSrc(1)).toBeUndefined();
    expect(result.current.imageCacheRef.current.has(1)).toBe(false);
  });

  it("does not expose the previous gallery loading state at the same index on the first render after a gallery switch", async () => {
    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, _path: string) => {
      return new Promise<Blob>(() => {
        // Keep the current image loading in the original gallery.
      });
    });

    const { rerender, result } = renderHook(
      ({ images, initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images,
          initialIndex,
          preloadRange: 0,
        }),
      {
        initialProps: {
          images: ["/a0.jpg", "/a1.jpg", "/a2.jpg"],
          initialIndex: 1,
        },
      }
    );

    await waitFor(() => {
      expect(result.current.loadingStates.get(1)).toBe(true);
    });

    rerender({
      images: ["/b0.jpg", "/b1.jpg", "/b2.jpg"],
      initialIndex: 1,
    });

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.loadingStates.get(1)).toBeUndefined();
  });

  it("does not expose the previous gallery error state at the same index on the first render after a gallery switch", async () => {
    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string) => {
      if (path === "/a1.jpg") {
        return Promise.reject({
          message: "Server exploded",
          response: {
            status: 500,
            data: { detail: "Server exploded" },
          },
        });
      }

      return new Promise<Blob>(() => {
        // Keep remaining requests idle for this assertion.
      });
    });

    const { rerender, result } = renderHook(
      ({ images, initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images,
          initialIndex,
          preloadRange: 0,
        }),
      {
        initialProps: {
          images: ["/a0.jpg", "/a1.jpg", "/a2.jpg"],
          initialIndex: 1,
        },
      }
    );

    await waitFor(() => {
      expect(result.current.errorStates.get(1)).toBeDefined();
    });

    rerender({
      images: ["/b0.jpg", "/b1.jpg", "/b2.jpg"],
      initialIndex: 1,
    });

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.errorStates.get(1)).toBeUndefined();
  });

  it("does not immediately relaunch a non-transient current-image failure before the retry gate opens", async () => {
    const requestedPaths: string[] = [];

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string) => {
      requestedPaths.push(path);

      if (path === "/0.jpg") {
        return Promise.reject({
          message: "Server exploded",
          response: {
            status: 500,
            data: { detail: "Server exploded" },
          },
        });
      }

      return new Promise<Blob>(() => {
        // Keep the rest of the gallery idle for this assertion.
      });
    });

    const { rerender, result } = renderHook(
      ({ initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images: ["/0.jpg", "/1.jpg", "/2.jpg"],
          initialIndex,
          preloadRange: 0,
        }),
      {
        initialProps: { initialIndex: 0 },
      }
    );

    await waitFor(() => {
      expect(result.current.errorStates.get(0)).toBeDefined();
    });

    expect(requestedPaths.filter((path) => path === "/0.jpg")).toHaveLength(1);

    rerender({ initialIndex: 1 });

    await waitFor(() => {
      expect(result.current.currentIndex).toBe(1);
    });

    rerender({ initialIndex: 0 });

    await waitFor(() => {
      expect(result.current.currentIndex).toBe(0);
    });

    await waitFor(() => {
      expect(requestedPaths.filter((path) => path === "/0.jpg")).toHaveLength(2);
    });
  });

  it("retries a recoverable current-image failure after backoff without navigation", async () => {
    const requestedPaths: string[] = [];
    let currentAttempts = 0;

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string) => {
      requestedPaths.push(path);

      if (path === "/0.jpg") {
        currentAttempts += 1;

        if (currentAttempts === 1) {
          return Promise.reject({
            message: "Server exploded",
            response: {
              status: 500,
              data: { detail: "Server exploded" },
            },
          });
        }

        return Promise.resolve(new Blob([path], { type: "image/jpeg" }));
      }

      return new Promise<Blob>(() => {
        // Keep the rest of the gallery idle for this assertion.
      });
    });

    const { result } = renderHook(() =>
      useCachedImageGallery({
        connectionId: "conn-1",
        images: ["/0.jpg", "/1.jpg", "/2.jpg"],
        initialIndex: 0,
        preloadRange: 0,
      })
    );

    await waitFor(() => {
      expect(result.current.errorStates.get(0)).toBeDefined();
    });

    expect(requestedPaths.filter((path) => path === "/0.jpg")).toHaveLength(1);

    await waitFor(
      () => {
        expect(requestedPaths.filter((path) => path === "/0.jpg")).toHaveLength(2);
      },
      { timeout: 2500 }
    );

    await waitFor(() => {
      expect(result.current.getCachedImageSrc(0)).toBeDefined();
    });
  });

  it("does not auto-retry a non-retryable current-image failure", async () => {
    const requestedPaths: string[] = [];

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string) => {
      requestedPaths.push(path);

      if (path === "/0.jpg") {
        return Promise.reject({
          message: "Not found",
          response: {
            status: 404,
            data: { detail: "Not found" },
          },
        });
      }

      return new Promise<Blob>(() => {
        // Keep the rest of the gallery idle for this assertion.
      });
    });

    const { result } = renderHook(() =>
      useCachedImageGallery({
        connectionId: "conn-1",
        images: ["/0.jpg", "/1.jpg", "/2.jpg"],
        initialIndex: 0,
        preloadRange: 0,
      })
    );

    await waitFor(() => {
      expect(result.current.errorStates.get(0)).toBeDefined();
    });

    await new Promise((resolve) => window.setTimeout(resolve, 1200));

    expect(requestedPaths.filter((path) => path === "/0.jpg")).toHaveLength(1);
  });

  it("does not let a previous gallery request populate the new gallery cache when it resolves late", async () => {
    let resolveOldGalleryCurrent: ((blob: Blob) => void) | null = null;
    const requestedPaths: string[] = [];

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string) => {
      requestedPaths.push(path);

      if (path === "/a0.jpg") {
        return new Promise<Blob>((resolve) => {
          resolveOldGalleryCurrent = resolve;
        });
      }

      if (path === "/b1.jpg") {
        return Promise.resolve(new Blob([path], { type: "image/jpeg" }));
      }

      return new Promise<Blob>(() => {
        // Keep remaining preload slots idle for this assertion.
      });
    });

    const { rerender, result } = renderHook(
      ({ images, initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images,
          initialIndex,
          preloadRange: 0,
        }),
      {
        initialProps: {
          images: ["/a0.jpg", "/a1.jpg"],
          initialIndex: 0,
        },
      }
    );

    await waitFor(() => {
      expect(resolveOldGalleryCurrent).not.toBeNull();
    });

    const requestsBeforeSwitch = requestedPaths.length;

    rerender({
      images: ["/b0.jpg", "/b1.jpg"],
      initialIndex: 1,
    });

    await waitFor(() => {
      expect(result.current.currentIndex).toBe(1);
    });

    await waitFor(() => {
      expect(requestedPaths.slice(requestsBeforeSwitch)[0]).toBe("/b1.jpg");
    });

    resolveOldGalleryCurrent?.(new Blob(["/a0.jpg"], { type: "image/jpeg" }));

    await waitFor(() => {
      expect(result.current.imageCacheRef.current.get(1)).toBeDefined();
    });

    expect(result.current.imageCacheRef.current.has(0)).toBe(false);
  });

  it("does not emit a stale carried index when a gallery switch resets to the new initialIndex", async () => {
    const onIndexChange = vi.fn();

    vi.mocked(apiService.getImageBlob).mockImplementation((_connectionId: string, path: string) => {
      return Promise.resolve(new Blob([path], { type: "image/jpeg" }));
    });

    const { rerender, result } = renderHook(
      ({ images, initialIndex }) =>
        useCachedImageGallery({
          connectionId: "conn-1",
          images,
          initialIndex,
          onIndexChange,
          preloadRange: 0,
        }),
      {
        initialProps: {
          images: ["/a0.jpg", "/a1.jpg", "/a2.jpg"],
          initialIndex: 0,
        },
      }
    );

    act(() => {
      result.current.setCurrentIndex(2);
    });

    await waitFor(() => {
      expect(result.current.currentIndex).toBe(2);
    });

    const callbackCountBeforeSwitch = onIndexChange.mock.calls.length;

    rerender({
      images: ["/b0.jpg", "/b1.jpg", "/b2.jpg"],
      initialIndex: 1,
    });

    await waitFor(() => {
      expect(result.current.currentIndex).toBe(1);
    });

    expect(onIndexChange.mock.calls.slice(callbackCountBeforeSwitch)).toEqual([[1]]);
  });
});
