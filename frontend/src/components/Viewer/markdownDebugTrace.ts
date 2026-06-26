const MARKDOWN_DEBUG_PREFIX = "[sambee-markdown-debug]";

export const MARKDOWN_DEBUG_SESSION_STORAGE_KEY = "sambee:markdown-debug";

function isMarkdownDebugTraceEnabled(): boolean {
  try {
    return window.sessionStorage.getItem(MARKDOWN_DEBUG_SESSION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function emitMarkdownDebugTrace(scope: string, event: string, detail?: Record<string, unknown>): void {
  if (!isMarkdownDebugTraceEnabled()) {
    return;
  }

  const payload = {
    at:
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? Number(performance.now().toFixed(2))
        : Date.now(),
    scope,
    event,
    ...(detail ?? {}),
  };

  console.info(MARKDOWN_DEBUG_PREFIX, JSON.stringify(payload));
}
