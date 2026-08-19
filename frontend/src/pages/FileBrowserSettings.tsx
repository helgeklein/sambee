import { Button, Checkbox, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveFormDialog } from "../components/Admin/ResponsiveFormDialog";
import { SettingsFieldHelp } from "../components/Settings/SettingsFieldHelp";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { settingsDestructiveButtonSx, settingsUtilityButtonSx } from "../components/Settings/settingsButtonStyles";
import api from "../services/api";
import { publishRecentDirectoriesChanged } from "../services/recentDirectoriesSync";
import { publishRecentFilesChanged } from "../services/recentFilesSync";
import {
  type QuickBarShortcutHintVisibility,
  useQuickBarShortcutHintVisibilityPreference,
  useQuickNavIncludeDotDirectoriesPreference,
} from "./FileBrowser/preferences";

type RecentHistoryKind = "files" | "directories";

export function FileBrowserSettings() {
  const [includeDotDirectories, setIncludeDotDirectories] = useQuickNavIncludeDotDirectoriesPreference();
  const [shortcutHintVisibility, setShortcutHintVisibility] = useQuickBarShortcutHintVisibilityPreference();
  const { t } = useTranslation();
  const [savedIncludeDotDirectories, setSavedIncludeDotDirectories] = useState(includeDotDirectories);
  const savedIncludeDotDirectoriesRef = useRef(savedIncludeDotDirectories);
  const [draftIncludeDotDirectories, setDraftIncludeDotDirectories] = useState(includeDotDirectories);
  const draftIncludeDotDirectoriesRef = useRef(draftIncludeDotDirectories);
  const [savedShortcutHintVisibility, setSavedShortcutHintVisibility] = useState(shortcutHintVisibility);
  const savedShortcutHintVisibilityRef = useRef(savedShortcutHintVisibility);
  const [draftShortcutHintVisibility, setDraftShortcutHintVisibility] = useState(shortcutHintVisibility);
  const draftShortcutHintVisibilityRef = useRef(draftShortcutHintVisibility);
  const [historyToClear, setHistoryToClear] = useState<RecentHistoryKind | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearHistoryError, setClearHistoryError] = useState<string | null>(null);

  useEffect(() => {
    const wasClean = draftIncludeDotDirectoriesRef.current === savedIncludeDotDirectoriesRef.current;
    savedIncludeDotDirectoriesRef.current = includeDotDirectories;
    setSavedIncludeDotDirectories(includeDotDirectories);

    if (wasClean) {
      draftIncludeDotDirectoriesRef.current = includeDotDirectories;
      setDraftIncludeDotDirectories(includeDotDirectories);
    }
  }, [includeDotDirectories]);

  useEffect(() => {
    const wasClean = draftShortcutHintVisibilityRef.current === savedShortcutHintVisibilityRef.current;
    savedShortcutHintVisibilityRef.current = shortcutHintVisibility;
    setSavedShortcutHintVisibility(shortcutHintVisibility);

    if (wasClean) {
      draftShortcutHintVisibilityRef.current = shortcutHintVisibility;
      setDraftShortcutHintVisibility(shortcutHintVisibility);
    }
  }, [shortcutHintVisibility]);

  const updateDraftIncludeDotDirectories = (enabled: boolean) => {
    draftIncludeDotDirectoriesRef.current = enabled;
    setDraftIncludeDotDirectories(enabled);
  };

  const updateDraftShortcutHintVisibility = (visibility: QuickBarShortcutHintVisibility) => {
    draftShortcutHintVisibilityRef.current = visibility;
    setDraftShortcutHintVisibility(visibility);
  };

  const selectedHistory =
    historyToClear === "files"
      ? {
          title: t("settings.fileBrowserPage.clearRecentFiles"),
          description: t("settings.fileBrowserPage.clearRecentFilesDescription"),
          failureMessage: t("settings.fileBrowserPage.clearRecentFilesFailed"),
          clear: () => api.clearRecentFiles(),
          publish: publishRecentFilesChanged,
        }
      : historyToClear === "directories"
        ? {
            title: t("settings.fileBrowserPage.clearRecentDirectories"),
            description: t("settings.fileBrowserPage.clearRecentDirectoriesDescription"),
            failureMessage: t("settings.fileBrowserPage.clearRecentDirectoriesFailed"),
            clear: () => api.clearRecentDirectories(),
            publish: publishRecentDirectoriesChanged,
          }
        : null;

  const openClearHistoryDialog = (historyKind: RecentHistoryKind) => {
    setClearHistoryError(null);
    setHistoryToClear(historyKind);
  };

  const clearSelectedHistory = async () => {
    if (!selectedHistory) {
      return;
    }

    setClearingHistory(true);
    try {
      await selectedHistory.clear();
      selectedHistory.publish();
      setClearHistoryError(null);
      setHistoryToClear(null);
    } catch {
      setClearHistoryError(selectedHistory.failureMessage);
    } finally {
      setClearingHistory(false);
    }
  };

  return (
    <SettingsPage
      category="file-browser"
      footerPrimaryActions={
        <Button
          variant="contained"
          disabled={
            draftIncludeDotDirectories === savedIncludeDotDirectories && draftShortcutHintVisibility === savedShortcutHintVisibility
          }
          onClick={() => {
            if (draftIncludeDotDirectories !== savedIncludeDotDirectories) {
              setIncludeDotDirectories(draftIncludeDotDirectories);
            }
            if (draftShortcutHintVisibility !== savedShortcutHintVisibility) {
              setShortcutHintVisibility(draftShortcutHintVisibility);
            }
          }}
        >
          {t("settings.advanced.saveChanges")}
        </Button>
      }
    >
      <SettingsGroup title={t("settings.fileBrowserPage.quickNavigationTitle")} sx={{ mb: 3 }}>
        <FormControlLabel
          control={
            <Checkbox checked={draftIncludeDotDirectories} onChange={(event) => updateDraftIncludeDotDirectories(event.target.checked)} />
          }
          label={t("settings.fileBrowserPage.includeDotDirectoriesLabel")}
          sx={{ m: 0 }}
        />
        <SettingsFieldHelp sx={{ maxWidth: 640 }}>{t("settings.fileBrowserPage.includeDotDirectoriesDescription")}</SettingsFieldHelp>
        <FormControl size="small" sx={{ alignSelf: "flex-start", mt: 2, minWidth: 260 }}>
          <InputLabel id="quick-bar-shortcut-hints-label">{t("settings.fileBrowserPage.shortcutHintsLabel")}</InputLabel>
          <Select
            labelId="quick-bar-shortcut-hints-label"
            label={t("settings.fileBrowserPage.shortcutHintsLabel")}
            value={draftShortcutHintVisibility}
            onChange={(event) => updateDraftShortcutHintVisibility(event.target.value as QuickBarShortcutHintVisibility)}
          >
            <MenuItem value="auto">{t("settings.fileBrowserPage.shortcutHintsAuto")}</MenuItem>
            <MenuItem value="always">{t("settings.fileBrowserPage.shortcutHintsAlways")}</MenuItem>
            <MenuItem value="never">{t("settings.fileBrowserPage.shortcutHintsNever")}</MenuItem>
          </Select>
        </FormControl>
        <SettingsFieldHelp sx={{ maxWidth: 640 }}>{t("settings.fileBrowserPage.shortcutHintsDescription")}</SettingsFieldHelp>
      </SettingsGroup>
      <SettingsGroup title={t("settings.fileBrowserPage.fileSearchTitle")}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignSelf: "flex-start" }}>
          <Button color="error" variant="outlined" onClick={() => openClearHistoryDialog("files")}>
            {t("settings.fileBrowserPage.clearRecentFiles")}
          </Button>
          <Button color="error" variant="outlined" onClick={() => openClearHistoryDialog("directories")}>
            {t("settings.fileBrowserPage.clearRecentDirectories")}
          </Button>
        </Stack>
      </SettingsGroup>
      <ResponsiveFormDialog
        open={selectedHistory !== null}
        onClose={() => {
          if (!clearingHistory) setHistoryToClear(null);
        }}
        disableClose={clearingHistory}
        title={selectedHistory?.title ?? ""}
        description={selectedHistory?.description ?? ""}
        actions={
          <>
            <Button variant="outlined" sx={settingsUtilityButtonSx} disabled={clearingHistory} onClick={() => setHistoryToClear(null)}>
              {t("common.actions.cancel")}
            </Button>
            <Button
              color="error"
              variant="contained"
              sx={settingsDestructiveButtonSx}
              disabled={clearingHistory}
              onClick={() => void clearSelectedHistory()}
            >
              {selectedHistory?.title}
            </Button>
          </>
        }
      >
        {clearHistoryError ? <SettingsFieldHelp sx={{ color: "error.main" }}>{clearHistoryError}</SettingsFieldHelp> : null}
      </ResponsiveFormDialog>
    </SettingsPage>
  );
}
