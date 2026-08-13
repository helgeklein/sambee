import { Add as AddIcon, Cancel as CancelIcon } from "@mui/icons-material";
import { Button, Checkbox, Chip, FormControlLabel, Stack, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsFieldHelp } from "../components/Settings/SettingsFieldHelp";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsPage } from "../components/Settings/SettingsPage";
import api from "../services/api";
import { publishRecentFilesChanged } from "../services/recentFilesSync";
import type { FileSearchSettings as FileSearchSettingsModel, FileSearchSettingsRead } from "../types";

const DEFAULT_SETTINGS: FileSearchSettingsModel = {
  retention_limit: 50,
  result_limit: 10,
  excluded_categories: ["images", "temporary_backup"],
  excluded_extensions: [],
};

const EXTENSION_MAX_LENGTH = 255;
const INVALID_EXTENSION_CHARACTERS = /[*?[\]{}\\/,]/;

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function isValidExtension(extension: string): boolean {
  return extension !== "." && extension.length <= EXTENSION_MAX_LENGTH && !INVALID_EXTENSION_CHARACTERS.test(extension);
}

function validateSettings(settings: FileSearchSettingsModel): {
  retention: string | null;
  results: string | null;
  extensions: string | null;
} {
  const retention = Number.isInteger(settings.retention_limit) && settings.retention_limit >= 0 && settings.retention_limit <= 500;
  const results = Number.isInteger(settings.result_limit) && settings.result_limit >= 1 && settings.result_limit <= 50;
  const invalidExtension = settings.excluded_extensions.some((extension) => !isValidExtension(extension));
  return {
    retention: retention ? null : "retention",
    results: results ? null : "results",
    extensions: invalidExtension ? "extensions" : null,
  };
}

export function FileSearchSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<FileSearchSettingsModel>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<FileSearchSettingsModel>(DEFAULT_SETTINGS);
  const [source, setSource] = useState<FileSearchSettingsRead["source"]>("default");
  const [extensionInput, setExtensionInput] = useState("");
  const [extensionInputError, setExtensionInputError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const validation = validateSettings(settings);
  const isValid = !validation.retention && !validation.results && !validation.extensions;
  const isDirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  useEffect(() => {
    void api
      .getFileSearchSettings()
      .then((response) => {
        setSettings(response.settings);
        setSavedSettings(response.settings);
        setSource(response.source);
        setExtensionInput("");
        setExtensionInputError(null);
        setError(null);
      })
      .catch(() => setError(t("settings.fileSearch.loadFailed")));
  }, [t]);

  const updateCategories = (category: "images" | "temporary_backup", checked: boolean) => {
    setSettings((current) => ({
      ...current,
      excluded_categories: checked
        ? [...new Set([...current.excluded_categories, category])]
        : current.excluded_categories.filter((entry) => entry !== category),
    }));
  };

  const addExtension = () => {
    const normalizedExtension = normalizeExtension(extensionInput);
    if (!isValidExtension(normalizedExtension)) {
      setExtensionInputError(t("settings.fileSearch.excludedExtensionsError"));
      return;
    }
    if (settings.excluded_extensions.includes(normalizedExtension)) {
      setExtensionInputError(t("settings.fileSearch.excludedExtensionsDuplicateError"));
      return;
    }
    setSettings((current) => ({ ...current, excluded_extensions: [...current.excluded_extensions, normalizedExtension] }));
    setExtensionInput("");
    setExtensionInputError(null);
  };

  const removeExtension = (extension: string) => {
    setSettings((current) => ({ ...current, excluded_extensions: current.excluded_extensions.filter((entry) => entry !== extension) }));
  };

  const normalizedExtensionPreview = extensionInput.trim() ? normalizeExtension(extensionInput) : null;

  const save = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      const response = await api.updateFileSearchSettings({ settings });
      setSettings(response.settings);
      setSavedSettings(response.settings);
      setSource(response.source);
      setExtensionInput("");
      setExtensionInputError(null);
      setError(null);
      publishRecentFilesChanged();
    } catch {
      setError(t("settings.fileSearch.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const response = await api.updateFileSearchSettings({ reset_to_default: true });
      setSettings(response.settings);
      setSavedSettings(response.settings);
      setSource(response.source);
      setExtensionInput("");
      setExtensionInputError(null);
      setError(null);
      publishRecentFilesChanged();
    } catch {
      setError(t("settings.fileSearch.resetFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPage
      category="admin-file-search"
      footerSecondaryActions={
        <Button disabled={saving || source === "default"} onClick={() => void reset()}>
          {t("settings.fileSearch.resetToDefault")}
        </Button>
      }
      footerPrimaryActions={
        <Button variant="contained" disabled={saving || !isDirty || !isValid} onClick={() => void save()}>
          {t("settings.fileSearch.saveChanges")}
        </Button>
      }
    >
      <SettingsGroup title={t("settings.fileSearch.title")}>
        <Stack spacing={2} sx={{ maxWidth: 480 }}>
          <SettingsFieldHelp>{t(`settings.fileSearch.source.${source}`)}</SettingsFieldHelp>
          <TextField
            label={t("settings.fileSearch.retentionLimit")}
            type="number"
            value={Number.isNaN(settings.retention_limit) ? "" : settings.retention_limit}
            slotProps={{ htmlInput: { min: 0, max: 500 } }}
            error={Boolean(validation.retention)}
            helperText={validation.retention ? t("settings.fileSearch.retentionLimitError") : undefined}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                retention_limit: event.target.value === "" ? Number.NaN : Number(event.target.value),
              }))
            }
          />
          <TextField
            label={t("settings.fileSearch.resultLimit")}
            type="number"
            value={Number.isNaN(settings.result_limit) ? "" : settings.result_limit}
            slotProps={{ htmlInput: { min: 1, max: 50 } }}
            error={Boolean(validation.results)}
            helperText={validation.results ? t("settings.fileSearch.resultLimitError") : undefined}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                result_limit: event.target.value === "" ? Number.NaN : Number(event.target.value),
              }))
            }
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.excluded_categories.includes("images")}
                onChange={(event) => updateCategories("images", event.target.checked)}
              />
            }
            label={t("settings.fileSearch.excludeImages")}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.excluded_categories.includes("temporary_backup")}
                onChange={(event) => updateCategories("temporary_backup", event.target.checked)}
              />
            }
            label={t("settings.fileSearch.excludeTemporaryBackup")}
          />
          <Stack spacing={1}>
            <TextField
              label={t("settings.fileSearch.excludedExtensionsInputLabel")}
              value={extensionInput}
              error={Boolean(validation.extensions || extensionInputError)}
              helperText={
                extensionInputError ??
                (validation.extensions
                  ? t("settings.fileSearch.excludedExtensionsError")
                  : normalizedExtensionPreview && isValidExtension(normalizedExtensionPreview)
                    ? t("settings.fileSearch.excludedExtensionsNormalization", { extension: normalizedExtensionPreview })
                    : t("settings.fileSearch.excludedExtensionsHelp"))
              }
              onChange={(event) => {
                setExtensionInput(event.target.value);
                setExtensionInputError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addExtension();
                }
              }}
            />
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              disabled={!extensionInput.trim()}
              onClick={addExtension}
              sx={{ alignSelf: "flex-start" }}
            >
              {t("settings.fileSearch.excludedExtensionsAdd")}
            </Button>
            {settings.excluded_extensions.length > 0 ? (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {settings.excluded_extensions.map((extension) => (
                  <Chip
                    key={extension}
                    label={extension}
                    onDelete={() => removeExtension(extension)}
                    deleteIcon={<CancelIcon aria-label={t("settings.fileSearch.excludedExtensionsRemove", { extension })} />}
                  />
                ))}
              </Stack>
            ) : null}
          </Stack>
          {error ? <SettingsFieldHelp sx={{ color: "error.main" }}>{error}</SettingsFieldHelp> : null}
        </Stack>
      </SettingsGroup>
    </SettingsPage>
  );
}
