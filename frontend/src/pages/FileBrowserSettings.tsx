import { Button, Checkbox, FormControlLabel } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsFieldHelp } from "../components/Settings/SettingsFieldHelp";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { useQuickNavIncludeDotDirectoriesPreference } from "./FileBrowser/preferences";

export function FileBrowserSettings() {
  const [includeDotDirectories, setIncludeDotDirectories] = useQuickNavIncludeDotDirectoriesPreference();
  const { t } = useTranslation();
  const [savedIncludeDotDirectories, setSavedIncludeDotDirectories] = useState(includeDotDirectories);
  const savedIncludeDotDirectoriesRef = useRef(savedIncludeDotDirectories);
  const [draftIncludeDotDirectories, setDraftIncludeDotDirectories] = useState(includeDotDirectories);
  const draftIncludeDotDirectoriesRef = useRef(draftIncludeDotDirectories);

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
    </SettingsPage>
  );
}
