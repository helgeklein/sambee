export interface User {
  username: string;
  is_admin: boolean;
  created_at?: string;
}

export interface Connection {
  id: string;
  name: string;
  type: string;
  host: string;
  port: number;
  share_name: string;
  username: string;
  path_prefix?: string;
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

export interface AuthToken {
  access_token: string;
  token_type: string;
  username: string;
  is_admin: boolean;
}

// Alias for compatibility
export type FileEntry = FileInfo;

// API Error type for axios errors
export interface ApiError {
  response?: {
    data?: {
      detail?: string;
    };
    status?: number;
  };
  message?: string;
}

// Type guard for API errors
export function isApiError(error: unknown): error is ApiError {
  return typeof error === "object" && error !== null && ("response" in error || "message" in error);
}
