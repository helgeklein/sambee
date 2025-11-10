/**
 * Centralized logging service for the frontend.
 *
 * Provides structured logging with context, log levels, and optional backend forwarding.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: LogContext;
  requestId?: string;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

class Logger {
  private minLevel: LogLevel;
  private isDevelopment: boolean;
  private isTest: boolean;

  constructor() {
    this.isDevelopment = import.meta.env.DEV;
    // Detect test environment - vitest sets this or we can check if vitest globals exist
    this.isTest =
      import.meta.env.VITEST === true ||
      (typeof process !== "undefined" && process.env?.VITEST === "true") ||
      // Alternative: check if vitest globals are available
      (typeof globalThis !== "undefined" &&
        ("describe" in globalThis || "it" in globalThis || "test" in globalThis));
    this.minLevel = this.isDevelopment ? LogLevel.DEBUG : LogLevel.INFO;
  }

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log an error message
   */
  error(message: string, context?: LogContext, error?: Error): void {
    const errorContext = error
      ? {
          ...context,
          error: {
            message: error.message,
            stack: error.stack,
            name: error.name,
          },
        }
      : context;
    this.log(LogLevel.ERROR, message, errorContext);
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (level < this.minLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      message,
      context,
    };

    // Extract request ID from context if present
    if (context?.requestId) {
      entry.requestId = String(context.requestId);
    }

    // Console output in development (but not during tests to keep output clean)
    if (this.isDevelopment && !this.isTest) {
      this.consoleLog(level, entry);
    }

    // Store critical errors for potential backend forwarding
    if (level === LogLevel.ERROR) {
      this.storeError(entry);
    }
  }

  /**
   * Output to console with appropriate styling
   */
  private consoleLog(level: LogLevel, entry: LogEntry): void {
    const prefix = entry.requestId ? `[${entry.requestId}] ` : "";
    const fullMessage = `${prefix}${entry.message}`;

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(
          `%c${entry.timestamp} DEBUG`,
          "color: gray",
          fullMessage,
          entry.context || ""
        );
        break;
      case LogLevel.INFO:
        console.info(`%c${entry.timestamp} INFO`, "color: blue", fullMessage, entry.context || "");
        break;
      case LogLevel.WARN:
        console.warn(
          `%c${entry.timestamp} WARN`,
          "color: orange",
          fullMessage,
          entry.context || ""
        );
        break;
      case LogLevel.ERROR:
        console.error(`%c${entry.timestamp} ERROR`, "color: red", fullMessage, entry.context || "");
        break;
    }
  }

  /**
   * Store error in local storage for debugging
   */
  private storeError(entry: LogEntry): void {
    try {
      const errors = this.getStoredErrors();
      errors.push(entry);

      // Keep only last 50 errors
      const recentErrors = errors.slice(-50);
      localStorage.setItem("sambee_errors", JSON.stringify(recentErrors));
    } catch {
      // Ignore storage errors - console.warn would create circular logging
    }
  }

  /**
   * Get stored errors from local storage
   */
  getStoredErrors(): LogEntry[] {
    try {
      const stored = localStorage.getItem("sambee_errors");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  /**
   * Clear stored errors
   */
  clearStoredErrors(): void {
    try {
      localStorage.removeItem("sambee_errors");
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Get request ID from backend response header
   */
  extractRequestId(headers?: Record<string, string>): string | undefined {
    if (!headers) return undefined;
    return headers["x-request-id"] || headers["X-Request-ID"];
  }
}

// Export singleton instance
export const logger = new Logger();

// Export convenience functions
export const debug = (message: string, context?: LogContext) => logger.debug(message, context);
export const info = (message: string, context?: LogContext) => logger.info(message, context);
export const warn = (message: string, context?: LogContext) => logger.warn(message, context);
export const error = (message: string, context?: LogContext, err?: Error) =>
  logger.error(message, context, err);

export default logger;
