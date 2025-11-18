/**
 * Unified File Type Registry
 *
 * Single source of truth for all file type information including:
 * - File extensions and MIME types
 * - Preview component mappings
 * - Icon and color assignments
 * - Category classifications
 */

import type React from "react";

// ============================================================================
// Types
// ============================================================================

export interface ViewerComponentProps {
  connectionId: string;
  path: string;
  onClose: () => void;
  // Gallery mode support
  images?: string[];
  currentIndex?: number;
  onCurrentIndexChange?: (index: number) => void;
}

export type ViewerComponent = React.ComponentType<ViewerComponentProps>;

export type FileCategory =
  | "image"
  | "document"
  | "text"
  | "video"
  | "audio"
  | "archive"
  | "code"
  | "spreadsheet"
  | "directory"
  | "other";

// Icon identifier - matches icon names from fileIcons.tsx
export type IconIdentifier =
  | "image"
  | "text"
  | "pdf"
  | "doc"
  | "spreadsheet"
  | "code"
  | "video"
  | "audio"
  | "archive"
  | "folder"
  | "file";

export interface FileIconInfo {
  icon: IconIdentifier;
  color: string;
}

interface FileTypeDefinition {
  extensions: string[]; // e.g., ['.jpg', '.jpeg']
  mimeTypes: string[]; // e.g., ['image/jpeg']
  category: FileCategory;
  viewerComponent?: () => Promise<{ default: ViewerComponent }>;
  icon: IconIdentifier;
  color: string;
  description?: string;
}

// ============================================================================
// Registry Data
// ============================================================================

const FILE_TYPE_REGISTRY: FileTypeDefinition[] = [
  // Images - Browser Native
  {
    extensions: [".jpg", ".jpeg", ".jpe", ".jfif"],
    mimeTypes: ["image/jpeg"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#00b4d8",
    description: "JPEG Image",
  },
  {
    extensions: [".png"],
    mimeTypes: ["image/png"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#00b4d8",
    description: "PNG Image",
  },
  {
    extensions: [".gif"],
    mimeTypes: ["image/gif"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#00b4d8",
    description: "GIF Animation",
  },
  {
    extensions: [".webp"],
    mimeTypes: ["image/webp"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#00b4d8",
    description: "WebP Image",
  },
  {
    extensions: [".svg"],
    mimeTypes: ["image/svg+xml"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#ffb13b",
    description: "SVG Vector",
  },
  {
    extensions: [".avif"],
    mimeTypes: ["image/avif"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#90e0ef",
    description: "AVIF Image",
  },

  // Images - Server Converted
  {
    extensions: [".tif", ".tiff"],
    mimeTypes: ["image/tiff", "image/x-tiff"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#0077b6",
    description: "TIFF Image",
  },
  {
    extensions: [".heic", ".heif"],
    mimeTypes: ["image/heic", "image/heif"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#0096c7",
    description: "HEIC/HEIF Image",
  },
  {
    extensions: [".bmp", ".dib"],
    mimeTypes: ["image/bmp", "image/x-ms-bmp"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#00b4d8",
    description: "Bitmap Image",
  },
  {
    extensions: [".ico"],
    mimeTypes: ["image/x-icon", "image/vnd.microsoft.icon"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#48cae4",
    description: "Icon File",
  },

  // Images - Advanced Formats (High Priority)
  {
    extensions: [".psd", ".psb"],
    mimeTypes: ["image/vnd.adobe.photoshop", "image/x-photoshop"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#31A8FF", // Adobe Photoshop blue
    description: "Adobe Photoshop Document",
  },
  {
    extensions: [".eps"],
    mimeTypes: ["application/postscript", "image/x-eps"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#FF9A00", // PostScript orange
    description: "Encapsulated PostScript",
  },
  {
    extensions: [".ai"],
    mimeTypes: ["application/postscript", "application/illustrator"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#FF7C00", // Adobe Illustrator orange
    description: "Adobe Illustrator",
  },
  {
    extensions: [".jp2", ".j2k", ".jpt", ".j2c", ".jpc"],
    mimeTypes: ["image/jp2", "image/jpx", "image/jpm"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#8b5cf6",
    description: "JPEG 2000",
  },
  {
    extensions: [".jxl"],
    mimeTypes: ["image/jxl"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#a855f7",
    description: "JPEG XL",
  },
  {
    extensions: [".exr"],
    mimeTypes: ["image/x-exr"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#ec4899",
    description: "OpenEXR HDR",
  },
  {
    extensions: [".hdr"],
    mimeTypes: ["image/vnd.radiance"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#f97316",
    description: "Radiance HDR",
  },

  // Images - Scientific/Medical (Medium Priority)
  {
    extensions: [".fits", ".fit", ".fts"],
    mimeTypes: ["image/fits", "application/fits"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#06b6d4",
    description: "FITS Astronomy",
  },
  {
    extensions: [".svs", ".ndpi", ".scn", ".mrxs", ".vms", ".vmu", ".bif"],
    mimeTypes: ["image/x-whole-slide"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#14b8a6",
    description: "Whole-Slide Image",
  },
  {
    extensions: [".img"],
    mimeTypes: ["image/x-img", "application/x-analyze"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#0ea5e9",
    description: "Medical Imaging",
  },
  {
    extensions: [".mat"],
    mimeTypes: ["application/x-matlab-data"],
    category: "image",
    viewerComponent: () => import("../components/Viewer/ImageViewer"),
    icon: "image",
    color: "#f59e0b",
    description: "MATLAB Image Data",
  },

  // Text - Markdown
  {
    extensions: [".md", ".markdown"],
    mimeTypes: ["text/markdown"],
    category: "text",
    viewerComponent: () => import("../components/Viewer/MarkdownViewer"),
    icon: "text",
    color: "#083fa1",
    description: "Markdown",
  },

  // Text - Plain
  {
    extensions: [".txt"],
    mimeTypes: ["text/plain"],
    category: "text",
    icon: "text",
    color: "#616161",
    description: "Text File",
  },

  // Documents
  {
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
    category: "document",
    icon: "pdf",
    color: "#ff0000",
    description: "PDF Document",
  },
  {
    extensions: [".doc", ".docx"],
    mimeTypes: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    category: "document",
    icon: "doc",
    color: "#2b579a",
    description: "Word Document",
  },
  {
    extensions: [".ppt", ".pptx"],
    mimeTypes: [
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    category: "document",
    icon: "doc",
    color: "#d24726",
    description: "PowerPoint",
  },

  // Spreadsheets
  {
    extensions: [".xls", ".xlsx"],
    mimeTypes: [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    category: "spreadsheet",
    icon: "spreadsheet",
    color: "#1d6f42",
    description: "Excel Spreadsheet",
  },
  {
    extensions: [".csv"],
    mimeTypes: ["text/csv"],
    category: "spreadsheet",
    icon: "spreadsheet",
    color: "#10793f",
    description: "CSV File",
  },

  // Code
  {
    extensions: [".js", ".jsx", ".mjs"],
    mimeTypes: ["text/javascript", "application/javascript"],
    category: "code",
    icon: "code",
    color: "#f7df1e",
    description: "JavaScript",
  },
  {
    extensions: [".ts", ".tsx"],
    mimeTypes: ["text/typescript", "application/typescript"],
    category: "code",
    icon: "code",
    color: "#3178c6",
    description: "TypeScript",
  },
  {
    extensions: [".py"],
    mimeTypes: ["text/x-python"],
    category: "code",
    icon: "code",
    color: "#3776ab",
    description: "Python",
  },
  {
    extensions: [".java"],
    mimeTypes: ["text/x-java"],
    category: "code",
    icon: "code",
    color: "#ed8b00",
    description: "Java",
  },
  {
    extensions: [".rb"],
    mimeTypes: ["text/x-ruby"],
    category: "code",
    icon: "code",
    color: "#cc342d",
    description: "Ruby",
  },
  {
    extensions: [".php"],
    mimeTypes: ["text/x-php"],
    category: "code",
    icon: "code",
    color: "#777bb4",
    description: "PHP",
  },
  {
    extensions: [".go"],
    mimeTypes: ["text/x-go"],
    category: "code",
    icon: "code",
    color: "#00add8",
    description: "Go",
  },
  {
    extensions: [".rs"],
    mimeTypes: ["text/x-rust"],
    category: "code",
    icon: "code",
    color: "#ce422b",
    description: "Rust",
  },
  {
    extensions: [".c"],
    mimeTypes: ["text/x-c"],
    category: "code",
    icon: "code",
    color: "#555555",
    description: "C",
  },
  {
    extensions: [".cpp", ".cc", ".cxx"],
    mimeTypes: ["text/x-c++"],
    category: "code",
    icon: "code",
    color: "#00599c",
    description: "C++",
  },
  {
    extensions: [".h", ".hpp"],
    mimeTypes: ["text/x-c", "text/x-c++"],
    category: "code",
    icon: "code",
    color: "#555555",
    description: "C/C++ Header",
  },
  {
    extensions: [".cs"],
    mimeTypes: ["text/x-csharp"],
    category: "code",
    icon: "code",
    color: "#239120",
    description: "C#",
  },

  // Web
  {
    extensions: [".html", ".htm"],
    mimeTypes: ["text/html"],
    category: "code",
    icon: "code",
    color: "#e34f26",
    description: "HTML",
  },
  {
    extensions: [".css"],
    mimeTypes: ["text/css"],
    category: "code",
    icon: "code",
    color: "#1572b6",
    description: "CSS",
  },
  {
    extensions: [".scss", ".sass"],
    mimeTypes: ["text/x-scss", "text/x-sass"],
    category: "code",
    icon: "code",
    color: "#cc6699",
    description: "SCSS/SASS",
  },

  // Data
  {
    extensions: [".json"],
    mimeTypes: ["application/json"],
    category: "code",
    icon: "code",
    color: "#5e5c5c",
    description: "JSON",
  },
  {
    extensions: [".xml"],
    mimeTypes: ["text/xml", "application/xml"],
    category: "code",
    icon: "code",
    color: "#0060ac",
    description: "XML",
  },
  {
    extensions: [".yaml", ".yml"],
    mimeTypes: ["text/yaml", "application/x-yaml"],
    category: "code",
    icon: "code",
    color: "#cb171e",
    description: "YAML",
  },

  // Video
  {
    extensions: [".mp4"],
    mimeTypes: ["video/mp4"],
    category: "video",
    icon: "video",
    color: "#8b5cf6",
    description: "MP4 Video",
  },
  {
    extensions: [".avi"],
    mimeTypes: ["video/x-msvideo"],
    category: "video",
    icon: "video",
    color: "#8b5cf6",
    description: "AVI Video",
  },
  {
    extensions: [".mov"],
    mimeTypes: ["video/quicktime"],
    category: "video",
    icon: "video",
    color: "#8b5cf6",
    description: "QuickTime Video",
  },
  {
    extensions: [".mkv"],
    mimeTypes: ["video/x-matroska"],
    category: "video",
    icon: "video",
    color: "#8b5cf6",
    description: "Matroska Video",
  },
  {
    extensions: [".webm"],
    mimeTypes: ["video/webm"],
    category: "video",
    icon: "video",
    color: "#8b5cf6",
    description: "WebM Video",
  },

  // Audio
  {
    extensions: [".mp3"],
    mimeTypes: ["audio/mpeg"],
    category: "audio",
    icon: "audio",
    color: "#ff4081",
    description: "MP3 Audio",
  },
  {
    extensions: [".wav"],
    mimeTypes: ["audio/wav", "audio/x-wav"],
    category: "audio",
    icon: "audio",
    color: "#ff4081",
    description: "WAV Audio",
  },
  {
    extensions: [".ogg"],
    mimeTypes: ["audio/ogg"],
    category: "audio",
    icon: "audio",
    color: "#ff4081",
    description: "OGG Audio",
  },
  {
    extensions: [".m4a"],
    mimeTypes: ["audio/mp4", "audio/x-m4a"],
    category: "audio",
    icon: "audio",
    color: "#ff4081",
    description: "M4A Audio",
  },
  {
    extensions: [".flac"],
    mimeTypes: ["audio/flac"],
    category: "audio",
    icon: "audio",
    color: "#8338ec",
    description: "FLAC Audio",
  },

  // Archives
  {
    extensions: [".zip"],
    mimeTypes: ["application/zip"],
    category: "archive",
    icon: "archive",
    color: "#ffae42",
    description: "ZIP Archive",
  },
  {
    extensions: [".rar"],
    mimeTypes: ["application/x-rar-compressed"],
    category: "archive",
    icon: "archive",
    color: "#ffae42",
    description: "RAR Archive",
  },
  {
    extensions: [".7z"],
    mimeTypes: ["application/x-7z-compressed"],
    category: "archive",
    icon: "archive",
    color: "#ffae42",
    description: "7-Zip Archive",
  },
  {
    extensions: [".tar"],
    mimeTypes: ["application/x-tar"],
    category: "archive",
    icon: "archive",
    color: "#ffae42",
    description: "TAR Archive",
  },
  {
    extensions: [".gz"],
    mimeTypes: ["application/gzip"],
    category: "archive",
    icon: "archive",
    color: "#ffae42",
    description: "GZip Archive",
  },
  {
    extensions: [".bz2"],
    mimeTypes: ["application/x-bzip2"],
    category: "archive",
    icon: "archive",
    color: "#ffae42",
    description: "BZip2 Archive",
  },

  // Shell scripts
  {
    extensions: [".sh", ".bash"],
    mimeTypes: ["text/x-shellscript"],
    category: "code",
    icon: "code",
    color: "#4eaa25",
    description: "Shell Script",
  },
  {
    extensions: [".bat", ".cmd"],
    mimeTypes: ["application/bat"],
    category: "code",
    icon: "code",
    color: "#c1f015",
    description: "Batch File",
  },
  {
    extensions: [".ps1"],
    mimeTypes: ["text/x-powershell"],
    category: "code",
    icon: "code",
    color: "#012456",
    description: "PowerShell",
  },
];

// ============================================================================
// Index Maps (for fast lookups)
// ============================================================================

const extensionMap = new Map<string, FileTypeDefinition>();
const mimeTypeMap = new Map<string, FileTypeDefinition>();

// Build indexes
for (const fileType of FILE_TYPE_REGISTRY) {
  for (const ext of fileType.extensions) {
    extensionMap.set(ext.toLowerCase(), fileType);
  }
  for (const mime of fileType.mimeTypes) {
    mimeTypeMap.set(mime.toLowerCase(), fileType);
  }
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get file type definition by extension
 */
export const getFileTypeByExtension = (filename: string): FileTypeDefinition | null => {
  const ext = `.${filename.toLowerCase().split(".").pop()}` || "";
  return extensionMap.get(ext) || null;
};

/**
 * Get file type definition by MIME type
 */
export const getFileTypeByMime = (mimeType: string): FileTypeDefinition | null => {
  return mimeTypeMap.get(mimeType.toLowerCase()) || null;
};

/**
 * Check if a file is an image
 */
export const isImageFile = (filename: string): boolean => {
  const fileType = getFileTypeByExtension(filename);
  return fileType?.category === "image";
};

/**
 * Check if a file is markdown
 */
export const isMarkdownFile = (filename: string): boolean => {
  const ext = `.${filename.toLowerCase().split(".").pop()}` || "";
  return ext === ".md" || ext === ".markdown";
};

/**
 * Get viewer component for a MIME type
 */
export const getViewerComponent = async (mimeType: string): Promise<ViewerComponent | null> => {
  const fileType = getFileTypeByMime(mimeType);
  if (!fileType?.viewerComponent) {
    return null;
  }

  try {
    const module = await fileType.viewerComponent();
    return module.default;
  } catch (error) {
    console.error(`Failed to load viewer component for ${mimeType}:`, error);
    return null;
  }
};

/**
 * Check if a MIME type has viewer support
 */
export const hasViewerSupport = (mimeType: string): boolean => {
  const fileType = getFileTypeByMime(mimeType);
  return fileType?.viewerComponent !== undefined;
};

/**
 * Get file icon identifier and color
 */
export const getFileIcon = (params: { filename: string; isDirectory: boolean }): FileIconInfo => {
  const { filename, isDirectory } = params;

  if (isDirectory) {
    return { icon: "folder", color: "#42a5f5" };
  }

  const fileType = getFileTypeByExtension(filename);
  if (fileType) {
    return { icon: fileType.icon, color: fileType.color };
  }

  // Default icon for unknown types
  return { icon: "file", color: "#757575" };
};

/**
 * Get all file types for a category
 */
export const getFileTypesByCategory = (category: FileCategory): FileTypeDefinition[] => {
  return FILE_TYPE_REGISTRY.filter((ft) => ft.category === category);
};
