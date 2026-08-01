import { Button, TextField } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsFieldHelp } from "../components/Settings/SettingsFieldHelp";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsPage } from "../components/Settings/SettingsPage";
import { useTextEditorMaxFileSizeBytesPreference } from "./FileBrowser/preferences";

const BYTES_PER_MEGABYTE = 1024 * 1024;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

function formatMegabytes(maxFileSizeBytes: number): string {
  return String(Math.max(1, Math.round(maxFileSizeBytes / BYTES_PER_MEGABYTE)));
}

export function TextEditorSettings() {
  const [maxFileSizeBytes, setMaxFileSizeBytes] = useTextEditorMaxFileSizeBytesPreference();
  const { t } = useTranslation();
  const [savedMaxFileSizeBytes, setSavedMaxFileSizeBytes] = useState(maxFileSizeBytes);
  const savedMaxFileSizeBytesRef = useRef(savedMaxFileSizeBytes);
  const [maxFileSizeMegabytesInput, setMaxFileSizeMegabytesInput] = useState(() => formatMegabytes(maxFileSizeBytes));
  const maxFileSizeMegabytesInputRef = useRef(maxFileSizeMegabytesInput);

  useEffect(() => {
    const wasClean = maxFileSizeMegabytesInputRef.current === formatMegabytes(savedMaxFileSizeBytesRef.current);
    savedMaxFileSizeBytesRef.current = maxFileSizeBytes;
    setSavedMaxFileSizeBytes(maxFileSizeBytes);

    if (wasClean) {
      const nextInput = formatMegabytes(maxFileSizeBytes);
      maxFileSizeMegabytesInputRef.current = nextInput;
      setMaxFileSizeMegabytesInput(nextInput);
    }
  }, [maxFileSizeBytes]);

  const updateMaxFileSizeMegabytesInput = (value: string) => {
    if (value && !POSITIVE_INTEGER_PATTERN.test(value)) {
      return;
    }

    maxFileSizeMegabytesInputRef.current = value;
    setMaxFileSizeMegabytesInput(value);
  };

  const draftMaxFileSizeMegabytes = Number(maxFileSizeMegabytesInput);
  const draftMaxFileSizeBytes =
    POSITIVE_INTEGER_PATTERN.test(maxFileSizeMegabytesInput) && Number.isSafeInteger(draftMaxFileSizeMegabytes)
      ? draftMaxFileSizeMegabytes * BYTES_PER_MEGABYTE
      : null;

  return (
    <SettingsPage
      category="text-editor"
      footerPrimaryActions={
        <Button
          variant="contained"
          disabled={draftMaxFileSizeBytes === null || draftMaxFileSizeBytes === savedMaxFileSizeBytes}
          onClick={() => draftMaxFileSizeBytes !== null && setMaxFileSizeBytes(draftMaxFileSizeBytes)}
        >
          {t("settings.advanced.saveChanges")}
        </Button>
      }
    >
      <SettingsGroup title={t("settings.textEditorPage.limitsTitle")}>
        <TextField
          label={t("settings.textEditorPage.maxFileSizeLabel")}
          type="text"
          value={maxFileSizeMegabytesInput}
          onChange={(event) => updateMaxFileSizeMegabytesInput(event.target.value)}
          slotProps={{
            htmlInput: {
              inputMode: "numeric",
              pattern: "[0-9]*",
            },
          }}
          sx={{ maxWidth: 280 }}
        />
        <SettingsFieldHelp sx={{ maxWidth: 720 }}>{t("settings.textEditorPage.maxFileSizeDescription")}</SettingsFieldHelp>
      </SettingsGroup>
    </SettingsPage>
  );
}
