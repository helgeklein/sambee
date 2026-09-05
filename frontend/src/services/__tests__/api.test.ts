import type { AxiosResponse } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdvancedSystemSettings,
  AuthToken,
  CompanionDownloadMetadata,
  Connection,
  ConnectionCreate,
  CurrentUserSettings,
  DirectoryListing,
  SmbSettings,
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
    request: vi.fn(),
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
      isAxiosError: vi.fn((error: unknown) => Boolean(error && typeof error === "object" && "isAxiosError" in error)),
      isCancel: vi.fn(() => false),
    },
  };
});

// Get reference to the mocked functions for assertions
import axios from "axios";
// Now import the API service (it will use the mocked axios.create)
import apiService, { OIDC_FINALIZATION_REQUEST_TIMEOUT_MS } from "../api";
import { authSession } from "../authSession";
import { getBackendAvailabilitySnapshot, markBackendUnavailable, resetBackendAvailabilityForTests } from "../backendAvailability";
import * as draftRecovery from "../draftRecovery";
import { logger } from "../logger";

const mockedAxios = vi.mocked(axios);
const mockAxiosInstance = mockedAxios.create() as ReturnType<typeof mockedAxios.create> & {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
};
const requestInterceptorUse = vi.mocked(mockAxiosInstance.interceptors.request.use);
const requestInterceptorHandlers = requestInterceptorUse.mock.calls[0] as
  | [((config: { url?: string; headers: Record<string, string> }) => Promise<unknown>)?, ((error: unknown) => Promise<never>)?]
  | undefined;
const requestHandler = requestInterceptorHandlers?.[0];
const responseInterceptorUse = vi.mocked(mockAxiosInstance.interceptors.response.use);
const responseInterceptorHandlers = responseInterceptorUse.mock.calls[0] as
  | [((response: AxiosResponse) => AxiosResponse | Promise<AxiosResponse>)?, ((error: unknown) => Promise<never>)?]
  | undefined;
const responseSuccessHandler = responseInterceptorHandlers?.[0];
const responseErrorHandler = responseInterceptorHandlers?.[1];

describe("API Service", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();
    authSession.clear();
    resetBackendAvailabilityForTests();

    vi.stubGlobal("fetch", fetchMock);

    // Reset all mock function calls
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("OIDC request classification", () => {
    it("refreshes before authenticated OIDC session-control requests", async () => {
      const refreshIfNeeded = vi.spyOn(authSession, "refreshIfNeeded").mockResolvedValue();

      await requestHandler?.({ url: "/auth/oidc/sessions", headers: {} });

      expect(refreshIfNeeded).toHaveBeenCalledOnce();
    });

    it("does not refresh before the public OIDC grant exchange", async () => {
      const refreshIfNeeded = vi.spyOn(authSession, "refreshIfNeeded").mockResolvedValue();

      await requestHandler?.({ url: "/auth/oidc/exchange", headers: {} });

      expect(refreshIfNeeded).not.toHaveBeenCalled();
    });

    it("retries a session-control 401 after refreshing the OIDC token", async () => {
      const requestRefresh = vi
        .spyOn(authSession, "requestRefresh")
        .mockResolvedValue({ access_token: "renewed-token", token_type: "bearer", username: "testuser" });
      mockAxiosInstance.request.mockResolvedValue({ data: { sessions: [] } });
      const error = {
        response: { status: 401, headers: {} },
        message: "Unauthorized",
        config: { url: "/auth/oidc/sessions", method: "get", headers: {} },
      };

      await expect(responseErrorHandler?.(error as never)).resolves.toEqual({ data: { sessions: [] } });

      expect(requestRefresh).toHaveBeenCalledOnce();
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(expect.objectContaining({ _oidcRetried: true }));
    });

    it("preserves drafts and redirects after a confirmed reauthentication response to a write", async () => {
      const snapshotDrafts = vi.spyOn(draftRecovery, "snapshotRegisteredDrafts");
      const error = {
        response: { status: 401, data: { detail: { code: "oidc_reauthentication_required" } }, headers: {} },
        message: "Unauthorized",
        config: { url: "/auth/change-password", method: "post", headers: {} },
      };

      await expect(responseErrorHandler?.(error as never)).rejects.toEqual(error);

      expect(snapshotDrafts).toHaveBeenCalledOnce();
      expect(window.location.assign).toHaveBeenCalledWith("/login?return_path=%2F");
      expect(authSession.requestRefresh).not.toHaveBeenCalled();
    });
  });

  it("uses a bounded timeout for OIDC finalization", async () => {
    mockAxiosInstance.post.mockResolvedValue({
      data: { configuration_revision: 3, identity_mapping_revision: 2, reauthentication_required: true },
    });

    await apiService.finalizeOidcConfiguration(
      "flow-id",
      {
        sign_in_mode: "oidc_only",
        interactive_reauthentication_max_age_days: 30,
        admission_mode: "selected_groups",
        admission_groups: ["users"],
        role_assignment_mode: "uniform",
        uniform_role: "editor",
        role_mappings: { admin: ["admins"], editor: [], viewer: [] },
      },
      [],
      1,
      []
    );

    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      "/admin/auth/oidc/finalize",
      {
        flow_id: "flow-id",
        reviewed_policy: {
          sign_in_mode: "oidc_only",
          interactive_reauthentication_max_age_days: 30,
          admission_mode: "selected_groups",
          admission_groups: ["users"],
          role_assignment_mode: "uniform",
          uniform_role: "editor",
          role_mappings: { admin: ["admins"], editor: [], viewer: [] },
        },
        replacement_mappings: [],
        expected_identity_mapping_revision: 1,
        omitted_account_acknowledgements: [],
      },
      { timeout: OIDC_FINALIZATION_REQUEST_TIMEOUT_MS }
    );
  });

  it("phase_10_stabilization_api_requires_a_supplied_idempotency_key", async () => {
    mockAxiosInstance.post.mockResolvedValue({
      data: { status: "completed", replaced: false, effects: { source: "unchanged", destination: "mutated" } },
    } as AxiosResponse);

    await apiService.copyItem("connection", "source.txt", "destination.txt", "00000000-0000-4000-8000-000000000003");

    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      "/browse/connection/copy",
      expect.objectContaining({ idempotency_key: "00000000-0000-4000-8000-000000000003" }),
      expect.anything()
    );
  });

  it("routes a same-provider move with its idempotency key", async () => {
    mockAxiosInstance.post.mockResolvedValue({
      data: { status: "completed", replaced: false, effects: { source: "mutated", destination: "mutated" } },
    } as AxiosResponse);

    await apiService.moveItem("connection", "source.txt", "destination.txt", "00000000-0000-4000-8000-000000000004");

    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      "/browse/connection/move",
      expect.objectContaining({ idempotency_key: "00000000-0000-4000-8000-000000000004" }),
      expect.anything()
    );
  });

  it("routes a cross-connection SMB copy through a durable transfer operation", async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { name: "source.txt", path: "source.txt", type: FileType.FILE, is_readable: true, is_hidden: false },
    } as AxiosResponse);
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { id: "transfer-1" } } as AxiosResponse).mockResolvedValueOnce({
      data: { status: "completed", replaced: false, effects: { source: "unchanged", destination: "mutated" } },
    } as AxiosResponse);

    await expect(
      apiService.copyItem("source", "source.txt", "destination.txt", "00000000-0000-4000-8000-000000000005", "destination")
    ).resolves.toMatchObject({ status: "completed" });

    expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
      1,
      "/browse/destination/transfer-operations",
      expect.objectContaining({
        kind: "copy",
        source_connection_id: "source",
        destination_path: "destination.txt",
        idempotency_key: "00000000-0000-4000-8000-000000000005",
      }),
      expect.anything()
    );
    expect(mockAxiosInstance.post).toHaveBeenNthCalledWith(
      2,
      "/browse/destination/transfer-operations/transfer-1/execute",
      {},
      expect.anything()
    );
  });

  it.each(["copy", "move"] as const)("routes a cross-connection SMB directory %s through the staged backend path", async (operation) => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { name: "source", path: "source", type: FileType.DIRECTORY, is_readable: true, is_hidden: false },
    } as AxiosResponse);
    mockAxiosInstance.post.mockResolvedValue({
      data: { status: "completed", replaced: false, effects: { source: "unchanged", destination: "mutated" } },
    } as AxiosResponse);

    await apiService[operation === "copy" ? "copyItem" : "moveItem"](
      "source",
      "source",
      "destination/source",
      "00000000-0000-4000-8000-000000000007",
      "destination"
    );

    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      `/browse/source/${operation}`,
      expect.objectContaining({ dest_connection_id: "destination" }),
      expect.anything()
    );
  });

  it.each(["copy", "move"] as const)("routes a cross-drive local %s through the Companion endpoint", async (operation) => {
    localStorage.setItem("companion_secret", "test-companion-secret");
    mockAxiosInstance.post.mockResolvedValue({
      data: { status: "completed", replaced: false, effects: { source: "unchanged", destination: "mutated" } },
    } as AxiosResponse);

    await apiService[operation === "copy" ? "copyItem" : "moveItem"](
      "local-drive:c",
      "source.txt",
      "output/source.txt",
      "00000000-0000-4000-8000-000000000006",
      "local-drive:d"
    );

    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      `/browse/c/${operation}`,
      expect.objectContaining({ dest_connection_id: "local-drive:d" }),
      expect.anything()
    );
    expect(mockAxiosInstance.post).not.toHaveBeenCalledWith(
      expect.stringContaining("transfer-operations"),
      expect.anything(),
      expect.anything()
    );
  });

  it("relays a cross-provider regular file as a stream without Blob buffering", async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { name: "source.txt", path: "source.txt", type: FileType.FILE, is_readable: true, is_hidden: false },
    } as AxiosResponse);
    const sourceResponse = new Response(new ReadableStream({ start: (controller) => controller.close() }));
    fetchMock.mockResolvedValueOnce(sourceResponse).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "completed", replaced: false, effects: { source: "unchanged", destination: "mutated" } }), {
        status: 200,
      })
    );

    await expect(apiService.transferAcrossBackends("copy", "source", "source.txt", "destination", "target.txt")).resolves.toMatchObject({
      status: "completed",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://localhost:3000/api/viewer/source/download?path=source.txt", expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/api/browse/destination/transfer-stream?path=target.txt",
      expect.objectContaining({ body: sourceResponse.body, duplex: "half" })
    );
  });

  it("stages a cross-provider directory tree before publishing its final name", async () => {
    mockAxiosInstance.get
      .mockResolvedValueOnce({
        data: { name: "source", path: "source", type: FileType.DIRECTORY, is_readable: true, is_hidden: false },
      } as AxiosResponse)
      .mockResolvedValueOnce({
        data: {
          path: "source",
          items: [{ name: "nested", path: "source/nested", type: FileType.DIRECTORY }],
        } satisfies DirectoryListing,
      } as AxiosResponse)
      .mockResolvedValueOnce({
        data: {
          path: "source/nested",
          items: [{ name: "report.txt", path: "source/nested/report.txt", type: FileType.FILE }],
        } satisfies DirectoryListing,
      } as AxiosResponse)
      .mockResolvedValueOnce({
        data: { name: "report.txt", path: "source/nested/report.txt", type: FileType.FILE, is_readable: true, is_hidden: false },
      } as AxiosResponse);
    mockAxiosInstance.post.mockResolvedValue({ data: {} } as AxiosResponse);
    const sourceResponse = new Response(new ReadableStream({ start: (controller) => controller.close() }));
    fetchMock.mockResolvedValueOnce(sourceResponse).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "completed", replaced: false, effects: { source: "unchanged", destination: "mutated" } }), {
        status: 200,
      })
    );

    await expect(apiService.transferAcrossBackends("copy", "source", "source", "destination", "output/source")).resolves.toMatchObject({
      status: "completed",
    });

    const postPaths = mockAxiosInstance.post.mock.calls.map(([path]) => path);
    expect(postPaths).toEqual(["/browse/destination/create", "/browse/destination/create", "/browse/destination/rename"]);
    expect(mockAxiosInstance.post.mock.calls[2]).toEqual([
      "/browse/destination/rename",
      expect.objectContaining({ path: expect.stringMatching(/^output\/\.source\.sambee-stage-/), new_name: "source" }),
      expect.anything(),
    ]);
  });

  it("reports source retention after a cross-provider directory move", async () => {
    mockAxiosInstance.get
      .mockResolvedValueOnce({
        data: { name: "source", path: "source", type: FileType.DIRECTORY, is_readable: true, is_hidden: false },
      } as AxiosResponse)
      .mockResolvedValueOnce({ data: { path: "source", items: [] } satisfies DirectoryListing } as AxiosResponse);
    mockAxiosInstance.post.mockResolvedValue({ data: {} } as AxiosResponse);

    await expect(apiService.transferAcrossBackends("move", "source", "source", "destination", "output/source")).resolves.toMatchObject({
      status: "completed_with_source_retained",
      effects: { source: "unchanged", destination: "mutated" },
    });
    expect(mockAxiosInstance.post).toHaveBeenLastCalledWith(
      "/browse/destination/rename",
      expect.objectContaining({ new_name: "source" }),
      expect.anything()
    );
  });

  it("phase_10_stabilization_no_response_returns_unknown_without_retry", async () => {
    mockAxiosInstance.post.mockRejectedValue({ isAxiosError: true, message: "Network Error" });

    await expect(
      apiService.copyItem("connection", "source.txt", "destination.txt", "00000000-0000-4000-8000-000000000001")
    ).resolves.toEqual({
      status: "outcome_unknown",
      replaced: false,
      effects: { source: "unknown", destination: "unknown" },
    });
    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
  });

  it("phase_10_stabilization_normalizes_unavailable_response", async () => {
    mockAxiosInstance.post.mockResolvedValue({
      data: {
        status: "failed",
        replaced: false,
        effects: { source: "unchanged", destination: "unchanged" },
        error: { code: "unavailable", detail: "Transfers are unavailable in this release" },
      },
    } as AxiosResponse);

    await expect(
      apiService.copyItem("connection", "source.txt", "destination.txt", "00000000-0000-4000-8000-000000000002")
    ).resolves.toEqual({
      status: "failed",
      replaced: false,
      effects: { source: "unchanged", destination: "unchanged" },
      error: { code: "unavailable", reason: "unsupported" },
    });
  });

  describe("Authentication", () => {
    it("login() sets access token and returns auth data", async () => {
      const mockAuthToken: AuthToken = {
        access_token: "test-token",
        token_type: "bearer",
        username: "testuser",
        role: "editor",
      };

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: mockAuthToken,
      } as AxiosResponse);

      const result = await apiService.login("testuser", "password123");

      expect(result).toEqual(mockAuthToken);
      expect(authSession.getAccessToken()).toBe("test-token");
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
        role: "editor",
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: mockUser,
      } as AxiosResponse);

      const result = await apiService.getCurrentUser();

      expect(result).toEqual(mockUser);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/auth/me");
    });

    it("getCurrentUser() preserves role-based admin data without synthesizing legacy flags", async () => {
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
          viewer_associations: {},
        },
        text_editor: {
          max_file_size_bytes: 1048576,
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
          viewer_associations: {},
        },
        text_editor: {
          max_file_size_bytes: 1048576,
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
          access_mode: "read_write",
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
          access_mode: "read_write",
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
        access_mode: "read_write",
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
        access_mode: "read_write",
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
        access_mode: "read_write",
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

    it("getAboutSettings() returns safe admin runtime information", async () => {
      const aboutSettings = {
        version: "0.9.24",
        build_time: "2026-08-02T10:00:00Z",
        git_commit: "5966e38",
        started_at: "2026-08-02T09:00:00Z",
        architecture: "x86_64",
        logical_cpu_count: 4,
        memory_bytes: 8589934592,
        python_runtime: "CPython 3.13.12",
      };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: aboutSettings } as AxiosResponse);

      const result = await apiService.getAboutSettings();

      expect(result).toEqual(aboutSettings);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/admin/settings/about");
    });

    it("getPublicSupportReport() returns public-safe support text", async () => {
      const supportReport = { content: "# Sambee public support report" };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: supportReport } as AxiosResponse);

      const result = await apiService.getPublicSupportReport();

      expect(result).toEqual(supportReport);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/admin/settings/support-report");
    });

    it("updateAdvancedSettings() forwards reset keys", async () => {
      const advancedSettings: AdvancedSystemSettings = {
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
        reset_keys: ["preprocessors.imagemagick.timeout_seconds"],
      });

      expect(result).toEqual(advancedSettings);
      expect(mockAxiosInstance.put).toHaveBeenCalledWith("/admin/settings/advanced", {
        reset_keys: ["preprocessors.imagemagick.timeout_seconds"],
      });
    });

    it("gets and updates dedicated SMB settings", async () => {
      const smbSettings: SmbSettings = {
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
        policy: {
          authentication_mode: "negotiate",
          encryption_mode: "signing_only",
          connection_timeout_seconds: 30,
        },
        policy_source: "default",
        require_signing: true,
        require_encryption: false,
      };
      mockAxiosInstance.get.mockResolvedValueOnce({ data: smbSettings } as AxiosResponse);
      mockAxiosInstance.put.mockResolvedValueOnce({ data: smbSettings } as AxiosResponse);

      await expect(apiService.getSmbSettings()).resolves.toEqual(smbSettings);
      await expect(apiService.updateSmbSettings({ reset_policy: true })).resolves.toEqual(smbSettings);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/admin/settings/smb");
      expect(mockAxiosInstance.put).toHaveBeenCalledWith("/admin/settings/smb", { reset_policy: true });
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

    it("getCompanionDownloads() returns backend-managed installer metadata", async () => {
      const metadata: CompanionDownloadMetadata = {
        source: "feed",
        version: "0.5.0",
        published_at: "2026-03-27T12:00:00Z",
        notes: "Release notes",
        assets: {
          "windows-x64": "https://downloads.example.test/Sambee-Companion.exe",
        },
      };

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: metadata,
      } as AxiosResponse);

      const result = await apiService.getCompanionDownloads();

      expect(result).toEqual(metadata);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/companion/downloads");
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
        timeout: 40000,
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
        timeout: 40000,
      });
    });

    it("listDirectory() accepts a custom timeout", async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { path: "/", items: [], total: 0 },
      } as AxiosResponse);

      await apiService.listDirectory("conn1", "/", { timeoutMs: 1500 });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/browse/conn1/list", {
        params: { path: "/" },
        timeout: 1500,
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

    it("resolveLocalActivation() resolves through the Companion API", async () => {
      const resolution = {
        drive_id: "d",
        path: "Documents/report.pdf",
        item: {
          name: "report.pdf",
          path: "Documents/report.pdf",
          type: FileType.FILE,
          is_readable: true,
          is_hidden: false,
        },
      };
      localStorage.setItem("companion_secret", "test-companion-secret");
      mockAxiosInstance.get.mockResolvedValueOnce({ data: resolution } as AxiosResponse);

      const result = await apiService.resolveLocalActivation("local-drive:c", "Links/report.lnk");

      expect(result).toEqual(resolution);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/browse/c/resolve-activation", {
        headers: expect.any(Object),
        params: { path: "Links/report.lnk" },
      });
    });

    it("listLocalLinkTargets() requests deferred Companion link metadata", async () => {
      const listing = {
        items: [
          {
            source_path: "Links/report.lnk",
            state: "resolved",
            target: { name: "report.pdf", path: "C:\\Users\\sambee\\Documents\\report.pdf", type: "file" },
          },
        ],
      };
      localStorage.setItem("companion_secret", "test-companion-secret");
      mockAxiosInstance.get.mockResolvedValueOnce({ data: listing } as AxiosResponse);

      const result = await apiService.listLocalLinkTargets("local-drive:c", "Links");

      expect(result).toEqual(listing);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/browse/c/link-targets", {
        headers: expect.any(Object),
        params: { path: "Links" },
        timeout: 15_000,
      });
    });

    it("starts a direct-local archive creation lifecycle execution", async () => {
      localStorage.setItem("companion_secret", "test-companion-secret");
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { execution_id: "create-1", kind: "create", phase: "accepted", revision: 1, cancellation_requested: false },
      } as AxiosResponse);

      await expect(
        apiService.startLocalArchiveCreation("local-drive:c", ["Documents/report.txt"], "Archives/backup.zip")
      ).resolves.toMatchObject({
        execution_id: "create-1",
        kind: "create",
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/browse/c/archive/v2/executions",
        { contract_version: "v2", kind: "create", source_paths: ["Documents/report.txt"], target_path: "Archives/backup.zip" },
        { headers: expect.any(Object) }
      );
    });

    it("retries local archive cancellation after a stale progress revision", async () => {
      localStorage.setItem("companion_secret", "test-companion-secret");
      mockAxiosInstance.post.mockRejectedValueOnce({ response: { status: 409 } }).mockResolvedValueOnce({
        data: { execution_id: "create-1", kind: "create", phase: "streaming", revision: 3, cancellation_requested: true },
      } as AxiosResponse);
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: { execution_id: "create-1", kind: "create", phase: "streaming", revision: 2, cancellation_requested: false },
      } as AxiosResponse);

      await expect(apiService.cancelLocalArchiveExecutionWithRevisionRetry("local-drive:c", "create-1", 1)).resolves.toMatchObject({
        revision: 3,
        cancellation_requested: true,
      });

      expect(mockAxiosInstance.post.mock.calls.slice(-2)).toEqual([
        [
          "/browse/c/archive/v2/executions/create-1/cancellation",
          { contract_version: "v2", expected_revision: 1 },
          { headers: expect.any(Object) },
        ],
        [
          "/browse/c/archive/v2/executions/create-1/cancellation",
          { contract_version: "v2", expected_revision: 2 },
          { headers: expect.any(Object) },
        ],
      ]);
    });
  });

  describe("Viewer Operations", () => {
    it("getViewUrl() constructs a token-free server URL", async () => {
      const url = await apiService.getViewUrl("conn1", "/test.pdf");

      expect(url).toContain("/viewer/conn1/file");
      expect(url).toContain("path=%2Ftest.pdf");
      expect(url).not.toContain("token=");
    });

    it("getDownloadUrl() constructs a token-free server URL", async () => {
      const url = await apiService.getDownloadUrl("conn1", "/data.zip");

      expect(url).toContain("/viewer/conn1/download");
      expect(url).toContain("path=%2Fdata.zip");
      expect(url).not.toContain("token=");
    });

    it("getOriginalFileBlob() fetches untransformed bytes from the download endpoint", async () => {
      authSession.setAuthenticated({ access_token: "download-token", token_type: "bearer", username: "testuser" }, false);
      const controller = new AbortController();
      const blob = new Blob(["original"]);
      fetchMock.mockResolvedValueOnce({ ok: true, blob: vi.fn().mockResolvedValueOnce(blob) });

      await expect(apiService.getOriginalFileBlob("conn1", "/photos/image.jxl", { signal: controller.signal })).resolves.toBe(blob);

      expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/viewer/conn1/download?path=%2Fphotos%2Fimage.jxl", {
        headers: { Authorization: "Bearer download-token" },
        signal: controller.signal,
      });
    });

    it("uses device-pixel viewport dimensions for physical and archive images", async () => {
      vi.stubGlobal("devicePixelRatio", 2);
      mockAxiosInstance.get
        .mockResolvedValueOnce({ data: new Blob(["archive"]), headers: {} } as AxiosResponse)
        .mockResolvedValueOnce({ data: new ArrayBuffer(0), headers: {} } as AxiosResponse);

      await apiService.getArchiveMember("conn1", "photos.zip", "photos/image.jxl", {
        request: { kind: "image", viewportWidth: 640, viewportHeight: 360 },
      });
      await apiService.getImageBlob("conn1", "photos/image.jxl", { viewportWidth: 640, viewportHeight: 360 });

      expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(
        1,
        "/archive/v2/inspection/member",
        expect.objectContaining({
          params: expect.objectContaining({ contract_version: "v2", connection_id: "conn1", viewport_width: 1280, viewport_height: 720 }),
          responseType: "blob",
        })
      );
      expect(mockAxiosInstance.get).toHaveBeenNthCalledWith(
        2,
        "/viewer/conn1/file",
        expect.objectContaining({
          params: expect.objectContaining({ path: "photos/image.jxl", viewport_width: 1280, viewport_height: 720 }),
          responseType: "arraybuffer",
        })
      );
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

    it("supportsEditLocks() reports server and Companion-local support", () => {
      expect(apiService.supportsEditLocks("conn1")).toBe(true);
      expect(apiService.supportsEditLocks("local-drive:c")).toBe(true);
    });

    it("saveTextFile() uploads text content to the same path", async () => {
      authSession.setAuthenticated({ access_token: "save-token", token_type: "bearer", username: "testuser" }, false);
      fetchMock.mockResolvedValueOnce({
        ok: true,
      });

      await apiService.saveTextFile("conn1", "/notes/readme.md", "# Updated\n");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: FormData }];
      expect(url).toBe("http://localhost:3000/api/browse/conn1/upload?path=%2Fnotes%2Freadme.md");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({ Authorization: "Bearer save-token" });
      expect(options.body).toBeInstanceOf(FormData);

      const uploadedFile = options.body.get("file");
      expect(uploadedFile).toBeInstanceOf(File);
      expect((uploadedFile as File).name).toBe("readme.md");
      expect((uploadedFile as File).type).toBe("text/plain;charset=utf-8");
      expect((uploadedFile as File).size).toBeGreaterThan(0);
    });

    it("acquireEditLock() calls the companion lock endpoint for server connections", async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          lock_id: "lock-1",
          lock_capability: "cap-1",
          operation_id: "op-1",
          file_path: "/docs/readme.md",
          locked_by: "alice",
          locked_at: "2026-03-23T12:00:00Z",
        },
      } as AxiosResponse);

      const result = await apiService.acquireEditLock("conn1", "/docs/readme.md", "session-1");

      expect(result).toEqual({
        lock_id: "lock-1",
        lock_capability: "cap-1",
        operation_id: "op-1",
        file_path: "/docs/readme.md",
        locked_by: "alice",
        locked_at: "2026-03-23T12:00:00Z",
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledWith("/browse/conn1/lock", undefined, { params: { path: "/docs/readme.md" } });
    });

    it("heartbeatEditLock() refreshes the server-side lock heartbeat", async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({ data: { status: "ok" } } as AxiosResponse);

      await apiService.heartbeatEditLock("conn1", "/docs/readme.md", {
        lock_id: "lock-1",
        lock_capability: "cap-1",
        operation_id: "op-1",
        file_path: "/docs/readme.md",
        locked_by: "alice",
        locked_at: "2026-03-23T12:00:00Z",
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/browse/conn1/lock/heartbeat",
        {
          operation_id: "op-1",
          lock_id: "lock-1",
          lock_capability: "cap-1",
        },
        {
          params: { path: "/docs/readme.md" },
        }
      );
    });

    it("releaseEditLock() releases the server-side lock", async () => {
      mockAxiosInstance.delete.mockResolvedValueOnce({ data: { status: "ok" } } as AxiosResponse);

      await apiService.releaseEditLock("conn1", "/docs/readme.md", {
        lock_id: "lock-1",
        lock_capability: "cap-1",
        operation_id: "op-1",
        file_path: "/docs/readme.md",
        locked_by: "alice",
        locked_at: "2026-03-23T12:00:00Z",
      });

      expect(mockAxiosInstance.delete).toHaveBeenCalledWith("/browse/conn1/lock", {
        params: { path: "/docs/readme.md" },
        data: {
          operation_id: "op-1",
          lock_id: "lock-1",
          lock_capability: "cap-1",
        },
      });
    });

    it("getEditLockStatus() reads server-side lock state", async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          locked: true,
          locked_by: "alice",
          locked_at: "2026-03-23T12:00:00Z",
        },
      } as AxiosResponse);

      const result = await apiService.getEditLockStatus("conn1", "/docs/readme.md");

      expect(result).toEqual({
        locked: true,
        locked_by: "alice",
        locked_at: "2026-03-23T12:00:00Z",
      });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith("/browse/conn1/lock-status", {
        params: { path: "/docs/readme.md" },
      });
    });

    it("getEditLockStatus() reads Companion-local lock state", async () => {
      localStorage.setItem("companion_secret", "test-companion-secret");
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { locked: true, locked_by: "alice" } } as AxiosResponse);

      const result = await apiService.getEditLockStatus("local-drive:c", "/docs/readme.md");

      expect(result).toEqual({ locked: true, locked_by: "alice" });
      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        "/browse/c/lock-status",
        expect.objectContaining({ params: { path: "/docs/readme.md" }, headers: expect.any(Object) })
      );
    });

    it("edit lock mutations use Companion-local routes", async () => {
      localStorage.setItem("companion_secret", "test-companion-secret");
      const lockInfo = {
        lock_id: "lock-1",
        lock_capability: "cap-1",
        operation_id: "op-1",
        file_path: "/docs/readme.md",
        locked_by: "alice",
        locked_at: "2026-03-23T12:00:00Z",
      };
      mockAxiosInstance.post.mockResolvedValue({ data: lockInfo } as AxiosResponse);
      mockAxiosInstance.delete.mockResolvedValue({ data: { status: "ok" } } as AxiosResponse);

      await expect(apiService.acquireEditLock("local-drive:c", "/docs/readme.md", "session-1")).resolves.toEqual(lockInfo);
      await apiService.heartbeatEditLock("local-drive:c", "/docs/readme.md", lockInfo);
      await apiService.releaseEditLock("local-drive:c", "/docs/readme.md", lockInfo);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/browse/c/lock",
        undefined,
        expect.objectContaining({ params: { path: "/docs/readme.md" }, headers: expect.any(Object) })
      );
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        "/browse/c/lock/heartbeat",
        {
          operation_id: "op-1",
          lock_id: "lock-1",
          lock_capability: "cap-1",
        },
        expect.objectContaining({ params: { path: "/docs/readme.md" }, headers: expect.any(Object) })
      );
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
        "/browse/c/lock",
        expect.objectContaining({
          params: { path: "/docs/readme.md" },
          data: {
            operation_id: "op-1",
            lock_id: "lock-1",
            lock_capability: "cap-1",
          },
          headers: expect.any(Object),
        })
      );
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

    it("marks the backend reconnecting on the first connectivity failure", async () => {
      const networkError = { code: "ERR_NETWORK", message: "Network error" };

      expect(responseErrorHandler).toBeDefined();
      await expect(responseErrorHandler?.(networkError)).rejects.toEqual(networkError);
      expect(getBackendAvailabilitySnapshot()).toMatchObject({
        status: "reconnecting",
        lastErrorMessage: "Network error",
      });
    });

    it("does not mark the backend reconnecting for viewer blob network failures", async () => {
      const networkError = {
        code: "ERR_NETWORK",
        message: "Network error",
        config: {
          method: "get",
          url: "/viewer/5532865d-cb5b-4fb1-9232-6716970f97db/file",
        },
      };

      expect(responseErrorHandler).toBeDefined();
      await expect(responseErrorHandler?.(networkError as never)).rejects.toEqual(networkError);
      expect(getBackendAvailabilitySnapshot()).toMatchObject({
        status: "available",
        lastErrorMessage: null,
      });
    });

    it("does not log an API error for a signal-aborted viewer blob request surfaced as a network error", async () => {
      const errorSpy = vi.spyOn(logger, "error");
      const networkError = {
        code: "ERR_NETWORK",
        message: "Network Error",
        config: {
          method: "get",
          url: "/viewer/5532865d-cb5b-4fb1-9232-6716970f97db/file",
          signal: { aborted: true },
        },
      };

      expect(responseErrorHandler).toBeDefined();
      await expect(responseErrorHandler?.(networkError as never)).rejects.toEqual(networkError);
      expect(errorSpy).not.toHaveBeenCalledWith("API request failed", expect.anything(), "api");
    });

    it("does not log an API error for a transient viewer blob network failure", async () => {
      const errorSpy = vi.spyOn(logger, "error");
      const networkError = {
        code: "ERR_NETWORK",
        message: "Network Error",
        config: {
          method: "get",
          url: "/viewer/5532865d-cb5b-4fb1-9232-6716970f97db/file",
        },
      };

      expect(responseErrorHandler).toBeDefined();
      await expect(responseErrorHandler?.(networkError as never)).rejects.toEqual(networkError);
      expect(errorSpy).not.toHaveBeenCalledWith("API request failed", expect.anything(), "api");
    });

    it("keeps the backend unavailable after another connectivity failure while already unavailable", async () => {
      const networkError = { code: "ERR_NETWORK", message: "Still offline" };

      markBackendUnavailable("Initial outage");

      expect(responseErrorHandler).toBeDefined();
      await expect(responseErrorHandler?.(networkError)).rejects.toEqual(networkError);
      expect(getBackendAvailabilitySnapshot()).toMatchObject({
        status: "unavailable",
        lastErrorMessage: "Still offline",
      });
    });

    it("marks the backend available again after a successful response", async () => {
      const response = {
        data: {},
        status: 200,
        statusText: "OK",
        headers: {},
        config: {
          method: "get",
          url: "/connections",
          headers: {},
        } as AxiosResponse["config"],
      } as AxiosResponse;

      markBackendUnavailable("Initial outage");

      expect(responseSuccessHandler).toBeDefined();
      expect(responseSuccessHandler?.(response)).toBe(response);
      expect(getBackendAvailabilitySnapshot()).toMatchObject({
        status: "available",
        lastErrorMessage: null,
      });
    });

    it("does not clear the token or redirect on 401 while backend recovery is active", async () => {
      const networkErrorHandler = responseErrorHandler;
      const authError = {
        response: { status: 401, data: { detail: "Unauthorized" }, headers: {} },
        message: "Unauthorized",
        config: { url: "/auth/me", method: "get" },
      };

      localStorage.setItem("access_token", "token-123");
      markBackendUnavailable("Recovery in progress");

      await expect(networkErrorHandler?.(authError as never)).rejects.toEqual(authError);
      expect(localStorage.getItem("access_token")).toBe("token-123");
      expect(getBackendAvailabilitySnapshot()).toMatchObject({
        status: "reconnecting",
        recoveryLock: true,
      });
      expect(window.location.href).not.toBe("/login");
    });
  });

  describe("Convenience Functions", () => {
    it("login() convenience function works", async () => {
      const authResponse: AxiosResponse<AuthToken> = {
        data: {
          access_token: "token123",
          token_type: "bearer",
          username: "testuser",
          role: "editor",
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
      expect(authSession.getAccessToken()).toBe("token123");
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
          access_mode: "read_write",
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
        timeout: 40000,
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
