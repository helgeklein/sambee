import type { ThemeConfig } from "../theme/types";

export type UserRole = "admin" | "editor" | "viewer";
export type ConnectionScope = "shared" | "private";
export type ConnectionAccessMode = "read_write" | "read_only";
export type SystemSettingSource = "database" | "config_file" | "default";
export type LanguagePreference = "browser" | "en" | "en-XA";
export type RegionalLocalePreference = string;
export type CompanionDownloadPlatform = "windows-x64" | "windows-arm64" | "macos-arm64" | "linux-x64";

export interface User {
  id?: string;
  username: string;
  name?: string | null;
  email?: string | null;
  role?: UserRole;
  is_active?: boolean;
  must_change_password?: boolean;
  expires_at?: string | null;
  access_token_expires_at?: string;
  created_at?: string;
}

export interface CurrentAccount extends User {
  id: string;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  expires_at: string | null;
  created_at: string;
  has_local_password: boolean;
  password_change_available: boolean;
  browser_session_management_available: boolean;
  oidc_provider_name: string | null;
}

export interface AuthToken extends User {
  access_token: string;
  token_type: string;
  oidc_refresh_generation?: number;
  return_path?: string;
}

export interface AdminUser {
  id: string;
  username: string;
  name?: string | null;
  email?: string | null;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
  has_local_password: boolean;
  oidc_role_assignment: UserRole | null;
  oidc: {
    identity_id: string;
    provider_display_name: string;
    last_login_at: string | null;
  } | null;
  pending_oidc: {
    expected_username: string;
    created_by_username: string;
    created_at: string;
  } | null;
}

export interface AdminUserCreateInput {
  username: string;
  name?: string;
  email?: string;
  role: UserRole;
  password?: string;
  must_change_password: boolean;
  expires_at?: string;
}

export interface AdminUserUpdateInput {
  username?: string;
  name?: string;
  email?: string;
  role?: UserRole;
  oidc_role_assignment?: UserRole | null;
  is_active?: boolean;
  expires_at?: string | null;
}

export interface AdminUserPasswordResetInput {
  new_password: string;
  must_change_password: boolean;
}

export interface AdminUserCreateResult extends AdminUser {
  temporary_password?: string | null;
}

export interface AdminUserPasswordResetResult {
  message: string;
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
  access_mode: ConnectionAccessMode;
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
  access_mode: ConnectionAccessMode;
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

export interface AboutSettings {
  version: string;
  build_time: string;
  git_commit: string;
  started_at: string;
  architecture: string;
  logical_cpu_count: number | null;
  memory_bytes: number | null;
  python_runtime: string;
}

export interface PublicSupportReport {
  content: string;
}

export interface NetworkSettings {
  public_url: string;
  trusted_proxy_cidrs: string[];
}

export interface NetworkSettingsUpdate {
  public_url: string;
  trusted_proxy_cidrs: string[];
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
    viewer_associations: Record<string, string>;
  };
  text_editor: {
    max_file_size_bytes: number;
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
    viewer_associations?: Record<string, string>;
  };
  text_editor?: {
    max_file_size_bytes?: number;
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

export interface EditLockInfo {
  lock_id: string;
  lock_capability?: string;
  operation_id?: string;
  file_path: string;
  locked_by: string;
  locked_at: string;
}

export interface EditLockStatus {
  locked: boolean;
  locked_by?: string | null;
  locked_at?: string | null;
}

export interface AuthToken {
  access_token: string;
  token_type: string;
  user_id?: string;
  username: string;
  name?: string | null;
  email?: string | null;
  role?: UserRole;
  expires_at?: string | null;
  must_change_password?: boolean;
  return_path?: string;
  access_token_expires_at?: string;
  oidc_refresh_generation?: number;
}

export interface OidcBrowserSession {
  id: string;
  status: "active" | "refresh_uncertain";
  created_at: string;
  authenticated_at: string;
  last_seen_at: string | null;
  last_refreshed_at: string | null;
  current: boolean;
}

export interface OidcBrowserSessionList {
  sessions: OidcBrowserSession[];
}

export interface OidcBrowserSessionRevokeResult {
  revoked_count: number;
}

export type AuthenticationMode = "none" | "password_only" | "oidc_or_password" | "oidc_only";
export type SignInMode = "password_only" | "oidc_or_password" | "oidc_only";
export type OidcAdmissionMode = "all_idp_users" | "selected_groups";
export type OidcRoleAssignmentMode = "uniform" | "group_based";

export interface OidcRoleMappings {
  admin: string[];
  editor: string[];
  viewer: string[];
}

export interface OidcReviewedPolicy {
  sign_in_mode: SignInMode;
  interactive_reauthentication_max_age_days: number;
  admission_mode: OidcAdmissionMode;
  admission_groups: string[];
  role_assignment_mode: OidcRoleAssignmentMode;
  uniform_role: UserRole;
  role_mappings: OidcRoleMappings;
}

export interface OidcConfigurationCandidate {
  display_name: string;
  issuer_url: string;
  client_id: string;
  client_secret?: string;
  scopes: string[];
  username_claim: string;
  name_claim: string | null;
  email_claim: string | null;
  groups_claim: string | null;
  sign_in_mode: SignInMode;
  interactive_reauthentication_max_age_days: number;
  admission_mode: OidcAdmissionMode;
  admission_groups: string[];
  role_assignment_mode: OidcRoleAssignmentMode;
  uniform_role: UserRole;
  role_mappings: OidcRoleMappings;
}

export interface RedactedOidcConfiguration extends Omit<OidcConfigurationCandidate, "client_secret"> {
  client_secret_configured: boolean;
  configuration_revision: number;
  identity_mapping_revision: number;
}

export interface AuthenticationHealth {
  public_url_configured: boolean;
  public_url: string | null;
  redirect_uri: string | null;
  status: "healthy" | "unhealthy";
  reasons: string[];
}

export interface OidcAdminConfigurationRead {
  configuration: RedactedOidcConfiguration | null;
  health: AuthenticationHealth;
  active_passwordless_user_count: number;
  auth_mode: AuthenticationMode;
  auth_mode_source: "ui" | "config_file";
}

export interface AuthenticationModeActivationResponse {
  auth_mode: AuthenticationMode;
  reauthentication_required: boolean;
}

export interface OidcTestStartResponse {
  flow_id: string;
  authorization_url: string;
}

export interface OidcReplacementMapping {
  target_user_id: string;
  local_username: string;
  local_role: UserRole;
  has_local_password: boolean;
  target_state: "active" | "inactive" | "expired";
  mapping_state: "unmapped" | "pending" | "established";
  suggested_username: string;
  prefill_source: "pending" | "last_seen" | "local";
  selected_by_default: boolean;
  selectable: boolean;
  omission_acknowledgement_required: boolean;
}

export interface OidcTestedIdentity {
  flow_id: string;
  candidate: RedactedOidcConfiguration;
  replacement_mappings: OidcReplacementMapping[];
  expected_identity_mapping_revision: number | null;
  admitted: boolean;
  matching_admission_group: string | null;
  affected_account_count: number;
  acting_administrator_affected: boolean;
  username: string;
  name: string | null;
  email: string | null;
  groups: string[];
  expires_at: string;
}

export interface OidcFinalizeResponse {
  configuration_revision: number;
  identity_mapping_revision: number;
  reauthentication_required: boolean;
}

export interface OidcMappingMutationResponse {
  identity_mapping_revision: number;
  pending_mappings: Array<{
    target_user_id: string;
    expected_username: string;
    created_at: string;
  }>;
}

export interface CompanionDownloadMetadata {
  source: "feed" | "pin";
  version: string;
  published_at?: string | null;
  notes: string;
  assets: Partial<Record<CompanionDownloadPlatform, string>>;
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

export interface OidcMappingValidationError {
  target_user_id: string | null;
  field: string | null;
  error_code: string;
  message: string;
}

export interface OidcMappingValidationDetail {
  errors: OidcMappingValidationError[];
}

// API Error type for axios errors
export interface ApiError {
  response?: {
    data?: {
      detail?: string | ConflictInfo | OidcMappingValidationDetail;
    };
    status?: number;
  };
  message?: string;
}

// Type guard for API errors
export function isApiError(error: unknown): error is ApiError {
  return typeof error === "object" && error !== null && ("response" in error || "message" in error);
}
