import { Folder as FolderIcon } from "@mui/icons-material";
import { defaultStyles, FileIcon } from "react-file-icon";

interface FileIconProps {
  filename: string;
  isDirectory: boolean;
  size?: number;
}

/**
 * Get the appropriate icon component for a file or directory
 * Uses react-file-icon for files and Material-UI folder icon for directories
 */
export const getFileIcon = ({ filename, isDirectory, size = 24 }: FileIconProps) => {
  if (isDirectory) {
    return <FolderIcon color="primary" sx={{ fontSize: size }} />;
  }

  // Extract file extension
  const extension = filename.split(".").pop()?.toLowerCase() || "";

  // Use react-file-icon with appropriate styling
  return (
    <div style={{ width: size, height: size }}>
      <FileIcon extension={extension} {...(defaultStyles[extension] || defaultStyles.txt)} />
    </div>
  );
};
