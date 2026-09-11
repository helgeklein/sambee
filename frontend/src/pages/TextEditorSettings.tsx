import { TextField } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingSaveStatusAdornment } from "../components/Settings/SettingSaveStatus";
import { SettingsFieldHelp } from "../components/Settings/SettingsFieldHelp";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { useCurrentUserSetting } from "../services/userSettingsStore";

const BYTES_PER_MEGABYTE = 1024 * 1024;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

function formatMegabytes(maxFileSizeBytes: number): string {
  return String(Math.max(1, Math.round(maxFileSizeBytes / BYTES_PER_MEGABYTE)));
}

export function TextEditorSettings() {
  const maxFileSizeSetting = useCurrentUserSetting("text_editor.max_file_size_bytes");
  const { t } = useTranslation();
  const maxFileSizeBytes = maxFileSizeSetting.confirmedValue ?? 52_428_800;
  const [maxFileSizeMegabytesInput, setMaxFileSizeMegabytesInput] = useState(() => formatMegabytes(maxFileSizeBytes));

  useEffect(() => {
    setMaxFileSizeMegabytesInput(formatMegabytes(maxFileSizeBytes));
  }, [maxFileSizeBytes]);

  const updateMaxFileSizeMegabytesInput = (value: string) => {
    if (value && !POSITIVE_INTEGER_PATTERN.test(value)) {
      return;
    }

    setMaxFileSizeMegabytesInput(value);
    maxFileSizeSetting.clearError();
  };

  const draftMaxFileSizeMegabytes = Number(maxFileSizeMegabytesInput);
  const draftMaxFileSizeBytes =
    POSITIVE_INTEGER_PATTERN.test(maxFileSizeMegabytesInput) && Number.isSafeInteger(draftMaxFileSizeMegabytes)
      ? draftMaxFileSizeMegabytes * BYTES_PER_MEGABYTE
      : null;

  const commitMaxFileSize = () => {
    if (draftMaxFileSizeBytes !== null && draftMaxFileSizeBytes !== maxFileSizeBytes && !maxFileSizeSetting.pending) {
      void maxFileSizeSetting.commit(draftMaxFileSizeBytes).catch(() => undefined);
    }
  };

  return (
    <SettingsPage category="text-editor">
      <SettingsGroup title={t("settings.textEditorPage.limitsTitle")}>
        <TextField
          label={t("settings.textEditorPage.maxFileSizeLabel")}
          type="text"
          value={maxFileSizeMegabytesInput}
          onChange={(event) => updateMaxFileSizeMegabytesInput(event.target.value)}
          onBlur={commitMaxFileSize}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
          disabled={maxFileSizeSetting.pending}
          error={Boolean(maxFileSizeSetting.error)}
          helperText={maxFileSizeSetting.error}
          slotProps={{
            htmlInput: {
              inputMode: "numeric",
              pattern: "[0-9]*",
            },
            input:
              maxFileSizeSetting.pending || maxFileSizeSetting.saved
                ? {
                    endAdornment: (
                      <SettingSaveStatusAdornment
                        pending={maxFileSizeSetting.pending}
                        saved={maxFileSizeSetting.saved}
                        savingLabel={t("settings.saveStatus.saving")}
                        savedLabel={t("settings.saveStatus.saved")}
                      />
                    ),
                  }
                : undefined,
          }}
          sx={{ maxWidth: 280 }}
        />
        <SettingsFieldHelp sx={{ maxWidth: 720 }}>{t("settings.textEditorPage.maxFileSizeDescription")}</SettingsFieldHelp>
      </SettingsGroup>
    </SettingsPage>
  );
}
