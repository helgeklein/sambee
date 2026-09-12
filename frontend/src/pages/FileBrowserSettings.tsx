import { Box, Button, Checkbox, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveDialogShell } from "../components/Dialog/ResponsiveDialogShell";
import { SettingSaveStatus } from "../components/Settings/SettingSaveStatus";
import { SettingsFieldHelp } from "../components/Settings/SettingsFieldHelp";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { settingsDestructiveButtonSx, settingsUtilityButtonSx } from "../components/Settings/settingsButtonStyles";
import { useRestoreFocusAfterPending } from "../hooks/useRestoreFocusAfterPending";
import api from "../services/api";
import { publishRecentDirectoriesChanged } from "../services/recentDirectoriesSync";
import { publishRecentFilesChanged } from "../services/recentFilesSync";
import { useCurrentUserSetting } from "../services/userSettingsStore";
import type { QuickBarShortcutHintVisibility, TouchFriendlyFileSelection } from "./FileBrowser/preferences";

type RecentHistoryKind = "files" | "directories";

export function FileBrowserSettings() {
  const includeDotDirectoriesSetting = useCurrentUserSetting("browser.quick_nav_include_dot_directories");
  const shortcutHintVisibilitySetting = useCurrentUserSetting("browser.quick_bar_shortcut_hint_visibility");
  const touchFriendlyFileSelectionSetting = useCurrentUserSetting("browser.touch_friendly_file_selection");
  const restoreIncludeDotDirectoriesFocus = useRestoreFocusAfterPending(includeDotDirectoriesSetting.pending);
  const restoreShortcutHintVisibilityFocus = useRestoreFocusAfterPending(shortcutHintVisibilitySetting.pending);
  const restoreTouchFriendlyFileSelectionFocus = useRestoreFocusAfterPending(touchFriendlyFileSelectionSetting.pending);
  const includeDotDirectories = includeDotDirectoriesSetting.confirmedValue ?? false;
  const shortcutHintVisibility = shortcutHintVisibilitySetting.confirmedValue ?? "auto";
  const touchFriendlyFileSelection = touchFriendlyFileSelectionSetting.confirmedValue ?? "auto";
  const { t } = useTranslation();
  const [historyToClear, setHistoryToClear] = useState<RecentHistoryKind | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearHistoryError, setClearHistoryError] = useState<string | null>(null);

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
    <SettingsPage category="file-browser">
      <SettingsGroup title={t("settings.fileBrowserPage.quickNavigationTitle")} sx={{ mb: 3 }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={includeDotDirectories}
              disabled={includeDotDirectoriesSetting.pending}
              slotProps={{ input: { "aria-label": t("settings.fileBrowserPage.includeDotDirectoriesLabel") } }}
              onFocus={() => restoreIncludeDotDirectoriesFocus()}
              onChange={(event) => {
                includeDotDirectoriesSetting.clearError();
                void includeDotDirectoriesSetting.commit(event.target.checked).catch(() => undefined);
              }}
            />
          }
          label={
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {t("settings.fileBrowserPage.includeDotDirectoriesLabel")}
              <Box sx={{ width: 24, height: 24, flex: "0 0 24px" }}>
                <SettingSaveStatus
                  pending={includeDotDirectoriesSetting.pending}
                  saved={includeDotDirectoriesSetting.saved}
                  savingLabel={t("settings.saveStatus.saving")}
                  savedLabel={t("settings.saveStatus.saved")}
                />
              </Box>
            </Box>
          }
          sx={{ m: 0 }}
        />
        <SettingsFieldHelp sx={{ maxWidth: 640, color: includeDotDirectoriesSetting.error ? "error.main" : undefined }}>
          {includeDotDirectoriesSetting.error ?? t("settings.fileBrowserPage.includeDotDirectoriesDescription")}
        </SettingsFieldHelp>
        <FormControl size="small" sx={{ alignSelf: "flex-start", mt: 2, minWidth: 260 }}>
          <InputLabel id="quick-bar-shortcut-hints-label">{t("settings.fileBrowserPage.shortcutHintsLabel")}</InputLabel>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Select
              labelId="quick-bar-shortcut-hints-label"
              label={t("settings.fileBrowserPage.shortcutHintsLabel")}
              value={shortcutHintVisibility}
              disabled={shortcutHintVisibilitySetting.pending}
              error={Boolean(shortcutHintVisibilitySetting.error)}
              onFocus={() => restoreShortcutHintVisibilityFocus()}
              onChange={(event) => {
                shortcutHintVisibilitySetting.clearError();
                void shortcutHintVisibilitySetting.commit(event.target.value as QuickBarShortcutHintVisibility).catch(() => undefined);
              }}
              sx={{ flex: 1, minWidth: 0 }}
            >
              <MenuItem value="auto">{t("settings.fileBrowserPage.shortcutHintsAuto")}</MenuItem>
              <MenuItem value="always">{t("settings.fileBrowserPage.shortcutHintsAlways")}</MenuItem>
              <MenuItem value="never">{t("settings.fileBrowserPage.shortcutHintsNever")}</MenuItem>
            </Select>
            <Box sx={{ width: 24, height: 24, flex: "0 0 24px" }}>
              <SettingSaveStatus
                pending={shortcutHintVisibilitySetting.pending}
                saved={shortcutHintVisibilitySetting.saved}
                savingLabel={t("settings.saveStatus.saving")}
                savedLabel={t("settings.saveStatus.saved")}
              />
            </Box>
          </Box>
        </FormControl>
        <SettingsFieldHelp sx={{ maxWidth: 640, color: shortcutHintVisibilitySetting.error ? "error.main" : undefined }}>
          {shortcutHintVisibilitySetting.error ?? t("settings.fileBrowserPage.shortcutHintsDescription")}
        </SettingsFieldHelp>
      </SettingsGroup>
      <SettingsGroup title={t("settings.fileBrowserPage.fileSelectionTitle")} sx={{ mb: 3 }}>
        <FormControl size="small" sx={{ alignSelf: "flex-start", minWidth: 260 }}>
          <InputLabel id="touch-friendly-file-selection-label">{t("settings.fileBrowserPage.touchFriendlyFileSelectionLabel")}</InputLabel>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Select
              labelId="touch-friendly-file-selection-label"
              label={t("settings.fileBrowserPage.touchFriendlyFileSelectionLabel")}
              value={touchFriendlyFileSelection}
              disabled={touchFriendlyFileSelectionSetting.pending}
              error={Boolean(touchFriendlyFileSelectionSetting.error)}
              onFocus={() => restoreTouchFriendlyFileSelectionFocus()}
              onChange={(event) => {
                touchFriendlyFileSelectionSetting.clearError();
                void touchFriendlyFileSelectionSetting.commit(event.target.value as TouchFriendlyFileSelection).catch(() => undefined);
              }}
              sx={{ flex: 1, minWidth: 0 }}
            >
              <MenuItem value="auto">{t("settings.fileBrowserPage.touchFriendlyFileSelectionAuto")}</MenuItem>
              <MenuItem value="always">{t("settings.fileBrowserPage.touchFriendlyFileSelectionAlways")}</MenuItem>
              <MenuItem value="never">{t("settings.fileBrowserPage.touchFriendlyFileSelectionNever")}</MenuItem>
            </Select>
            <Box sx={{ width: 24, height: 24, flex: "0 0 24px" }}>
              <SettingSaveStatus
                pending={touchFriendlyFileSelectionSetting.pending}
                saved={touchFriendlyFileSelectionSetting.saved}
                savingLabel={t("settings.saveStatus.saving")}
                savedLabel={t("settings.saveStatus.saved")}
              />
            </Box>
          </Box>
        </FormControl>
        <SettingsFieldHelp sx={{ maxWidth: 640, color: touchFriendlyFileSelectionSetting.error ? "error.main" : undefined }}>
          {touchFriendlyFileSelectionSetting.error ?? t("settings.fileBrowserPage.touchFriendlyFileSelectionDescription")}
        </SettingsFieldHelp>
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
      <ResponsiveDialogShell
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
      </ResponsiveDialogShell>
    </SettingsPage>
  );
}
