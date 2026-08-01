import { Box, TextField, useMediaQuery, useTheme } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCategoryDescription } from "../components/Settings/SettingsCategoryDescription";
import { SettingsFieldHelp } from "../components/Settings/SettingsFieldHelp";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
import { useTextEditorMaxFileSizeBytesPreference } from "./FileBrowser/preferences";

const BYTES_PER_MEGABYTE = 1024 * 1024;

export function TextEditorSettings() {
  const [maxFileSizeBytes, setMaxFileSizeBytes] = useTextEditorMaxFileSizeBytesPreference();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { t } = useTranslation();
  const [maxFileSizeMegabytesInput, setMaxFileSizeMegabytesInput] = useState(() =>
    String(Math.max(1, Math.round(maxFileSizeBytes / BYTES_PER_MEGABYTE)))
  );
  const [isEditingMaxFileSize, setIsEditingMaxFileSize] = useState(false);

  useEffect(() => {
    if (!isEditingMaxFileSize) {
      setMaxFileSizeMegabytesInput(String(Math.max(1, Math.round(maxFileSizeBytes / BYTES_PER_MEGABYTE))));
    }
  }, [isEditingMaxFileSize, maxFileSizeBytes]);

  const commitMaxFileSize = () => {
    setIsEditingMaxFileSize(false);

    const parsedValue = Number.parseInt(maxFileSizeMegabytesInput, 10);
    if (!Number.isFinite(parsedValue)) {
      setMaxFileSizeMegabytesInput(String(Math.max(1, Math.round(maxFileSizeBytes / BYTES_PER_MEGABYTE))));
      return;
    }

    const nextMaxFileSizeBytes = Math.max(1, parsedValue) * BYTES_PER_MEGABYTE;
    if (nextMaxFileSizeBytes !== maxFileSizeBytes) {
      setMaxFileSizeBytes(nextMaxFileSizeBytes);
    }
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default", overflow: "hidden" }}>
      <SettingsSectionHeader
        title={getSettingsCategoryLabel("text-editor")}
        description={<SettingsCategoryDescription category="text-editor" />}
        showTitle={!isMobile}
      />
      <Box sx={{ flex: 1, overflow: "auto", px: { xs: 2, sm: 3, md: 4 }, pb: 3 }}>
        <SettingsGroup title={t("settings.textEditorPage.limitsTitle")}>
          <TextField
            label={t("settings.textEditorPage.maxFileSizeLabel")}
            type="number"
            value={maxFileSizeMegabytesInput}
            onFocus={() => setIsEditingMaxFileSize(true)}
            onChange={(event) => setMaxFileSizeMegabytesInput(event.target.value)}
            onBlur={commitMaxFileSize}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            slotProps={{
              htmlInput: {
                min: 1,
                step: 1,
              },
            }}
            sx={{ maxWidth: 280 }}
          />
          <SettingsFieldHelp sx={{ maxWidth: 720 }}>{t("settings.textEditorPage.maxFileSizeDescription")}</SettingsFieldHelp>
        </SettingsGroup>
      </Box>
    </Box>
  );
}
