/**
 * Centralized logging service for the frontend.
 *
 * Provides structured logging with context, log levels, and optional backend forwarding.
 */

import { LogBuffer, type LogEntry as MobileLogEntry } from "./logBuffer";
import { LogTransport } from "./logTransport";

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
  private mobileLogBuffer: LogBuffer | null = null;
  private mobileLoggingEnabled = false;

  constructor() {
    this.isDevelopment = import.meta.env.DEV;
    // Detect test environment - vitest sets this or we can check if vitest globals exist
    this.isTest =
      import.meta.env.VITEST === true ||
      (typeof process !== "undefined" && process.env?.VITEST === "true") ||
      // Alternative: check if vitest globals are available
      (typeof globalThis !== "undefined" && ("describe" in globalThis || "it" in globalThis || "test" in globalThis));
    this.minLevel = this.isDevelopment ? LogLevel.DEBUG : LogLevel.INFO;
  }

  /**
   * Initialize mobile logging based on server configuration
   *
   * Should be called after user authentication to fetch user-specific logging config.
   */
  async initializeMobileLogging(): Promise<void> {
    // Don't enable in test environment
    if (this.isTest) {
      return;
    }

    try {
      const { loggingConfig } = await import("./loggingConfig");
      const config = await loggingConfig.getConfig();

      if (config.enabled) {
        this.enableMobileLogging();
        this.info("Mobile logging initialized from server config", {
          levels: config.levels,
          components: config.components,
        });
      }
    } catch (error) {
      // Silently fail - logging config is optional
      console.warn("Failed to initialize mobile logging config:", error);
    }
  }

  /**
   * Enable mobile logging to backend
   *
   * @param maxLogs - Maximum number of logs to buffer before auto-flush (default: 50)
   * @param flushIntervalMs - Time interval for auto-flush in milliseconds (default: 30000 = 30s)
   */
  enableMobileLogging(maxLogs = 50, flushIntervalMs = 30000): void {
    // Don't enable in test environment
    if (this.isTest) {
      return;
    }

    if (this.mobileLoggingEnabled) {
      return;
    }

    const transport = new LogTransport();
    this.mobileLogBuffer = new LogBuffer(
      async (batch) => {
        await transport.send(batch);
      },
      maxLogs,
      flushIntervalMs
    );

    this.mobileLogBuffer.enable();
    this.mobileLoggingEnabled = true;

    this.info("Mobile logging enabled", {
      sessionId: this.mobileLogBuffer.getSessionId(),
      maxLogs,
      flushIntervalMs,
    });
  }

  /**
   * Disable mobile logging to backend
   */
  disableMobileLogging(): void {
    if (!this.mobileLoggingEnabled || !this.mobileLogBuffer) {
      return;
    }

    this.info("Mobile logging disabled");

    // Flush any remaining logs before disabling
    void this.mobileLogBuffer.flush();
    this.mobileLogBuffer.disable();
    this.mobileLoggingEnabled = false;
  }

  /**
   * Manually flush mobile logs to backend
   */
  async flushMobileLogs(): Promise<void> {
    if (this.mobileLogBuffer) {
      await this.mobileLogBuffer.flush();
    }
  }

  /**
   * Log a debug message (also sends to mobile backend if enabled)
   */
  debugMobile(message: string, context?: LogContext, component?: string): void {
    this.debug(message, context);
    this.sendToMobileBackend(LogLevel.DEBUG, message, context, component);
  }

  /**
   * Log an info message (also sends to mobile backend if enabled)
   */
  infoMobile(message: string, context?: LogContext, component?: string): void {
    this.info(message, context);
    this.sendToMobileBackend(LogLevel.INFO, message, context, component);
  }

  /**
   * Log a warning message (also sends to mobile backend if enabled)
   */
  warnMobile(message: string, context?: LogContext, component?: string): void {
    this.warn(message, context);
    this.sendToMobileBackend(LogLevel.WARN, message, context, component);
  }

  /**
   * Log an error message (also sends to mobile backend if enabled)
   */
  errorMobile(message: string, context?: LogContext, component?: string, error?: Error): void {
    this.error(message, context, error);
    this.sendToMobileBackend(LogLevel.ERROR, message, context, component);
  }

  /**
   * Send a log entry to the mobile backend buffer
   */
  private async sendToMobileBackend(level: LogLevel, message: string, context?: LogContext, component?: string): Promise<void> {
    if (!this.mobileLoggingEnabled || !this.mobileLogBuffer) {
      return;
    }

    // Check if this log should be sent based on configuration
    try {
      const { loggingConfig } = await import("./loggingConfig");

      const levelName = LogLevel[level].toLowerCase();
      const levelEnabled = await loggingConfig.isLevelEnabled(levelName);
      if (!levelEnabled) {
        return;
      }

      if (component) {
        const componentEnabled = await loggingConfig.isComponentEnabled(component);
        if (!componentEnabled) {
          return;
        }
      }
    } catch {
      // If config check fails, don't send to avoid blocking
      return;
    }

    const entry: MobileLogEntry = {
      timestamp: Date.now(),
      level: LogLevel[level],
      message,
      context,
      component,
    };

    this.mobileLogBuffer.add(entry);
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
        console.debug(`%c${entry.timestamp} DEBUG`, "color: gray", fullMessage, entry.context || "");
        break;
      case LogLevel.INFO:
        console.info(`%c${entry.timestamp} INFO`, "color: blue", fullMessage, entry.context || "");
        break;
      case LogLevel.WARN:
        console.warn(`%c${entry.timestamp} WARN`, "color: orange", fullMessage, entry.context || "");
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
export const error = (message: string, context?: LogContext, err?: Error) => logger.error(message, context, err);

export default logger;
