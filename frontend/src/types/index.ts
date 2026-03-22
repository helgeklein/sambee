import type { ThemeConfig } from "../theme/types";

export type UserRole = "admin" | "regular";
export type ConnectionScope = "shared" | "private";
export type SystemSettingSource = "database" | "config_file" | "default";
export type LanguagePreference = "browser" | "en" | "en-XA";
export type RegionalLocalePreference = string;

export interface User {
  id?: string;
  username: string;
  role?: UserRole;
  is_admin: boolean;
  is_active?: boolean;
  must_change_password?: boolean;
  created_at?: string;
}

export interface AdminUser {
  id: string;
  username: string;
  role: UserRole;
  is_admin: boolean;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminUserCreateInput {
  username: string;
  role: UserRole;
  password?: string;
  must_change_password: boolean;
}

export interface AdminUserUpdateInput {
  username?: string;
  role?: UserRole;
  is_active?: boolean;
}

export interface AdminUserCreateResult extends AdminUser {
  temporary_password?: string | null;
}

export interface AdminUserPasswordResetResult {
  message: string;
  temporary_password: string;
}

export interface Connection {
  id: string;
  name: string;
  slug: string;
  type: string;
  host: string;
  port: number;
  share_name: string;
  username: string;
  path_prefix?: string;
  scope: ConnectionScope;
  can_manage: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConnectionCreate {
  name: string;
  type: string;
  host: string;
  port: number;
  share_name: string;
  username: string;
  password: string;
  path_prefix?: string;
  scope: ConnectionScope;
}

export interface ConnectionVisibilityOption {
  value: ConnectionScope;
  label: string;
  description: string;
  available: boolean;
  unavailable_reason?: string | null;
}

export interface IntegerSystemSetting {
  key: string;
  label: string;
  description: string;
  value: number;
  source: SystemSettingSource;
  default_value: number;
  min_value: number;
  max_value: number;
  step: number;
}

export interface PreprocessorAdvancedSettings {
  max_file_size_bytes: IntegerSystemSetting;
  timeout_seconds: IntegerSystemSetting;
}

export interface AdvancedSystemSettings {
  smb: {
    read_chunk_size_bytes: IntegerSystemSetting;
  };
  preprocessors: {
    imagemagick: PreprocessorAdvancedSettings;
  };
}

export interface AdvancedSystemSettingsUpdate {
  smb?: {
    read_chunk_size_bytes?: number;
  };
  preprocessors?: {
    imagemagick?: {
      max_file_size_bytes?: number;
      timeout_seconds?: number;
    };
  };
  reset_keys?: string[];
}

export interface CurrentUserSettings {
  appearance: {
    theme_id: string;
    custom_themes: ThemeConfig[];
  };
  localization: {
    language: LanguagePreference;
    regional_locale: RegionalLocalePreference;
  };
  browser: {
    quick_nav_include_dot_directories: boolean;
    file_browser_view_mode: "list" | "details";
    pane_mode: "single" | "dual";
    selected_connection_id: string | null;
  };
}

export interface CurrentUserSettingsUpdate {
  appearance?: {
    theme_id?: string;
    custom_themes?: ThemeConfig[];
  };
  localization?: {
    language?: LanguagePreference;
    regional_locale?: RegionalLocalePreference;
  };
  browser?: {
    quick_nav_include_dot_directories?: boolean;
    file_browser_view_mode?: "list" | "details";
    pane_mode?: "single" | "dual";
    selected_connection_id?: string | null;
  };
}

export enum FileType {
  FILE = "file",
  DIRECTORY = "directory",
}

export interface FileInfo {
  name: string;
  path: string;
  type: FileType;
  size?: number;
  mime_type?: string;
  created_at?: string;
  modified_at?: string;
  is_readable: boolean;
  is_hidden: boolean;
}

export interface DirectoryListing {
  path: string;
  items: FileInfo[];
  total: number;
}

export interface DirectorySearchResult {
  results: string[];
  total_matches: number;
  cache_state: "empty" | "building" | "ready" | "updating";
  directory_count: number;
}

export interface AuthToken {
  access_token: string;
  token_type: string;
  user_id?: string;
  username: string;
  role?: UserRole;
  is_admin: boolean;
  must_change_password?: boolean;
}

// Alias for compatibility
export type FileEntry = FileInfo;

/**
 * Metadata returned in 409 responses when a copy/move destination
 * already exists.  Contains info about both the existing and incoming
 * items so the UI can show a meaningful overwrite-confirmation dialog.
 */
export interface ConflictInfo {
  existing_file: FileInfo;
  incoming_file: FileInfo;
}

// API Error type for axios errors
export interface ApiError {
  response?: {
    data?: {
      detail?: string | ConflictInfo;
    };
    status?: number;
  };
  message?: string;
}

// Type guard for API errors
export function isApiError(error: unknown): error is ApiError {
  return typeof error === "object" && error !== null && ("response" in error || "message" in error);
}
