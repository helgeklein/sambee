/**
 * Frontend logging bridge for Sambee Companion.
 *
 * Sends log messages to the Rust backend via a Tauri command so they are
 * written to the same rotating log file as Rust-side messages. This
 * provides a single, unified log for diagnosing issues.
 *
 * ## Usage
 *
 * ```ts
 * import { log } from "./lib/logger";
 *
 * log.error("Upload failed", errorObj);
 * log.warn("Theme decode issue");
 * log.info("Update available: v2.1");
 * log.debug("Polling file status...");
 * ```
 *
 * Each method also writes to the browser console (via the matching
 * `console.*` call) so messages remain visible during development.
 */

import { invoke } from "@tauri-apps/api/core";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Log levels supported by the Rust backend. */
type LogLevel = "error" | "warn" | "info" | "debug";

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

//
// sendToBackend
//
/**
 * Forward a log message to the Rust file logger.
 *
 * Fire-and-forget — logging must never block the UI or throw.
 */
function sendToBackend(level: LogLevel, message: string): void {
  invoke("log_from_frontend", { level, message }).catch(() => {
    // Swallow errors — the backend may not be ready yet during early
    // startup, and we must never let logging break the app.
  });
}

//
// formatArgs
//
/**
 * Concatenate a message and optional extra arguments into a single string
 * suitable for the log file.
 */
function formatArgs(message: string, args: unknown[]): string {
  if (args.length === 0) return message;

  const extras = args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === "object") {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ");

  return `${message} ${extras}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unified logger that writes to both the Rust log file and the browser
 * console.
 */
export const log = {
  //
  // error
  //
  /** Log an error — always captured regardless of the verbose switch. */
  error(message: string, ...args: unknown[]): void {
    console.error(message, ...args);
    sendToBackend("error", formatArgs(message, args));
  },

  //
  // warn
  //
  /** Log a warning — always captured regardless of the verbose switch. */
  warn(message: string, ...args: unknown[]): void {
    console.warn(message, ...args);
    sendToBackend("warn", formatArgs(message, args));
  },

  //
  // info
  //
  /** Log an informational message — only captured in verbose mode. */
  info(message: string, ...args: unknown[]): void {
    console.info(message, ...args);
    sendToBackend("info", formatArgs(message, args));
  },

  //
  // debug
  //
  /** Log a debug message — only captured in verbose mode. */
  debug(message: string, ...args: unknown[]): void {
    console.debug(message, ...args);
    sendToBackend("debug", formatArgs(message, args));
  },
};
