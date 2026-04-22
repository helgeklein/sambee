import type { AxiosResponse } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock axios before importing the API service
vi.mock("axios", () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    defaults: { baseURL: "/api" },
    interceptors: {
      request: {
        use: vi.fn(),
        eject: vi.fn(),
      },
      response: {
        use: vi.fn(),
        eject: vi.fn(),
      },
    },
  };

  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
    },
  };
});

import axios from "axios";
import apiService from "../api";

const mockedAxios = vi.mocked(axios);
const mockAxiosInstance = mockedAxios.create() as ReturnType<typeof mockedAxios.create> & {
  post: ReturnType<typeof vi.fn>;
};

describe("Companion API", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    // Mock window.location.origin
    Object.defineProperty(window, "location", {
      value: { origin: "https://sambee.example.com", href: "" },
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getCompanionUri()", () => {
    it("builds a sambee:// URI with server, token, connection, and path", async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { uri_token: "test-uri-token-123", expires_in: 60 },
      } as AxiosResponse);

      const uri = await apiService.getCompanionUri("conn-1", "Documents/report.docx");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/companion/uri-token", {
        connection_id: "conn-1",
        path: "Documents/report.docx",
      });

      expect(uri).toContain("sambee://open?");
      expect(uri).toContain("server=https%3A%2F%2Fsambee.example.com");
      expect(uri).toContain("token=test-uri-token-123");
      expect(uri).toContain("connId=conn-1");
      expect(uri).toContain("path=Documents%2Freport.docx");
    });

    it("includes base64-encoded theme when provided", async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { uri_token: "tok-456", expires_in: 60 },
      } as AxiosResponse);

      const themeJson = JSON.stringify({ id: "dark", mode: "dark", primary: { main: "#90caf9" } });
      const uri = await apiService.getCompanionUri("conn-2", "Photos/img.jpg", themeJson);

      const expectedThemeB64 = btoa(themeJson);
      expect(uri).toContain(`theme=${expectedThemeB64}`);
    });

    it("omits theme parameter when not provided", async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { uri_token: "tok-789", expires_in: 60 },
      } as AxiosResponse);

      const uri = await apiService.getCompanionUri("conn-3", "file.txt");

      expect(uri).not.toContain("theme=");
    });

    it("encodes special characters in path", async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { uri_token: "tok-special", expires_in: 60 },
      } as AxiosResponse);

      const uri = await apiService.getCompanionUri("conn-1", "My Files/report (1).docx");

      expect(uri).toContain("path=My%20Files%2Freport%20(1).docx");
    });

    it("propagates API errors", async () => {
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: { status: 401, data: { detail: "Not authenticated" } },
      });

      await expect(apiService.getCompanionUri("conn-1", "file.txt")).rejects.toEqual(
        expect.objectContaining({
          response: expect.objectContaining({ status: 401 }),
        })
      );
    });
  });
});
