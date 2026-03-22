import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import { ListItemIcon, ListItemText, Typography } from "@mui/material";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { BROWSER_SHORTCUTS } from "../../../config/keyboardShortcuts";
import type { FileEntry } from "../../../types";
import type { SearchProvider, SearchResult, SearchStatusInfo } from "./types";

interface CurrentDirectoryFilterProviderOptions {
  files: FileEntry[];
  onSelect: (file: FileEntry) => void;
}

function FilterResultRow({ file }: { file: FileEntry }) {
  const { t } = useTranslation();

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
        secondary={file.type === "directory" ? t("fileBrowser.search.itemTypes.directory") : t("fileBrowser.search.itemTypes.file")}
      />
    </>
  );
}

export function useCurrentDirectoryFilterProvider({ files, onSelect }: CurrentDirectoryFilterProviderOptions): SearchProvider {
  const { t } = useTranslation();

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
    modeId: "filter",
    modeLabel: t("fileBrowser.search.modes.filter"),
    placeholder: t("fileBrowser.search.placeholders.filterCurrentDirectory"),
    debounceMs: 0,
    minQueryLength: 0,
    fetchResults,
    onSelect: handleSelect,
    getStatusInfo,
    footerHint: (
      <>
        ↑↓ {t("fileBrowser.search.footer.navigate")}&ensp;↵ {t("fileBrowser.search.footer.open")}&ensp;<kbd>esc</kbd>{" "}
        {t("fileBrowser.search.footer.close")}
      </>
    ),
    footerInfo: (resultCount) =>
      t("fileBrowser.search.results.count", {
        count: resultCount,
      }),
    shortcutHint: BROWSER_SHORTCUTS.FILTER_CURRENT_DIRECTORY.label,
  };
}
