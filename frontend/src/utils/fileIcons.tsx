import {
  Archive as ArchiveIcon,
  AudioFile as AudioIcon,
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
import { getFileIcon as getFileIconInfo, type IconIdentifier } from "./FileTypeRegistry";

interface FileIconProps {
  filename: string;
  isDirectory: boolean;
  size?: number;
}

// Map icon identifiers to actual Material-UI components
const iconComponents: Record<IconIdentifier, typeof FileIcon> = {
  archive: ArchiveIcon,
  audio: AudioIcon,
  code: CodeIcon,
  doc: DocIcon,
  file: FileIcon,
  folder: FolderIcon,
  image: ImageIcon,
  pdf: PdfIcon,
  spreadsheet: SpreadsheetIcon,
  text: TextIcon,
  video: VideoIcon,
};

/**
 * Get a colorful Material-UI icon for file types
 * Uses the centralized FileTypeRegistry for consistency
 */
export const getFileIcon = ({ filename, isDirectory, size = 24 }: FileIconProps) => {
  const iconSize = { fontSize: size };
  const iconInfo = getFileIconInfo({ filename, isDirectory });

  const IconComponent = iconComponents[iconInfo.icon];
  return <IconComponent sx={{ ...iconSize, color: iconInfo.color }} />;
};
