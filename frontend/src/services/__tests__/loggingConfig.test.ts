/**
 * Tests for logging configuration service
 *
 * Includes contract tests to ensure frontend types match backend API responses
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoggingConfig } from "../loggingConfig";
import { loggingConfig } from "../loggingConfig";

// Mock the API service
vi.mock("../api", () => ({
  apiService: {
    getLoggingConfig: vi.fn(),
  },
}));

import { apiService } from "../api";

describe("LoggingConfig Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Clear internal cache
    loggingConfig.clearCache();
  });

  describe("Contract Tests - Backend API Compatibility", () => {
    it("should handle backend API response format correctly", async () => {
      // This is the EXACT format the backend returns
      const backendResponse: LoggingConfig = {
        logging_enabled: true,
        logging_level: "INFO",
        tracing_enabled: true,
        tracing_level: "WARNING",
        tracing_components: ["ImageViewer", "Swiper"],
      };

      vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

      const config = await loggingConfig.getConfig();

      // Verify all required fields are present
      expect(config).toHaveProperty("logging_enabled");
      expect(config).toHaveProperty("logging_level");
      expect(config).toHaveProperty("tracing_enabled");
      expect(config).toHaveProperty("tracing_level");
      expect(config).toHaveProperty("tracing_components");

      // Verify types
      expect(typeof config.logging_enabled).toBe("boolean");
      expect(typeof config.logging_level).toBe("string");
      expect(typeof config.tracing_enabled).toBe("boolean");
      expect(typeof config.tracing_level).toBe("string");
      expect(Array.isArray(config.tracing_components)).toBe(true);

      // Verify values
      expect(config.logging_enabled).toBe(true);
      expect(config.logging_level).toBe("INFO");
      expect(config.tracing_enabled).toBe(true);
      expect(config.tracing_level).toBe("WARNING");
      expect(config.tracing_components).toEqual(["ImageViewer", "Swiper"]);
    });

    it("should handle all valid log levels from backend", async () => {
      const validLevels = ["DEBUG", "INFO", "WARNING", "ERROR"];

      for (const level of validLevels) {
        loggingConfig.clearCache();

        const backendResponse: LoggingConfig = {
          logging_enabled: false,
          logging_level: "WARNING",
          tracing_enabled: true,
          tracing_level: level,
          tracing_components: [],
        };

        vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

        const config = await loggingConfig.getConfig();
        expect(config.tracing_level).toBe(level);
      }
    });

    it("should handle empty components array from backend", async () => {
      const backendResponse: LoggingConfig = {
        logging_enabled: false,
        logging_level: "WARNING",
        tracing_enabled: false,
        tracing_level: "ERROR",
        tracing_components: [],
      };

      vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

      const config = await loggingConfig.getConfig();
      expect(config.tracing_components).toEqual([]);
    });

    it("should handle disabled state from backend", async () => {
      const backendResponse: LoggingConfig = {
        logging_enabled: false,
        logging_level: "WARNING",
        tracing_enabled: false,
        tracing_level: "ERROR",
        tracing_components: [],
      };

      vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

      const config = await loggingConfig.getConfig();
      expect(config.tracing_enabled).toBe(false);

      // When tracing disabled, level checking should return false
      expect(await loggingConfig.isLevelEnabled("DEBUG")).toBe(false);
      expect(await loggingConfig.isLevelEnabled("ERROR")).toBe(false);
    });
  });

  describe("Level Hierarchy Logic", () => {
    it("should correctly implement log level threshold (DEBUG)", async () => {
      const backendResponse: LoggingConfig = {
        logging_enabled: false,
        logging_level: "WARNING",
        tracing_enabled: true,
        tracing_level: "DEBUG",
        tracing_components: [],
      };

      vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

      // DEBUG enables all levels
      expect(await loggingConfig.isLevelEnabled("DEBUG")).toBe(true);
      expect(await loggingConfig.isLevelEnabled("INFO")).toBe(true);
      expect(await loggingConfig.isLevelEnabled("WARNING")).toBe(true);
      expect(await loggingConfig.isLevelEnabled("ERROR")).toBe(true);
    });

    it("should correctly implement log level threshold (INFO)", async () => {
      loggingConfig.clearCache();

      const backendResponse: LoggingConfig = {
        logging_enabled: false,
        logging_level: "WARNING",
        tracing_enabled: true,
        tracing_level: "INFO",
        tracing_components: [],
      };

      vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

      // INFO enables INFO, WARNING, ERROR (not DEBUG)
      expect(await loggingConfig.isLevelEnabled("DEBUG")).toBe(false);
      expect(await loggingConfig.isLevelEnabled("INFO")).toBe(true);
      expect(await loggingConfig.isLevelEnabled("WARNING")).toBe(true);
      expect(await loggingConfig.isLevelEnabled("ERROR")).toBe(true);
    });

    it("should correctly implement log level threshold (WARNING)", async () => {
      loggingConfig.clearCache();

      const backendResponse: LoggingConfig = {
        logging_enabled: false,
        logging_level: "WARNING",
        tracing_enabled: true,
        tracing_level: "WARNING",
        tracing_components: [],
      };

      vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

      // WARNING enables WARNING, ERROR (not DEBUG, INFO)
      expect(await loggingConfig.isLevelEnabled("DEBUG")).toBe(false);
      expect(await loggingConfig.isLevelEnabled("INFO")).toBe(false);
      expect(await loggingConfig.isLevelEnabled("WARNING")).toBe(true);
      expect(await loggingConfig.isLevelEnabled("ERROR")).toBe(true);
    });

    it("should correctly implement log level threshold (ERROR)", async () => {
      loggingConfig.clearCache();

      const backendResponse: LoggingConfig = {
        logging_enabled: false,
        logging_level: "WARNING",
        tracing_enabled: true,
        tracing_level: "ERROR",
        tracing_components: [],
      };

      vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

      // ERROR enables only ERROR
      expect(await loggingConfig.isLevelEnabled("DEBUG")).toBe(false);
      expect(await loggingConfig.isLevelEnabled("INFO")).toBe(false);
      expect(await loggingConfig.isLevelEnabled("WARNING")).toBe(false);
      expect(await loggingConfig.isLevelEnabled("ERROR")).toBe(true);
    });

    it("should handle case-insensitive level checking", async () => {
      const backendResponse: LoggingConfig = {
        logging_enabled: false,
        logging_level: "WARNING",
        tracing_enabled: true,
        tracing_level: "WARNING",
        tracing_components: [],
      };

      vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

      // Should work with different cases
      expect(await loggingConfig.isLevelEnabled("warning")).toBe(true);
      expect(await loggingConfig.isLevelEnabled("WARNING")).toBe(true);
      expect(await loggingConfig.isLevelEnabled("WaRnInG")).toBe(true);
    });

    it("should handle invalid log levels gracefully", async () => {
      const backendResponse: LoggingConfig = {
        logging_enabled: false,
        logging_level: "WARNING",
        tracing_enabled: true,
        tracing_level: "INVALID",
        tracing_components: [],
      };

      vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

      // Invalid levels should return false
      expect(await loggingConfig.isLevelEnabled("DEBUG")).toBe(false);
      expect(await loggingConfig.isLevelEnabled("INFO")).toBe(false);
    });
  });

  describe("Component Filtering", () => {
    it("should enable all components when components array is empty", async () => {
      const backendResponse: LoggingConfig = {
        logging_enabled: false,
        logging_level: "WARNING",
        tracing_enabled: true,
        tracing_level: "DEBUG",
        tracing_components: [],
      };

      vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

      expect(await loggingConfig.isComponentEnabled("ImageViewer")).toBe(true);
      expect(await loggingConfig.isComponentEnabled("Swiper")).toBe(true);
      expect(await loggingConfig.isComponentEnabled("AnyComponent")).toBe(true);
    });

    it("should filter components when list is provided", async () => {
      const backendResponse: LoggingConfig = {
        logging_enabled: false,
        logging_level: "WARNING",
        tracing_enabled: true,
        tracing_level: "DEBUG",
        tracing_components: ["ImageViewer", "Swiper"],
      };

      vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

      expect(await loggingConfig.isComponentEnabled("ImageViewer")).toBe(true);
      expect(await loggingConfig.isComponentEnabled("Swiper")).toBe(true);
      expect(await loggingConfig.isComponentEnabled("OtherComponent")).toBe(false);
    });
  });

  describe("Caching", () => {
    it("should cache configuration and not refetch within cache duration", async () => {
      const backendResponse: LoggingConfig = {
        logging_enabled: false,
        logging_level: "WARNING",
        tracing_enabled: true,
        tracing_level: "INFO",
        tracing_components: [],
      };

      vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

      // First call
      await loggingConfig.getConfig();
      expect(apiService.getLoggingConfig).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await loggingConfig.getConfig();
      expect(apiService.getLoggingConfig).toHaveBeenCalledTimes(1);
    });

    it("should use localStorage cache on initialization", async () => {
      const cachedConfig: LoggingConfig = {
        logging_enabled: true,
        logging_level: "INFO",
        tracing_enabled: true,
        tracing_level: "WARNING",
        tracing_components: ["Test"],
        timestamp: Date.now(),
      };

      localStorage.setItem("frontend_logging_config", JSON.stringify(cachedConfig));

      // Should load from cache without API call
      const config = await loggingConfig.getConfig();
      expect(apiService.getLoggingConfig).not.toHaveBeenCalled();
      expect(config.tracing_level).toBe("WARNING");
    });
  });

  describe("Error Handling", () => {
    it("should return disabled config when API fails", async () => {
      vi.mocked(apiService.getLoggingConfig).mockRejectedValue(new Error("Network error"));

      const config = await loggingConfig.getConfig();

      expect(config.logging_enabled).toBe(false);
      expect(config.logging_level).toBe("WARNING");
      expect(config.tracing_enabled).toBe(false);
      expect(config.tracing_level).toBe("ERROR");
      expect(config.tracing_components).toEqual([]);
    });
  });
});
