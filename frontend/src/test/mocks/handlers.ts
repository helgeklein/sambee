import { HttpResponse, http } from "msw";
import type { CurrentUserSettings } from "../../types";

const API_BASE = "http://localhost:3000/api";
const COMPANION_API_BASE = "http://localhost:21549/api";

function createAdvancedSettingsResponse() {
  return {
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
}

let advancedSettingsResponse = createAdvancedSettingsResponse();
let currentUserSettingsResponse: CurrentUserSettings = {
  appearance: {
    theme_id: "sambee-light",
    custom_themes: [],
  },
  localization: {
    language: "browser",
    regional_locale: "browser",
  },
  browser: {
    quick_nav_include_dot_directories: false,
    file_browser_view_mode: "list",
    pane_mode: "single",
    selected_connection_id: null,
  },
};

export const handlers = [
  // Companion - Health check
  http.get(`${COMPANION_API_BASE}/health`, () => {
    return HttpResponse.json({
      status: "ok",
      paired: false,
    });
  }),

  http.options(`${COMPANION_API_BASE}/health`, () => {
    return new HttpResponse(null, {
      status: 204,
    });
  }),

  // Version endpoint
  http.get(`${API_BASE}/version`, () => {
    return HttpResponse.json({
      version: "0.1.0-test",
      build_time: "2024-01-01T00:00:00Z",
      git_commit: "test-commit",
    });
  }),

  // Auth - Get auth config
  http.get(`${API_BASE}/auth/config`, () => {
    console.log("MSW: Auth config request received");
    return HttpResponse.json({
      auth_method: "password",
    });
  }),

  // Auth - Login
  http.post(`${API_BASE}/auth/token`, async ({ request }) => {
    const body = await request.formData();
    const username = body.get("username");
    const password = body.get("password");

    console.log("MSW: Login request received", { username, password });

    if (username === "admin" && password === "admin") {
      console.log("MSW: Returning admin token");
      return HttpResponse.json({
        access_token: "mock-admin-token",
        token_type: "bearer",
        user_id: "admin-id",
        username: "admin",
        role: "admin",
        is_admin: true,
        must_change_password: false,
      });
    }

    if (username === "testuser" && password === "testpass") {
      console.log("MSW: Returning user token");
      return HttpResponse.json({
        access_token: "mock-user-token",
        token_type: "bearer",
        user_id: "user-id",
        username: "testuser",
        role: "regular",
        is_admin: false,
        must_change_password: false,
      });
    }

    console.log("MSW: Invalid credentials");
    return HttpResponse.json({ detail: "Incorrect username or password" }, { status: 401 });
  }),

  // Auth - Get current user
  http.get(`${API_BASE}/auth/me`, ({ request }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    if (token === "mock-admin-token") {
      return HttpResponse.json({
        id: "admin-id",
        username: "admin",
        role: "admin",
        is_admin: true,
        is_active: true,
        must_change_password: false,
        created_at: "2024-01-01T00:00:00",
      });
    }

    if (token === "mock-user-token") {
      return HttpResponse.json({
        id: "user-id",
        username: "testuser",
        role: "regular",
        is_admin: false,
        is_active: true,
        must_change_password: false,
        created_at: "2024-01-01T00:00:00",
      });
    }

    return HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 });
  }),

  // Auth - Change password
  http.post(`${API_BASE}/auth/change-password`, async ({ request }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 });
    }

    const body = await request.json();
    // biome-ignore lint/suspicious/noExplicitAny: mock response
    const { current_password, new_password } = body as any;

    // Mock: current password validation
    if (current_password === "wrongpass") {
      return HttpResponse.json({ detail: "Current password is incorrect" }, { status: 400 });
    }

    if (!new_password || new_password.length < 1) {
      return HttpResponse.json({ detail: "New password is required" }, { status: 400 });
    }

    return HttpResponse.json({ message: "Password changed successfully" });
  }),

  http.get(`${API_BASE}/auth/me/settings`, ({ request }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 });
    }

    return HttpResponse.json(currentUserSettingsResponse);
  }),

  http.put(`${API_BASE}/auth/me/settings`, async ({ request }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const appearance = body["appearance"] as Record<string, unknown> | undefined;
    const localization = body["localization"] as Record<string, unknown> | undefined;
    const browser = body["browser"] as Record<string, unknown> | undefined;

    if (typeof appearance?.["theme_id"] === "string") {
      currentUserSettingsResponse = {
        ...currentUserSettingsResponse,
        appearance: {
          ...currentUserSettingsResponse.appearance,
          theme_id: appearance["theme_id"],
        },
      };
    }

    if (Array.isArray(appearance?.["custom_themes"])) {
      currentUserSettingsResponse = {
        ...currentUserSettingsResponse,
        appearance: {
          ...currentUserSettingsResponse.appearance,
          custom_themes: appearance["custom_themes"] as CurrentUserSettings["appearance"]["custom_themes"],
        },
      };
    }

    if (localization?.["language"] === "browser" || localization?.["language"] === "en" || localization?.["language"] === "en-XA") {
      currentUserSettingsResponse = {
        ...currentUserSettingsResponse,
        localization: {
          ...currentUserSettingsResponse.localization,
          language: localization["language"],
        },
      };
    }

    if (typeof localization?.["regional_locale"] === "string") {
      currentUserSettingsResponse = {
        ...currentUserSettingsResponse,
        localization: {
          ...currentUserSettingsResponse.localization,
          regional_locale: localization["regional_locale"],
        },
      };
    }

    if (typeof browser?.["quick_nav_include_dot_directories"] === "boolean") {
      currentUserSettingsResponse = {
        ...currentUserSettingsResponse,
        browser: {
          ...currentUserSettingsResponse.browser,
          quick_nav_include_dot_directories: browser["quick_nav_include_dot_directories"],
        },
      };
    }

    if (browser?.["file_browser_view_mode"] === "list" || browser?.["file_browser_view_mode"] === "details") {
      currentUserSettingsResponse = {
        ...currentUserSettingsResponse,
        browser: {
          ...currentUserSettingsResponse.browser,
          file_browser_view_mode: browser["file_browser_view_mode"],
        },
      };
    }

    if (browser?.["pane_mode"] === "single" || browser?.["pane_mode"] === "dual") {
      currentUserSettingsResponse = {
        ...currentUserSettingsResponse,
        browser: {
          ...currentUserSettingsResponse.browser,
          pane_mode: browser["pane_mode"],
        },
      };
    }

    if (typeof browser?.["selected_connection_id"] === "string" || browser?.["selected_connection_id"] === null) {
      currentUserSettingsResponse = {
        ...currentUserSettingsResponse,
        browser: {
          ...currentUserSettingsResponse.browser,
          selected_connection_id: browser["selected_connection_id"],
        },
      };
    }

    return HttpResponse.json(currentUserSettingsResponse);
  }),

  // Connections - Get connections
  http.get(`${API_BASE}/connections`, ({ request }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 });
    }

    return HttpResponse.json([
      {
        id: "conn-123",
        name: "Test Server",
        type: "smb",
        host: "server.local",
        port: 445,
        share_name: "testshare",
        username: "smbuser",
        path_prefix: "/",
        scope: "shared",
        can_manage: true,
      },
      {
        id: "conn-456",
        name: "Backup Server",
        type: "smb",
        host: "backup.local",
        port: 445,
        share_name: "backups",
        username: "backupuser",
        path_prefix: "/",
        scope: "shared",
        can_manage: true,
      },
    ]);
  }),

  // Connections - Create connection
  http.post(`${API_BASE}/connections`, async ({ request }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 });
    }

    const body = await request.json();
    // biome-ignore lint/suspicious/noExplicitAny: mock response
    const connectionData = body as any;

    // Validate required fields
    if (!connectionData.name || !connectionData.host || !connectionData.share_name) {
      return HttpResponse.json({ detail: "Missing required fields" }, { status: 422 });
    }

    return HttpResponse.json({
      id: "conn-new",
      scope: "private",
      can_manage: true,
      ...connectionData,
    });
  }),

  http.get(`${API_BASE}/connections/visibility-options`, () => {
    return HttpResponse.json([
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
        available: true,
        unavailable_reason: null,
      },
    ]);
  }),

  // Connections - Update connection
  http.put(`${API_BASE}/connections/:id`, async ({ request, params }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 });
    }

    const body = await request.json();
    // biome-ignore lint/suspicious/noExplicitAny: mock response
    const connectionData = body as any;

    return HttpResponse.json({
      id: params["id"],
      scope: "private",
      can_manage: true,
      ...connectionData,
    });
  }),

  // Connections - Delete connection
  http.delete(`${API_BASE}/connections/:id`, ({ request }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 });
    }

    return HttpResponse.json({ message: "Connection deleted successfully" });
  }),

  http.get(`${API_BASE}/admin/users`, () => {
    return HttpResponse.json([
      {
        id: "admin-id",
        username: "admin",
        role: "admin",
        is_admin: true,
        is_active: true,
        must_change_password: false,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "user-id",
        username: "testuser",
        role: "regular",
        is_admin: false,
        is_active: true,
        must_change_password: false,
        created_at: "2024-01-02T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    ]);
  }),

  http.post(`${API_BASE}/admin/users`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;

    return HttpResponse.json(
      {
        id: "new-user-id",
        username: body["username"],
        role: body["role"],
        is_admin: body["role"] === "admin",
        is_active: true,
        must_change_password: body["must_change_password"] ?? true,
        created_at: "2024-01-03T00:00:00Z",
        updated_at: "2024-01-03T00:00:00Z",
        temporary_password: body["password"] ? null : "TempPass123!",
      },
      { status: 201 }
    );
  }),

  http.patch(`${API_BASE}/admin/users/:id`, async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;

    return HttpResponse.json({
      id: params["id"],
      username: body["username"] ?? "updated-user",
      role: body["role"] ?? "regular",
      is_admin: (body["role"] ?? "regular") === "admin",
      is_active: body["is_active"] ?? true,
      must_change_password: false,
      created_at: "2024-01-03T00:00:00Z",
      updated_at: "2024-01-04T00:00:00Z",
    });
  }),

  http.post(`${API_BASE}/admin/users/:id/reset-password`, ({ params }) => {
    return HttpResponse.json({
      message: `Password reset for ${params["id"]}`,
      temporary_password: "ResetPass123!",
    });
  }),

  http.delete(`${API_BASE}/admin/users/:id`, () => {
    return HttpResponse.json({ message: "User deleted successfully" });
  }),

  http.get(`${API_BASE}/admin/settings/advanced`, () => {
    return HttpResponse.json(advancedSettingsResponse);
  }),

  http.put(`${API_BASE}/admin/settings/advanced`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const nextResponse = createAdvancedSettingsResponse();
    const resetKeys = Array.isArray(body["reset_keys"]) ? body["reset_keys"] : [];

    if (!resetKeys.includes("smb.read_chunk_size_bytes")) {
      const smb = body["smb"] as Record<string, unknown> | undefined;
      const smbValue = smb?.["read_chunk_size_bytes"];
      if (typeof smbValue === "number") {
        nextResponse.smb.read_chunk_size_bytes.value = smbValue;
        nextResponse.smb.read_chunk_size_bytes.source = "database";
      }
    }

    const preprocessors = body["preprocessors"] as Record<string, unknown> | undefined;
    const imagemagick = preprocessors?.["imagemagick"] as Record<string, unknown> | undefined;
    if (!resetKeys.includes("preprocessors.imagemagick.max_file_size_bytes")) {
      const value = imagemagick?.["max_file_size_bytes"];
      if (typeof value === "number") {
        nextResponse.preprocessors.imagemagick.max_file_size_bytes.value = value;
        nextResponse.preprocessors.imagemagick.max_file_size_bytes.source = "database";
      }
    }

    if (!resetKeys.includes("preprocessors.imagemagick.timeout_seconds")) {
      const value = imagemagick?.["timeout_seconds"];
      if (typeof value === "number") {
        nextResponse.preprocessors.imagemagick.timeout_seconds.value = value;
        nextResponse.preprocessors.imagemagick.timeout_seconds.source = "database";
      }
    }

    advancedSettingsResponse = nextResponse;
    return HttpResponse.json(advancedSettingsResponse);
  }),

  // Browse - List directory
  http.get(`${API_BASE}/browse/:connectionId/list`, ({ request }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 });
    }

    const url = new URL(request.url);
    const path = url.searchParams.get("path") || "/";

    // Mock different responses based on path
    if (path === "/") {
      return HttpResponse.json({
        path: "/",
        items: [
          {
            name: "Documents",
            type: "directory",
            size: 0,
            modified: "2024-01-01T00:00:00",
          },
          {
            name: "Pictures",
            type: "directory",
            size: 0,
            modified: "2024-01-01T00:00:00",
          },
          {
            name: "readme.txt",
            type: "file",
            size: 1024,
            modified: "2024-01-01T00:00:00",
          },
        ],
        total: 3,
      });
    }

    if (path === "/Documents") {
      return HttpResponse.json({
        path: "/Documents",
        items: [
          {
            name: "report.pdf",
            type: "file",
            size: 2048,
            modified: "2024-01-01T00:00:00",
          },
          {
            name: "notes.txt",
            type: "file",
            size: 512,
            modified: "2024-01-01T00:00:00",
          },
        ],
        total: 2,
      });
    }

    // Default: empty directory
    return HttpResponse.json({
      path,
      items: [],
      total: 0,
    });
  }),

  // Viewer - Start stream
  // Viewer - Start file viewing
  http.get(`${API_BASE}/viewer/:connectionId/start`, ({ request }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 });
    }

    const url = new URL(request.url);
    const path = url.searchParams.get("path") || "";

    return HttpResponse.json({
      stream_id: "stream-123",
      file_path: path,
      mime_type: "text/plain",
      size: 1024,
    });
  }),

  // Viewer - Get file content
  http.get(`${API_BASE}/viewer/:connectionId/file`, ({ request }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 });
    }

    const url = new URL(request.url);
    const path = url.searchParams.get("path") || "";

    // Return markdown content for .md files
    if (path.endsWith(".md")) {
      return new HttpResponse("# Test Markdown\n\nThis is test content.", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
        },
      });
    }

    // Default: return plain text
    return new HttpResponse("Test file content", {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }),
];
