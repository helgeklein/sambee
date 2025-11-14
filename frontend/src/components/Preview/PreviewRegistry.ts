/**
 * Preview Component Registry
 * Maps MIME types to appropriate preview components
 */

import type React from "react";

export interface PreviewComponentProps {
  connectionId: string;
  path: string;
  onClose: () => void;
  // Gallery mode support
  images?: string[];
  currentIndex?: number;
  onCurrentIndexChange?: (index: number) => void;
}

export type PreviewComponent = React.ComponentType<PreviewComponentProps>;

/**
 * Registry mapping MIME type patterns to preview components
 * Components are lazily loaded to reduce initial bundle size
 *
 * Note: Server-side conversion handles TIFF, HEIC, BMP, ICO and other
 * non-browser-native formats by converting them to JPEG/PNG before streaming
 */
const PREVIEW_REGISTRY: Map<RegExp, () => Promise<{ default: PreviewComponent }>> = new Map([
  [/^text\/markdown$/, () => import("./MarkdownPreview")],
  // Images - includes both browser-native and server-converted formats
  [
    /^image\/(png|jpeg|jpg|gif|webp|svg\+xml|tiff|heic|heif|bmp|x-ms-bmp|x-icon|vnd\.microsoft\.icon|x-tiff)$/i,
    () => import("./ImagePreview"),
  ],
  // Future preview components can be added here:
  // [/^application\/pdf$/, () => import('./PdfPreview')],
  // [/^text\/plain$/, () => import('./TextPreview')],
  // [/^video\//, () => import('./VideoPreview')],
  // [/^audio\//, () => import('./AudioPreview')],
]);

/**
 * Get the appropriate preview component for a given MIME type
 * @param mimeType - The MIME type of the file
 * @returns Promise resolving to preview component, or null if no preview available
 */
export const getPreviewComponent = async (mimeType: string): Promise<PreviewComponent | null> => {
  for (const [pattern, loader] of PREVIEW_REGISTRY) {
    if (pattern.test(mimeType)) {
      try {
        const module = await loader();
        return module.default;
      } catch (error) {
        console.error(`Failed to load preview component for ${mimeType}:`, error);
        return null;
      }
    }
  }
  return null;
};

/**
 * Check if a preview component exists for the given MIME type
 * @param mimeType - The MIME type to check
 * @returns true if a preview component exists
 */
export const hasPreviewSupport = (mimeType: string): boolean => {
  for (const [pattern] of PREVIEW_REGISTRY) {
    if (pattern.test(mimeType)) {
      return true;
    }
  }
  return false;
};

/**
 * Check if a file extension is supported for preview
 * This is a convenience method for quick checks without MIME type
 * @param filename - The filename to check
 * @returns true if the extension is likely supported
 *
 * Includes both browser-native formats and formats that are converted server-side:
 * - Browser-native: PNG, JPEG, GIF, WebP, SVG
 * - Server-converted: TIFF, HEIC/HEIF, BMP, ICO
 */
export const isImageFile = (filename: string): boolean => {
  return /\.(png|jpe?g|gif|webp|svg|tiff?|heic|heif|bmp|dib|ico|avif)$/i.test(filename);
};

export const isMarkdownFile = (filename: string): boolean => {
  return /\.(md|markdown)$/i.test(filename);
};
