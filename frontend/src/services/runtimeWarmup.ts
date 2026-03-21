let warmupScheduled = false;
const IS_TEST_ENVIRONMENT =
  import.meta.env["VITEST"] === true ||
  (typeof process !== "undefined" && process.env?.["VITEST"] === "true") ||
  (typeof globalThis !== "undefined" && ("describe" in globalThis || "it" in globalThis || "test" in globalThis));

type IdleCallbackHandle = number;

interface IdleCallbackDeadline {
  didTimeout: boolean;
  timeRemaining: () => number;
}

interface IdleWindow extends Window {
  requestIdleCallback?: (callback: (deadline: IdleCallbackDeadline) => void, options?: { timeout?: number }) => IdleCallbackHandle;
}

async function warmRuntimeModules(): Promise<void> {
  await Promise.allSettled([
    import("../components/Viewer/ImageViewer"),
    import("../components/Viewer/MarkdownViewer"),
    import("../components/Viewer/PDFViewer"),
    import("./authConfig"),
    import("./loggingConfig"),
  ]);
}

export function scheduleRuntimeWarmup(): void {
  if (IS_TEST_ENVIRONMENT) {
    return;
  }

  if (warmupScheduled) {
    return;
  }

  warmupScheduled = true;

  const runWarmup = () => {
    void warmRuntimeModules();
  };

  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === "function") {
    idleWindow.requestIdleCallback(
      () => {
        runWarmup();
      },
      { timeout: 2_000 }
    );
    return;
  }

  window.setTimeout(runWarmup, 1_000);
}

export function resetRuntimeWarmupForTests(): void {
  warmupScheduled = false;
}
