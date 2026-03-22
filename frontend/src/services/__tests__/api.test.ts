import type { AxiosResponse } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdvancedSystemSettings,
  AuthToken,
  Connection,
  ConnectionCreate,
  CurrentUserSettings,
  DirectoryListing,
  User,
} from "../../types";
import { FileType } from "../../types";

// Mock axios before importing the API service - use factory function
// The factory needs to define the mock instance inside
vi.mock("axios", () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
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

// Get reference to the mocked functions for assertions
import axios from "axios";
// Now import the API service (it will use the mocked axios.create)
import apiService from "../api";

const mockedAxios = vi.mocked(axios);
const mockAxiosInstance = mockedAxios.create() as ReturnType<typeof mockedAxios.create> & {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe("API Service", () => {
  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();

    // Reset all mock function calls
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("login() sets access token and returns auth data", async () => {
      const mockAuthToken: AuthToken = {
        access_token: "test-token",
        token_type: "bearer",
        username: "testuser",
        is_admin: false,
      };

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: mockAuthToken,
      } as AxiosResponse);

      const result = await apiService.login("testuser", "password123");

      expect(result).toEqual(mockAuthToken);
      expect(localStorage.getItem("access_token")).toBe("test-token");
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/auth/token", expect.any(FormData));
    });

    it("login() throws on invalid credentials", async () => {
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: { status: 401, data: { detail: "Invalid credentials" } },
      });

      await expect(apiService.login("wrong", "wrong")).rejects.toMatchObject({
        response: { status: 401 },
      });

      expect(localStorage.getItem("access_token")).toBeNull();
    });

    it("getCurrentUser() returns user data", async () => {
      const mockUser: User = {
        username: "testuser",
        is_admin: false,
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockUser,
      } as AxiosResponse);

      const result = await apiService.getCurrentUser();

      expect(result).toEqual(mockUser);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/auth/me");
    });

    it("getCurrentUser() infers admin status from role when is_admin is absent", async () => {
      const mockUser = {
        username: "adminuser",
        role: "admin" as const,
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockUser,
      } as AxiosResponse);

      const result = await apiService.getCurrentUser();

      expect(result).toEqual({
        username: "adminuser",
        role: "admin",
        is_admin: true,
      });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/auth/me");
    });

    it("changePassword() sends correct request", async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({ data: {} });

      await apiService.changePassword("oldpass", "newpass");

      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/auth/change-password", {
        current_password: "oldpass",
        new_password: "newpass",
      });
    });

    it("getCurrentUserSettings() returns persisted user settings", async () => {
      const mockSettings: CurrentUserSettings = {
        appearance: {
          theme_id: "sambee-dark",
          custom_themes: [
            {
              id: "custom-theme",
              name: "Custom Theme",
              mode: "light",
              primary: { main: "#123456" },
            },
          ],
        },
        localization: {
          language: "en",
          regional_locale: "en-GB",
        },
        browser: {
          quick_nav_include_dot_directories: true,
          file_browser_view_mode: "details",
          pane_mode: "dual",
          selected_connection_id: "conn-123",
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockSettings,
      } as AxiosResponse);

      const result = await apiService.getCurrentUserSettings();

      expect(result).toEqual(mockSettings);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/auth/me/settings");
    });

    it("updateCurrentUserSettings() sends the update payload", async () => {
      const updatedSettings: CurrentUserSettings = {
        appearance: {
          theme_id: "sambee-dark",
          custom_themes: [
            {
              id: "custom-theme",
              name: "Custom Theme",
              mode: "light",
              primary: { main: "#123456" },
            },
          ],
        },
        localization: {
          language: "en",
          regional_locale: "en-GB",
        },
        browser: {
          quick_nav_include_dot_directories: true,
          file_browser_view_mode: "details",
          pane_mode: "dual",
          selected_connection_id: "conn-123",
        },
      };

      mockAxiosInstance.put.mockResolvedValueOnce({
        data: updatedSettings,
      } as AxiosResponse);

      const result = await apiService.updateCurrentUserSettings({
        appearance: {
          theme_id: "sambee-dark",
          custom_themes: [
            {
              id: "custom-theme",
              name: "Custom Theme",
              mode: "light",
              primary: { main: "#123456" },
            },
          ],
        },
      });

      expect(result).toEqual(updatedSettings);
      expect(mockAxiosInstance.put).toHaveBeenCalledWith("/auth/me/settings", {
        appearance: {
          theme_id: "sambee-dark",
          custom_themes: [
            {
              id: "custom-theme",
              name: "Custom Theme",
              mode: "light",
              primary: { main: "#123456" },
            },
          ],
        },
      });
    });
  });

  describe("Connections Management", () => {
    it("getConnections() returns list of connections", async () => {
      const mockConnections: Connection[] = [
        {
          id: "1",
          name: "Test Server",
          slug: "test-server",
          type: "smb",
          host: "192.168.1.100",
          port: 445,
          share_name: "public",
          username: "user",
          path_prefix: "",
          scope: "shared",
          can_manage: true,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        {
          id: "2",
          name: "Backup Server",
          slug: "backup-server",
          type: "smb",
          host: "192.168.1.200",
          port: 445,
          share_name: "backup",
          username: "admin",
          path_prefix: "",
          scope: "shared",
          can_manage: true,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockConnections,
      } as AxiosResponse);

      const result = await apiService.getConnections();

      expect(result).toEqual(mockConnections);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/connections");
    });

    it("createConnection() posts data and returns new connection", async () => {
      const newConnection: ConnectionCreate = {
        name: "New Server",
        type: "smb",
        host: "192.168.1.50",
        port: 445,
        share_name: "data",
        username: "user",
        password: "pass",
        path_prefix: "",
        scope: "private",
      };

      const createdConnection: Connection = {
        id: "3",
        name: "New Server",
        slug: "new-server",
        type: "smb",
        host: "192.168.1.50",
        port: 445,
        share_name: "data",
        username: "user",
        path_prefix: "",
        scope: "private",
        can_manage: true,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: createdConnection,
      } as AxiosResponse);

      const result = await apiService.createConnection(newConnection);

      expect(result).toEqual(createdConnection);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/connections", newConnection);
    });

    it("getConnectionVisibilityOptions() returns server-driven visibility metadata", async () => {
      const options = [
        {
          value: "private",
          label: "Private to me",
          description: "Visible only to your account. You can fully manage it.",
          available: true,
          unavailable_reason: null,
        },
        {
          value: "shared",
          label: "Shared with everyone",
          description: "Visible to all users. Only admins can manage it.",
          available: false,
          unavailable_reason: "Shared connections can only be created or updated by admins.",
        },
      ];

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: options,
      } as AxiosResponse);

      const result = await apiService.getConnectionVisibilityOptions();

      expect(result).toEqual(options);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/connections/visibility-options");
    });

    it("updateConnection() updates data and returns updated connection", async () => {
      const updates: Partial<ConnectionCreate> = {
        name: "Updated Server",
        share_name: "newshare",
      };

      const updatedConnection: Connection = {
        id: "1",
        name: "Updated Server",
        slug: "test-server",
        type: "smb",
        host: "192.168.1.100",
        port: 445,
        share_name: "newshare",
        username: "user",
        path_prefix: "",
        scope: "shared",
        can_manage: true,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      };

      mockAxiosInstance.put.mockResolvedValueOnce({
        data: updatedConnection,
      } as AxiosResponse);

      const result = await apiService.updateConnection("1", updates);

      expect(result).toEqual(updatedConnection);
      expect(mockAxiosInstance.put).toHaveBeenCalledWith("/connections/1", updates);
    });

    it("getAdvancedSettings() returns admin advanced settings", async () => {
      const advancedSettings: AdvancedSystemSettings = {
        smb: {
          read_chunk_size_bytes: {
            key: "smb.read_chunk_size_bytes",
            label: "SMB read chunk size",
            description: "Chunk size used when streaming files from SMB shares.",
            value: 4194304,
            source: "default",
            default_value: 4194304,
            min_value: 65536,
            max_value: 16777216,
            step: 65536,
          },
        },
        preprocessors: {
          imagemagick: {
            max_file_size_bytes: {
              key: "preprocessors.imagemagick.max_file_size_bytes",
              label: "Maximum file size",
              description: "Largest input file ImageMagick is allowed to preprocess.",
              value: 104857600,
              source: "default",
              default_value: 104857600,
              min_value: 1048576,
              max_value: 1073741824,
              step: 1048576,
            },
            timeout_seconds: {
              key: "preprocessors.imagemagick.timeout_seconds",
              label: "Conversion timeout",
              description: "Maximum time allowed for an ImageMagick preprocessing run.",
              value: 30,
              source: "default",
              default_value: 30,
              min_value: 5,
              max_value: 600,
              step: 1,
            },
          },
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: advancedSettings,
      } as AxiosResponse);

      const result = await apiService.getAdvancedSettings();

      expect(result).toEqual(advancedSettings);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/admin/settings/advanced");
    });

    it("updateAdvancedSettings() forwards reset keys", async () => {
      const advancedSettings: AdvancedSystemSettings = {
        smb: {
          read_chunk_size_bytes: {
            key: "smb.read_chunk_size_bytes",
            label: "SMB read chunk size",
            description: "Chunk size used when streaming files from SMB shares.",
            value: 4194304,
            source: "default",
            default_value: 4194304,
            min_value: 65536,
            max_value: 16777216,
            step: 65536,
          },
        },
        preprocessors: {
          imagemagick: {
            max_file_size_bytes: {
              key: "preprocessors.imagemagick.max_file_size_bytes",
              label: "Maximum file size",
              description: "Largest input file ImageMagick is allowed to preprocess.",
              value: 104857600,
              source: "default",
              default_value: 104857600,
              min_value: 1048576,
              max_value: 1073741824,
              step: 1048576,
            },
            timeout_seconds: {
              key: "preprocessors.imagemagick.timeout_seconds",
              label: "Conversion timeout",
              description: "Maximum time allowed for an ImageMagick preprocessing run.",
              value: 30,
              source: "default",
              default_value: 30,
              min_value: 5,
              max_value: 600,
              step: 1,
            },
          },
        },
      };

      mockAxiosInstance.put.mockResolvedValueOnce({
        data: advancedSettings,
      } as AxiosResponse);

      const result = await apiService.updateAdvancedSettings({
        reset_keys: ["smb.read_chunk_size_bytes"],
      });

      expect(result).toEqual(advancedSettings);
      expect(mockAxiosInstance.put).toHaveBeenCalledWith("/admin/settings/advanced", {
        reset_keys: ["smb.read_chunk_size_bytes"],
      });
    });

    it("deleteConnection() removes connection", async () => {
      mockAxiosInstance.delete.mockResolvedValueOnce({ data: {} });

      await apiService.deleteConnection("1");

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/connections/1");
    });

    it("testConnection() returns status", async () => {
      const mockStatus = {
        status: "success",
        message: "Connection successful",
      };

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: mockStatus,
      } as AxiosResponse);

      const result = await apiService.testConnection("1");

      expect(result).toEqual(mockStatus);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/connections/1/test");
    });
  });

  describe("Browse Operations", () => {
    it("listDirectory() returns file listing for root path", async () => {
      const mockListing: DirectoryListing = {
        path: "/",
        items: [
          {
            name: "Documents",
            path: "/Documents",
            type: FileType.DIRECTORY,
            size: 0,
            modified_at: "2024-01-01T10:00:00",
            is_readable: true,
            is_hidden: false,
          },
          {
            name: "file.txt",
            path: "/file.txt",
            type: FileType.FILE,
            size: 1024,
            modified_at: "2024-01-01T11:00:00",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 2,
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockListing,
      } as AxiosResponse);

      const result = await apiService.listDirectory("conn1", "");

      expect(result).toEqual(mockListing);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/browse/conn1/list", {
        params: { path: "" },
      });
    });

    it("listDirectory() handles nested paths correctly", async () => {
      const mockListing: DirectoryListing = {
        path: "/Documents/Work",
        items: [
          {
            name: "report.pdf",
            path: "/Documents/Work/report.pdf",
            type: FileType.FILE,
            size: 2048,
            modified_at: "2024-01-02T10:00:00",
            is_readable: true,
            is_hidden: false,
          },
        ],
        total: 1,
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockListing,
      } as AxiosResponse);

      const result = await apiService.listDirectory("conn1", "/Documents/Work");

      expect(result).toEqual(mockListing);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/browse/conn1/list", {
        params: { path: "/Documents/Work" },
      });
    });

    it("getFileInfo() returns file metadata", async () => {
      const mockFileInfo = {
        name: "document.pdf",
        path: "/document.pdf",
        type: FileType.FILE,
        size: 5120,
        modified_at: "2024-01-03T10:00:00",
        is_readable: true,
        is_hidden: false,
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockFileInfo,
      } as AxiosResponse);

      const result = await apiService.getFileInfo("conn1", "/document.pdf");

      expect(result).toEqual(mockFileInfo);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/browse/conn1/info", {
        params: { path: "/document.pdf" },
      });
    });
  });

  describe("Viewer Operations", () => {
    it("getViewUrl() constructs correct URL with token", async () => {
      localStorage.setItem("access_token", "viewer-token");

      const url = await apiService.getViewUrl("conn1", "/test.pdf");

      expect(url).toContain("/viewer/conn1/file");
      expect(url).toContain("path=%2Ftest.pdf");
      expect(url).toContain("token=viewer-token");
    });

    it("getDownloadUrl() constructs correct URL with token", async () => {
      localStorage.setItem("access_token", "download-token");

      const url = await apiService.getDownloadUrl("conn1", "/data.zip");

      expect(url).toContain("/viewer/conn1/download");
      expect(url).toContain("path=%2Fdata.zip");
      expect(url).toContain("token=download-token");
    });

    it("getFileContent() fetches file content as text", async () => {
      localStorage.setItem("access_token", "content-token");

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: "File content here",
      } as AxiosResponse);

      const result = await apiService.getFileContent("conn1", "/readme.txt");

      expect(result).toBe("File content here");
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/viewer/conn1/file", {
        params: { path: "/readme.txt" },
        responseType: "text",
      });
    });
  });

  describe("Error Handling", () => {
    it("network errors are propagated", async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error("Network error"));

      await expect(apiService.getConnections()).rejects.toThrow("Network error");
    });

    it("500 errors are propagated", async () => {
      mockAxiosInstance.get.mockRejectedValueOnce({
        response: { status: 500, data: { detail: "Server error" } },
      });

      await expect(apiService.listDirectory("conn1", "/")).rejects.toMatchObject({
        response: { status: 500 },
      });
    });
  });

  describe("Convenience Functions", () => {
    it("login() convenience function works", async () => {
      const authResponse: AxiosResponse<AuthToken> = {
        data: {
          access_token: "token123",
          token_type: "bearer",
          username: "testuser",
          is_admin: false,
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {
          headers: {},
        } as unknown as AxiosResponse["config"],
      };
      mockAxiosInstance.post.mockResolvedValueOnce(authResponse);

      const { login } = await import("../api");
      const result = await login("user", "pass");

      expect(result).toEqual(authResponse.data);
      expect(localStorage.getItem("access_token")).toBe("token123");
    });

    it("browseFiles() convenience function returns items from first connection", async () => {
      const connections: Connection[] = [
        {
          id: "conn1",
          name: "Test",
          slug: "test",
          type: "smb",
          host: "192.168.1.100",
          port: 445,
          share_name: "share",
          username: "user",
          path_prefix: "/",
          scope: "shared",
          can_manage: true,
          created_at: "2024-01-01T00:00:00",
          updated_at: "2024-01-01T00:00:00",
        },
      ];

      const listing: DirectoryListing = {
        path: "/test",
        items: [
          {
            name: "file.txt",
            path: "/test/file.txt",
            type: FileType.FILE,
            size: 1024,
            is_readable: true,
            is_hidden: false,
            modified_at: "2024-01-01T00:00:00",
          },
        ],
        total: 1,
      };

      mockAxiosInstance.get.mockResolvedValueOnce({ data: connections } as unknown as AxiosResponse<Connection[]>).mockResolvedValueOnce({
        data: listing,
      } as AxiosResponse<DirectoryListing>);

      const { browseFiles } = await import("../api");
      const result = await browseFiles("/test", "token");

      expect(result).toEqual(listing.items);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/connections");
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/browse/conn1/list", {
        params: { path: "/test" },
      });
    });

    it("browseFiles() returns empty array when no connections exist", async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ data: [] } as unknown as AxiosResponse<Connection[]>);

      const { browseFiles } = await import("../api");
      const result = await browseFiles("/test", "token");

      expect(result).toEqual([]);
    });

    it("browseFiles() returns empty array on error", async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error("Network error"));

      const { browseFiles } = await import("../api");

      const result = await browseFiles("/test", "token");

      expect(result).toEqual([]);
      // Note: Error logging is suppressed during tests, so we don't check for it
    });
  });
});
