/**
 * Frontend logging configuration management
 *
 * Fetches and caches logging configuration from the backend.
 * Configuration is stored in localStorage for persistence across sessions.
 */

import { apiService } from "./api";
import { logger } from "./logger";

const STORAGE_KEY = "frontend_logging_config";
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export interface LoggingConfig {
  enabled: boolean;
  log_level: string; // Minimum log level: DEBUG, INFO, WARNING, ERROR
  components: string[];
  timestamp?: number;
}

class LoggingConfigManager {
  private config: LoggingConfig | null = null;
  private fetchPromise: Promise<LoggingConfig> | null = null;

  /**
   * Get logging configuration (from cache or fetch from server)
   */
  async getConfig(): Promise<LoggingConfig> {
    // Return cached config if valid
    if (this.config && this.isCacheValid()) {
      return this.config;
    }

    // If already fetching, return existing promise
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    // Fetch from server
    this.fetchPromise = this.fetchFromServer();
    try {
      this.config = await this.fetchPromise;
      return this.config;
    } finally {
      this.fetchPromise = null;
    }
  }

  /**
   * Check if a specific log level is enabled
   *
   * Uses threshold comparison: if config.log_level is "WARNING",
   * then WARNING and ERROR are enabled, but DEBUG and INFO are not.
   */
  async isLevelEnabled(level: string): Promise<boolean> {
    const config = await this.getConfig();
    if (!config.enabled) {
      return false;
    }

    // Log level hierarchy (lower index = lower severity)
    const hierarchy = ["DEBUG", "INFO", "WARNING", "ERROR"];
    const normalizedLevel = level.toUpperCase();
    const configLevel = config.log_level.toUpperCase();

    const levelIndex = hierarchy.indexOf(normalizedLevel);
    const configIndex = hierarchy.indexOf(configLevel);

    // If either level is invalid, default to disabled
    if (levelIndex === -1 || configIndex === -1) {
      return false;
    }

    // Level is enabled if it's at or above the configured minimum
    return levelIndex >= configIndex;
  }

  /**
   * Check if a specific component is enabled for logging
   */
  async isComponentEnabled(component: string): Promise<boolean> {
    const config = await this.getConfig();
    if (!config.enabled) {
      return false;
    }
    // Empty components array means all components enabled
    if (config.components.length === 0) {
      return true;
    }
    return config.components.includes(component);
  }

  /**
   * Clear cached configuration (forces refetch on next access)
   */
  clearCache(): void {
    this.config = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Fetch configuration from server
   */
  private async fetchFromServer(): Promise<LoggingConfig> {
    try {
      // Try to load from localStorage first
      const cached = this.loadFromLocalStorage();
      if (cached && this.isCacheValid(cached)) {
        this.config = cached;
        return cached;
      }

      // Fetch from server
      const config = await apiService.getLoggingConfig();
      const configWithTimestamp: LoggingConfig = {
        ...config,
        timestamp: Date.now(),
      };

      this.saveToLocalStorage(configWithTimestamp);
      return configWithTimestamp;
    } catch (error) {
      // If fetch fails, return disabled config as fallback
      logger.warn("Failed to fetch logging config, using disabled state", { error });
      return {
        enabled: false,
        log_level: "ERROR",
        components: [],
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Check if cached config is still valid
   */
  private isCacheValid(config: LoggingConfig | null = this.config): boolean {
    if (!config || !config.timestamp) {
      return false;
    }
    return Date.now() - config.timestamp < CACHE_DURATION_MS;
  }

  /**
   * Load configuration from localStorage
   */
  private loadFromLocalStorage(): LoggingConfig | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return null;
      }
      return JSON.parse(stored) as LoggingConfig;
    } catch {
      return null;
    }
  }

  /**
   * Save configuration to localStorage
   */
  private saveToLocalStorage(config: LoggingConfig = this.config!): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // Ignore localStorage errors
    }
  }
}

export const loggingConfig = new LoggingConfigManager();
