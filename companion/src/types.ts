/**
 * TypeScript types for the Sambee Companion app.
 *
 * These types mirror the Rust structs exposed via Tauri commands, ensuring
 * type-safe communication between the frontend and backend.
 */

/**
 * A native desktop application that can open a given file type.
 *
 * Mirrors the Rust `NativeApp` struct from `app_registry/mod.rs`.
 */
export interface NativeApp {
  /** Display name shown in the app picker (e.g. "LibreOffice Writer"). */
  name: string;

  /** Path to the application executable. */
  executable: string;

  /** Optional Base64-encoded PNG icon for display in the picker UI. */
  icon: string | null;

  /** Whether this app is the OS default handler for the file type. */
  is_default: boolean;

  /** Whether the OS reports this app as a recommended/suggested handler. */
  is_recommended: boolean;
}
