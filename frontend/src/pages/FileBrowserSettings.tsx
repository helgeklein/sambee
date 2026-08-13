import { Button, Checkbox, FormControlLabel, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveFormDialog } from "../components/Admin/ResponsiveFormDialog";
import { SettingsFieldHelp } from "../components/Settings/SettingsFieldHelp";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsPage } from "../components/Settings/SettingsPage";
import api from "../services/api";
import { publishRecentFilesChanged } from "../services/recentFilesSync";
import { useQuickNavIncludeDotDirectoriesPreference } from "./FileBrowser/preferences";

export function FileBrowserSettings() {
  const [includeDotDirectories, setIncludeDotDirectories] = useQuickNavIncludeDotDirectoriesPreference();
  const { t } = useTranslation();
  const [savedIncludeDotDirectories, setSavedIncludeDotDirectories] = useState(includeDotDirectories);
  const savedIncludeDotDirectoriesRef = useRef(savedIncludeDotDirectories);
  const [draftIncludeDotDirectories, setDraftIncludeDotDirectories] = useState(includeDotDirectories);
  const draftIncludeDotDirectoriesRef = useRef(draftIncludeDotDirectories);
  const [clearRecentFilesOpen, setClearRecentFilesOpen] = useState(false);
  const [clearingRecentFiles, setClearingRecentFiles] = useState(false);
  const [clearRecentFilesError, setClearRecentFilesError] = useState<string | null>(null);

  useEffect(() => {
    const wasClean = draftIncludeDotDirectoriesRef.current === savedIncludeDotDirectoriesRef.current;
    savedIncludeDotDirectoriesRef.current = includeDotDirectories;
    setSavedIncludeDotDirectories(includeDotDirectories);

    if (wasClean) {
      draftIncludeDotDirectoriesRef.current = includeDotDirectories;
      setDraftIncludeDotDirectories(includeDotDirectories);
    }
  }, [includeDotDirectories]);

  const updateDraftIncludeDotDirectories = (enabled: boolean) => {
    draftIncludeDotDirectoriesRef.current = enabled;
    setDraftIncludeDotDirectories(enabled);
  };

  const clearRecentFiles = async () => {
    setClearingRecentFiles(true);
    try {
      await api.clearRecentFiles();
      publishRecentFilesChanged();
      setClearRecentFilesError(null);
      setClearRecentFilesOpen(false);
    } catch {
      setClearRecentFilesError(t("settings.fileBrowserPage.clearRecentFilesFailed"));
    } finally {
      setClearingRecentFiles(false);
    }
  };

  return (
    <SettingsPage
      category="file-browser"
      footerPrimaryActions={
        <Button
          variant="contained"
          disabled={draftIncludeDotDirectories === savedIncludeDotDirectories}
          onClick={() => setIncludeDotDirectories(draftIncludeDotDirectories)}
        >
          {t("settings.advanced.saveChanges")}
        </Button>
      }
    >
      <SettingsGroup title={t("settings.fileBrowserPage.quickNavigationTitle")}>
        <FormControlLabel
          control={
            <Checkbox checked={draftIncludeDotDirectories} onChange={(event) => updateDraftIncludeDotDirectories(event.target.checked)} />
          }
          label={t("settings.fileBrowserPage.includeDotDirectoriesLabel")}
          sx={{ m: 0 }}
        />
        <SettingsFieldHelp sx={{ maxWidth: 640 }}>{t("settings.fileBrowserPage.includeDotDirectoriesDescription")}</SettingsFieldHelp>
      </SettingsGroup>
      <SettingsGroup title={t("settings.fileBrowserPage.fileSearchTitle")}>
        <Button
          color="error"
          variant="outlined"
          onClick={() => {
            setClearRecentFilesError(null);
            setClearRecentFilesOpen(true);
          }}
        >
          {t("settings.fileBrowserPage.clearRecentFiles")}
        </Button>
      </SettingsGroup>
      <ResponsiveFormDialog
        open={clearRecentFilesOpen}
        onClose={() => {
          if (!clearingRecentFiles) setClearRecentFilesOpen(false);
        }}
        disableClose={clearingRecentFiles}
        title={t("settings.fileBrowserPage.clearRecentFiles")}
        description={t("settings.fileBrowserPage.clearRecentFilesDescription")}
        actions={
          <>
            <Button disabled={clearingRecentFiles} onClick={() => setClearRecentFilesOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button color="error" variant="contained" disabled={clearingRecentFiles} onClick={() => void clearRecentFiles()}>
              {t("settings.fileBrowserPage.clearRecentFiles")}
            </Button>
          </>
        }
      >
        <Typography variant="body2">{t("settings.fileBrowserPage.clearRecentFilesNoFileImpact")}</Typography>
        {clearRecentFilesError ? <SettingsFieldHelp sx={{ color: "error.main" }}>{clearRecentFilesError}</SettingsFieldHelp> : null}
      </ResponsiveFormDialog>
    </SettingsPage>
  );
}
