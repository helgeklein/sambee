import KeyboardCommandKeyIcon from "@mui/icons-material/KeyboardCommandKey";
import { Box, ListItemIcon, ListItemText, Typography } from "@mui/material";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { BrowserCommandDefinition } from "../../../config/browserCommands";
import { BROWSER_SHORTCUTS } from "../../../config/keyboardShortcuts";
import type { SearchProvider, SearchResult, SearchSelectionBehavior, SearchStatusInfo } from "./types";

interface BrowserCommandsProviderOptions {
  commands: BrowserCommandDefinition[];
  onSelect: (command: BrowserCommandDefinition) => void;
}

function CommandResultRow({ command }: { command: BrowserCommandDefinition }) {
  return (
    <>
      <ListItemIcon sx={{ minWidth: 36 }}>
        <KeyboardCommandKeyIcon fontSize="small" color="action" />
      </ListItemIcon>
      <ListItemText
        disableTypography
        primary={
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, minWidth: 0 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {command.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {command.category}
                {command.description ? ` • ${command.description}` : ""}
              </Typography>
            </Box>
            {command.shortcutLabel ? (
              <Box
                component="kbd"
                sx={{
                  fontFamily: "inherit",
                  fontSize: "0.7rem",
                  lineHeight: 1,
                  px: 0.5,
                  py: 0.25,
                  borderRadius: 0.5,
                  border: 1,
                  borderColor: "divider",
                  color: "text.secondary",
                  whiteSpace: "nowrap",
                }}
              >
                {command.shortcutLabel}
              </Box>
            ) : null}
          </Box>
        }
      />
    </>
  );
}

export function useBrowserCommandsProvider({ commands, onSelect }: BrowserCommandsProviderOptions): SearchProvider {
  const { t } = useTranslation();
  const commandMap = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands]);

  const fetchResults = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      const normalizedQuery = query.trim().toLowerCase();
      const filtered = commands.filter((command) => {
        if (!normalizedQuery) {
          return true;
        }

        const haystack = [command.title, command.category, command.description ?? "", ...(command.keywords ?? [])].join(" ").toLowerCase();

        return haystack.includes(normalizedQuery);
      });

      return filtered.map((command) => ({
        id: command.id,
        value: command.id,
        display: <CommandResultRow command={command} />,
      }));
    },
    [commands]
  );

  const handleSelect = useCallback(
    (commandId: string): SearchSelectionBehavior => {
      const command = commandMap.get(commandId);
      if (command) {
        onSelect(command);
        return { focusTarget: command.selectionFocusTarget ?? "file-list" };
      }

      return { focusTarget: "file-list" };
    },
    [commandMap, onSelect]
  );

  const getStatusInfo = useCallback((): SearchStatusInfo | null => null, []);

  return {
    id: "browser-commands",
    modeId: "commands",
    modeLabel: t("fileBrowser.search.modes.commands"),
    placeholder: t("fileBrowser.search.placeholders.command"),
    debounceMs: 0,
    minQueryLength: 0,
    fetchResults,
    onSelect: handleSelect,
    getStatusInfo,
    footerHint: (
      <>
        ↑↓ {t("fileBrowser.search.footer.navigate")}&ensp;↵ {t("fileBrowser.search.footer.run")}&ensp;<kbd>esc</kbd>{" "}
        {t("fileBrowser.search.footer.close")}
      </>
    ),
    footerInfo: (resultCount) =>
      t("fileBrowser.search.results.commandCount", {
        count: resultCount,
      }),
    shortcutHint: `${BROWSER_SHORTCUTS.COMMAND_PALETTE.label} / ${BROWSER_SHORTCUTS.COMMAND_PALETTE_ALTERNATE.label}`,
  };
}
