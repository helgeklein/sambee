import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import { ListItemIcon, ListItemText, Typography } from "@mui/material";
import { useCallback } from "react";
import { BROWSER_SHORTCUTS } from "../../../config/keyboardShortcuts";
import type { FileEntry } from "../../../types";
import type { SearchProvider, SearchResult, SearchStatusInfo } from "./types";

interface CurrentDirectoryFilterProviderOptions {
  files: FileEntry[];
  onSelect: (file: FileEntry) => void;
}

function FilterResultRow({ file }: { file: FileEntry }) {
  return (
    <>
      <ListItemIcon sx={{ minWidth: 36 }}>
        {file.type === "directory" ? (
          <FolderOutlinedIcon fontSize="small" color="action" />
        ) : (
          <DescriptionOutlinedIcon fontSize="small" color="action" />
        )}
      </ListItemIcon>
      <ListItemText
        primary={<Typography variant="body2">{file.name}</Typography>}
        secondary={file.type === "directory" ? "Directory" : "File"}
      />
    </>
  );
}

export function useCurrentDirectoryFilterProvider({ files, onSelect }: CurrentDirectoryFilterProviderOptions): SearchProvider {
  const fetchResults = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      const normalizedQuery = query.trim().toLowerCase();
      const filtered = files.filter((file) => !normalizedQuery || file.name.toLowerCase().includes(normalizedQuery));

      return filtered.map((file) => ({
        id: `${file.type}:${file.name}`,
        value: file.name,
        display: <FilterResultRow file={file} />,
      }));
    },
    [files]
  );

  const handleSelect = useCallback(
    (fileName: string) => {
      const file = files.find((entry) => entry.name === fileName);
      if (file) {
        onSelect(file);
      }
    },
    [files, onSelect]
  );

  const getStatusInfo = useCallback((): SearchStatusInfo | null => null, []);

  return {
    id: "current-directory-filter",
    modeLabel: "Filter",
    placeholder: "Filter files in the current directory",
    debounceMs: 0,
    minQueryLength: 0,
    fetchResults,
    onSelect: handleSelect,
    getStatusInfo,
    footerHint: (
      <>
        ↑↓ navigate&ensp;↵ open&ensp;<kbd>esc</kbd> close
      </>
    ),
    footerInfo: (resultCount) => `${resultCount} result${resultCount === 1 ? "" : "s"}`,
    shortcutHint: BROWSER_SHORTCUTS.FILTER_CURRENT_DIRECTORY.label,
  };
}
