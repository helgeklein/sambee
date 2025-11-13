import {
  FolderZip as ArchiveIcon,
  MusicNote as AudioIcon,
  Code as CodeIcon,
  Description as DocIcon,
  InsertDriveFile as FileIcon,
  Folder as FolderIcon,
  Image as ImageIcon,
  PictureAsPdf as PdfIcon,
  TableChart as SpreadsheetIcon,
  TextSnippet as TextIcon,
  Movie as VideoIcon,
} from "@mui/icons-material";

interface FileIconProps {
  filename: string;
  isDirectory: boolean;
  size?: number;
}

/**
 * Get a colorful Material-UI icon for file types
 * Icons are colored to represent their file type visually
 */
export const getFileIcon = ({ filename, isDirectory, size = 24 }: FileIconProps) => {
  const iconSize = { fontSize: size };

  if (isDirectory) {
    return <FolderIcon sx={{ ...iconSize, color: "#42a5f5" }} />; // Blue folder
  }

  const ext = filename.split(".").pop()?.toLowerCase() || "";

  // Code files - Color-coded by language
  if (["js", "jsx", "mjs"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#f7df1e" }} />; // JavaScript yellow
  }
  if (["ts", "tsx"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#3178c6" }} />; // TypeScript blue
  }
  if (["py"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#3776ab" }} />; // Python blue
  }
  if (["java"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#ed8b00" }} />; // Java orange
  }
  if (["rb"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#cc342d" }} />; // Ruby red
  }
  if (["php"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#777bb4" }} />; // PHP purple
  }
  if (["go"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#00add8" }} />; // Go cyan
  }
  if (["rs"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#ce422b" }} />; // Rust orange
  }

  // Web files
  if (["html", "htm"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#e34f26" }} />; // HTML orange
  }
  if (["css"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#1572b6" }} />; // CSS blue
  }
  if (["scss", "sass"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#cc6699" }} />; // SCSS pink
  }

  // Data files
  if (["json"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#5e5c5c" }} />; // JSON gray
  }
  if (["xml"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#0060ac" }} />; // XML blue
  }
  if (["yaml", "yml"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#cb171e" }} />; // YAML red
  }

  // Documents
  if (["pdf"].includes(ext)) {
    return <PdfIcon sx={{ ...iconSize, color: "#ff0000" }} />; // Red PDF
  }
  if (["doc", "docx"].includes(ext)) {
    return <DocIcon sx={{ ...iconSize, color: "#2b579a" }} />; // Word blue
  }
  if (["xls", "xlsx"].includes(ext)) {
    return <SpreadsheetIcon sx={{ ...iconSize, color: "#1d6f42" }} />; // Excel green
  }
  if (["csv"].includes(ext)) {
    return <SpreadsheetIcon sx={{ ...iconSize, color: "#10793f" }} />; // CSV green
  }
  if (["ppt", "pptx"].includes(ext)) {
    return <DocIcon sx={{ ...iconSize, color: "#d24726" }} />; // PowerPoint red
  }
  if (["txt"].includes(ext)) {
    return <TextIcon sx={{ ...iconSize, color: "#616161" }} />; // Text gray
  }
  if (["md", "markdown"].includes(ext)) {
    return <TextIcon sx={{ ...iconSize, color: "#083fa1" }} />; // Markdown blue
  }

  // Media - Images
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) {
    return <ImageIcon sx={{ ...iconSize, color: "#00b4d8" }} />; // Image cyan
  }
  if (["svg"].includes(ext)) {
    return <ImageIcon sx={{ ...iconSize, color: "#ffb13b" }} />; // SVG orange
  }

  // Media - Video
  if (["mp4", "avi", "mov", "mkv", "webm"].includes(ext)) {
    return <VideoIcon sx={{ ...iconSize, color: "#8b5cf6" }} />; // Video purple
  }

  // Media - Audio
  if (["mp3", "wav", "ogg", "m4a"].includes(ext)) {
    return <AudioIcon sx={{ ...iconSize, color: "#ff4081" }} />; // Audio pink
  }
  if (["flac"].includes(ext)) {
    return <AudioIcon sx={{ ...iconSize, color: "#8338ec" }} />; // FLAC purple
  }

  // Archives
  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext)) {
    return <ArchiveIcon sx={{ ...iconSize, color: "#ffae42" }} />; // Archive orange
  }

  // Shell scripts
  if (["sh", "bash", "zsh"].includes(ext)) {
    return <CodeIcon sx={{ ...iconSize, color: "#4eaa25" }} />; // Shell green
  }

  // Default
  return <FileIcon sx={{ ...iconSize, color: "#757575" }} />; // Gray default
};
