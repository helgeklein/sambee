import { Box, TextField, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { getSettingsCategoryDescription, getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
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

  useEffect(() => {
    setMaxFileSizeMegabytesInput(String(Math.max(1, Math.round(maxFileSizeBytes / BYTES_PER_MEGABYTE))));
  }, [maxFileSizeBytes]);

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.default", overflow: "hidden" }}>
      <SettingsSectionHeader
        title={getSettingsCategoryLabel("text-editor")}
        description={getSettingsCategoryDescription("text-editor")}
        showTitle={!isMobile}
      />
      <Box sx={{ flex: 1, overflow: "auto", px: { xs: 2, sm: 3, md: 4 }, pb: 3 }}>
        <SettingsGroup title={t("settings.textEditorPage.limitsTitle")} description={t("settings.textEditorPage.limitsDescription")}>
          <TextField
            label={t("settings.textEditorPage.maxFileSizeLabel")}
            type="number"
            value={maxFileSizeMegabytesInput}
            onChange={(event) => {
              const nextValue = event.target.value;
              setMaxFileSizeMegabytesInput(nextValue);

              const parsedValue = Number.parseInt(nextValue, 10);
              if (!Number.isFinite(parsedValue)) {
                return;
              }

              setMaxFileSizeBytes(Math.max(1, parsedValue) * BYTES_PER_MEGABYTE);
            }}
            slotProps={{
              htmlInput: {
                min: 1,
                step: 1,
              },
            }}
            sx={{ maxWidth: 280 }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 720 }}>
            {t("settings.textEditorPage.maxFileSizeDescription")}
          </Typography>
        </SettingsGroup>
      </Box>
    </Box>
  );
}
