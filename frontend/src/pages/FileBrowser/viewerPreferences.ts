import { loadCurrentUserSettings, patchCurrentUserSettings } from "../../services/userSettingsSync";
import type { ViewerId } from "../../utils/FileTypeRegistry";

const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream"]);

function getExtensionKey(filename: string): string | null {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) {
    return null;
  }

  return `ext:${filename.slice(dotIndex).toLowerCase()}`;
}

function getMimeKey(mimeType: string): string | null {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  if (GENERIC_MIME_TYPES.has(normalizedMimeType)) {
    return null;
  }

  return `mime:${normalizedMimeType}`;
}

export function getViewerAssociationKeys(filename: string, mimeType: string): string[] {
  const keys: string[] = [];
  const mimeKey = getMimeKey(mimeType);
  const extensionKey = getExtensionKey(filename);

  if (mimeKey) {
    keys.push(mimeKey);
  }

  if (extensionKey) {
    keys.push(extensionKey);
  }

  return keys;
}

export async function getPreferredViewerId(filename: string, mimeType: string): Promise<ViewerId | null> {
  const settings = await loadCurrentUserSettings();
  const associations = settings?.browser.viewer_associations ?? {};

  for (const key of getViewerAssociationKeys(filename, mimeType)) {
    const viewerId = associations[key];
    if (viewerId === "image" || viewerId === "markdown" || viewerId === "pdf") {
      return viewerId;
    }
  }

  return null;
}

export async function setPreferredViewerId(filename: string, mimeType: string, viewerId: ViewerId): Promise<void> {
  const settings = await loadCurrentUserSettings();
  const associations = { ...(settings?.browser.viewer_associations ?? {}) };

  for (const key of getViewerAssociationKeys(filename, mimeType)) {
    associations[key] = viewerId;
  }

  await patchCurrentUserSettings({
    browser: {
      viewer_associations: associations,
    },
  });
}
