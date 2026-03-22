import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormHelperText,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { settingsPrimaryButtonSx } from "../components/Settings/settingsButtonStyles";
import { getSettingsCategoryDescription, getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
import { translate } from "../i18n";
import api from "../services/api";
import type { AdvancedSystemSettings, AdvancedSystemSettingsUpdate, IntegerSystemSetting } from "../types";
import { getApiErrorMessage } from "../utils/apiErrors";
import { formatLocalizedNumber } from "../utils/localeFormatting";

interface AdvancedSettingsProps {
  dialogSafeHeader?: boolean;
}

interface AdvancedSettingsFormState {
  smbReadChunkSizeBytes: number | null;
  imagemagickMaxFileSizeBytes: number | null;
  imagemagickTimeoutSeconds: number | null;
}

const DESKTOP_FIELD_ROW_MAX_WIDTH = 440;
const DESKTOP_VALUE_FIELD_MAX_WIDTH = 220;
const DESKTOP_UNIT_FIELD_WIDTH = 120;
const DESKTOP_NUMERIC_FIELD_MAX_WIDTH = 240;

const fieldLabelTypographyProps = {
  variant: "body2" as const,
  fontWeight: 600,
};

const subsectionHeadingSx = {
  mb: 1.25,
  fontWeight: 700,
  color: "text.primary",
  lineHeight: 1.3,
};

const BYTE_UNITS = [
  { label: "B", factor: 1 },
  { label: "KiB", factor: 1024 },
  { label: "MiB", factor: 1024 * 1024 },
  { label: "GiB", factor: 1024 * 1024 * 1024 },
] as const;

type ByteUnitLabel = (typeof BYTE_UNITS)[number]["label"];

function formatInteger(value: number): string {
  return formatLocalizedNumber(value);
}

function formatByteSize(bytes: number): string {
  const matchingUnit = [...BYTE_UNITS].reverse().find((unit) => bytes >= unit.factor && bytes % unit.factor === 0) ?? BYTE_UNITS[0];
  return `${formatInteger(bytes / matchingUnit.factor)} ${matchingUnit.label}`;
}

function formatBytesWithExactValue(bytes: number): string {
  return `${formatByteSize(bytes)} (${formatInteger(bytes)} bytes)`;
}

function getPreferredByteUnit(bytes: number): ByteUnitLabel {
  return ([...BYTE_UNITS].reverse().find((unit) => bytes >= unit.factor && bytes % unit.factor === 0) ?? BYTE_UNITS[0]).label;
}

function getByteUnitFactor(unitLabel: ByteUnitLabel): number {
  return BYTE_UNITS.find((unit) => unit.label === unitLabel)?.factor ?? 1;
}

function createFormState(settings: AdvancedSystemSettings): AdvancedSettingsFormState {
  return {
    smbReadChunkSizeBytes: settings.smb.read_chunk_size_bytes.value,
    imagemagickMaxFileSizeBytes: settings.preprocessors.imagemagick.max_file_size_bytes.value,
    imagemagickTimeoutSeconds: settings.preprocessors.imagemagick.timeout_seconds.value,
  };
}

function validateIntegerSetting(setting: IntegerSystemSetting, value: number | null, unitLabel?: string): string | null {
  if (value === null) {
    return translate("settings.advanced.validation.enterLabel", { label: setting.label });
  }

  if (!Number.isInteger(value)) {
    return translate("settings.advanced.validation.wholeNumber", { label: setting.label });
  }

  if (value < setting.min_value || value > setting.max_value) {
    if (unitLabel) {
      return translate("settings.advanced.validation.betweenRangeWithUnit", {
        label: setting.label,
        min: formatInteger(setting.min_value),
        max: formatInteger(setting.max_value),
        unit: unitLabel,
      });
    }

    return translate("settings.advanced.validation.betweenRange", {
      label: setting.label,
      min: formatInteger(setting.min_value),
      max: formatInteger(setting.max_value),
    });
  }

  return null;
}

function validateByteSizeSetting(setting: IntegerSystemSetting, value: number | null): string | null {
  if (value === null) {
    return translate("settings.advanced.validation.enterLabel", { label: setting.label });
  }

  if (!Number.isInteger(value)) {
    return translate("settings.advanced.validation.wholeNumber", { label: setting.label });
  }

  if (value < setting.min_value || value > setting.max_value) {
    return translate("settings.advanced.validation.betweenRange", {
      label: setting.label,
      min: formatByteSize(setting.min_value),
      max: formatByteSize(setting.max_value),
    });
  }

  return null;
}

function buildUpdatePayload(formState: AdvancedSettingsFormState): AdvancedSystemSettingsUpdate {
  const toOptionalNumber = (value: number | null): number | undefined => value ?? undefined;

  return {
    smb: {
      read_chunk_size_bytes: toOptionalNumber(formState.smbReadChunkSizeBytes),
    },
    preprocessors: {
      imagemagick: {
        max_file_size_bytes: toOptionalNumber(formState.imagemagickMaxFileSizeBytes),
        timeout_seconds: toOptionalNumber(formState.imagemagickTimeoutSeconds),
      },
    },
  };
}

function SettingField({
  setting,
  value,
  onChange,
  onReset,
  resetDisabled,
  unitAdornment,
  errorText,
  showErrors,
}: {
  setting: IntegerSystemSetting;
  value: number | null;
  onChange: (value: number | null) => void;
  onReset?: () => void;
  resetDisabled?: boolean;
  unitAdornment?: string;
  errorText?: string | null;
  showErrors?: boolean;
}) {
  const { t } = useTranslation();
  const [displayValue, setDisplayValue] = useState<string>(value === null ? "" : String(value));
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setDisplayValue(value === null ? "" : String(value));
  }, [value]);

  const displayError = Boolean(errorText) && (touched || showErrors);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, py: 1.5 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "flex-start", sm: "center" }}>
        <Typography {...fieldLabelTypographyProps}>{setting.label}</Typography>
        {setting.source === "database" && onReset ? (
          <Button size="small" variant="text" onClick={onReset} disabled={resetDisabled}>
            {t("settings.advanced.resetOverride")}
          </Button>
        ) : null}
      </Stack>
      <TextField
        type="text"
        value={displayValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (!/^\d*$/.test(nextValue)) {
            return;
          }

          setDisplayValue(nextValue);
          onChange(nextValue ? Number(nextValue) : null);
        }}
        onBlur={() => setTouched(true)}
        inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }}
        variant="filled"
        sx={{ width: "100%", maxWidth: { xs: "100%", sm: DESKTOP_NUMERIC_FIELD_MAX_WIDTH } }}
        error={displayError}
        InputProps={
          unitAdornment
            ? {
                endAdornment: <InputAdornment position="end">{unitAdornment}</InputAdornment>,
              }
            : undefined
        }
        helperText={
          displayError
            ? errorText
            : t("settings.advanced.helperText.integer", {
                description: setting.description,
                defaultValue: setting.default_value,
                minValue: setting.min_value,
                maxValue: setting.max_value,
              })
        }
      />
    </Box>
  );
}

function ByteSizeSettingField({
  setting,
  value,
  onChange,
  onReset,
  resetDisabled,
  errorText,
  showErrors,
}: {
  setting: IntegerSystemSetting;
  value: number | null;
  onChange: (value: number | null) => void;
  onReset?: () => void;
  resetDisabled?: boolean;
  errorText?: string | null;
  showErrors?: boolean;
}) {
  const { t } = useTranslation();
  const [unit, setUnit] = useState<ByteUnitLabel>(() => getPreferredByteUnit(value ?? setting.min_value));
  const [displayValue, setDisplayValue] = useState<string>(() =>
    value === null ? "" : String(Math.round(value / getByteUnitFactor(getPreferredByteUnit(value))))
  );
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (value === null) {
      setDisplayValue("");
      return;
    }

    const factor = getByteUnitFactor(unit);
    if (factor > value && value > 0) {
      const nextUnit = getPreferredByteUnit(value);
      setUnit(nextUnit);
      setDisplayValue(String(Math.round(value / getByteUnitFactor(nextUnit))));
      return;
    }

    setDisplayValue(String(Math.round(value / factor)));
  }, [unit, value]);

  const factor = getByteUnitFactor(unit);
  const displayError = Boolean(errorText) && (touched || showErrors);

  const handleValueChange = (nextValue: string) => {
    if (!/^\d*$/.test(nextValue)) {
      return;
    }

    setDisplayValue(nextValue);

    if (!nextValue) {
      onChange(null);
      return;
    }

    onChange(Number(nextValue) * factor);
  };

  const handleValueBlur = () => {
    setTouched(true);
  };

  const handleUnitChange = (nextUnit: ByteUnitLabel) => {
    const nextFactor = getByteUnitFactor(nextUnit);
    setUnit(nextUnit);

    if (value === null) {
      return;
    }

    const nextDisplayValue = String(Math.round(value / nextFactor));
    setDisplayValue(nextDisplayValue);
    onChange(Number(nextDisplayValue) * nextFactor);
  };

  const availableUnits = BYTE_UNITS.filter((option) => option.factor <= Math.max(value ?? 0, setting.min_value) || option.label === unit);
  const helperMessage = displayError
    ? errorText
    : t("settings.advanced.helperText.byteSize", {
        description: setting.description,
        defaultValue: formatBytesWithExactValue(setting.default_value),
        minValue: formatByteSize(setting.min_value),
        maxValue: formatByteSize(setting.max_value),
      });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, py: 1.5 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "flex-start", sm: "center" }}>
        <Typography {...fieldLabelTypographyProps}>{setting.label}</Typography>
        {setting.source === "database" && onReset ? (
          <Button size="small" variant="text" onClick={onReset} disabled={resetDisabled}>
            {t("settings.advanced.resetOverride")}
          </Button>
        ) : null}
      </Stack>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ width: "100%", maxWidth: { xs: "100%", sm: DESKTOP_FIELD_ROW_MAX_WIDTH } }}
      >
        <TextField
          type="text"
          label={t("settings.advanced.fields.value")}
          value={displayValue}
          onChange={(event) => handleValueChange(event.target.value)}
          onBlur={handleValueBlur}
          inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }}
          variant="filled"
          sx={{ width: "100%", maxWidth: { xs: "100%", sm: DESKTOP_VALUE_FIELD_MAX_WIDTH } }}
          error={displayError}
        />
        <TextField
          select
          label={t("settings.advanced.fields.unit")}
          value={unit}
          onChange={(event) => handleUnitChange(event.target.value as ByteUnitLabel)}
          variant="filled"
          error={displayError}
          sx={{ width: { xs: "100%", sm: DESKTOP_UNIT_FIELD_WIDTH } }}
        >
          {availableUnits.map((option) => (
            <MenuItem key={option.label} value={option.label}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <FormHelperText
        error={displayError}
        sx={{ mt: -0.5, mx: 1.75, width: "100%", maxWidth: { xs: "100%", sm: DESKTOP_FIELD_ROW_MAX_WIDTH } }}
      >
        {helperMessage}
      </FormHelperText>
    </Box>
  );
}

export function AdvancedSettings({ dialogSafeHeader = false }: AdvancedSettingsProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AdvancedSystemSettings | null>(null);
  const [formState, setFormState] = useState<AdvancedSettingsFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.getAdvancedSettings();
      setSettings(response);
      setFormState(createFormState(response));
      setSubmitAttempted(false);
    } catch (loadError: unknown) {
      setError(getApiErrorMessage(loadError, t("settings.advanced.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const hasUnsavedChanges = useMemo(() => {
    if (!settings || !formState) {
      return false;
    }

    return JSON.stringify(createFormState(settings)) !== JSON.stringify(formState);
  }, [formState, settings]);

  const validationErrors = useMemo(() => {
    if (!settings || !formState) {
      return null;
    }

    return {
      smbReadChunkSizeBytes: validateByteSizeSetting(settings.smb.read_chunk_size_bytes, formState.smbReadChunkSizeBytes),
      imagemagickMaxFileSizeBytes: validateByteSizeSetting(
        settings.preprocessors.imagemagick.max_file_size_bytes,
        formState.imagemagickMaxFileSizeBytes
      ),
      imagemagickTimeoutSeconds: validateIntegerSetting(
        settings.preprocessors.imagemagick.timeout_seconds,
        formState.imagemagickTimeoutSeconds,
        t("settings.advanced.fields.seconds")
      ),
    };
  }, [formState, settings, t]);

  const hasValidationErrors = useMemo(() => {
    if (!validationErrors) {
      return false;
    }

    return Object.values(validationErrors).some((value) => value !== null);
  }, [validationErrors]);

  const handleSave = async () => {
    setSubmitAttempted(true);

    if (!formState || hasValidationErrors) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);
      const updated = await api.updateAdvancedSettings(buildUpdatePayload(formState));
      setSettings(updated);
      setFormState(createFormState(updated));
      setSuccessMessage(t("settings.advanced.saveSuccess"));
      setSubmitAttempted(false);
    } catch (saveError: unknown) {
      setError(getApiErrorMessage(saveError, t("settings.advanced.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (key: string, label: string) => {
    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);
      const updated = await api.updateAdvancedSettings({ reset_keys: [key] });
      setSettings(updated);
      setFormState(createFormState(updated));
      setSuccessMessage(t("settings.advanced.resetSuccess", { label }));
      setSubmitAttempted(false);
    } catch (resetError: unknown) {
      setError(getApiErrorMessage(resetError, t("settings.advanced.resetFailed")));
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
        overflow: "hidden",
      }}
    >
      <SettingsSectionHeader
        title={getSettingsCategoryLabel("admin-system")}
        description={getSettingsCategoryDescription("admin-system")}
        dialogSafe={dialogSafeHeader}
        showTitle={!isMobile}
        actions={
          <Button onClick={handleSave} disabled={!hasUnsavedChanges || saving || loading} variant="contained" sx={settingsPrimaryButtonSx}>
            {saving ? <CircularProgress size={18} color="inherit" /> : t("settings.advanced.saveChanges")}
          </Button>
        }
      />

      <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, pb: 3, overflow: "auto" }}>
        {loading && (
          <Box sx={{ py: 6, display: "flex", justifyContent: "center" }}>
            <CircularProgress />
          </Box>
        )}

        {!loading && error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {!loading && successMessage && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {successMessage}
          </Alert>
        )}

        {!loading && settings && formState && (
          <Stack spacing={4}>
            <SettingsGroup title={t("settings.advanced.sections.smbBackends")}>
              <ByteSizeSettingField
                setting={settings.smb.read_chunk_size_bytes}
                value={formState.smbReadChunkSizeBytes}
                onChange={(value) => setFormState((current) => (current ? { ...current, smbReadChunkSizeBytes: value } : current))}
                errorText={validationErrors?.smbReadChunkSizeBytes}
                showErrors={submitAttempted}
                onReset={() => handleReset(settings.smb.read_chunk_size_bytes.key, settings.smb.read_chunk_size_bytes.label)}
                resetDisabled={saving || loading || hasUnsavedChanges}
              />
            </SettingsGroup>

            <SettingsGroup title={t("settings.advanced.sections.preprocessors")}>
              <Stack spacing={3.5}>
                <SettingsGroup title={t("settings.advanced.sections.imageMagick")} titleVariant="subtitle2" titleSx={subsectionHeadingSx}>
                  <ByteSizeSettingField
                    setting={settings.preprocessors.imagemagick.max_file_size_bytes}
                    value={formState.imagemagickMaxFileSizeBytes}
                    onChange={(value) =>
                      setFormState((current) => (current ? { ...current, imagemagickMaxFileSizeBytes: value } : current))
                    }
                    errorText={validationErrors?.imagemagickMaxFileSizeBytes}
                    showErrors={submitAttempted}
                    onReset={() =>
                      handleReset(
                        settings.preprocessors.imagemagick.max_file_size_bytes.key,
                        settings.preprocessors.imagemagick.max_file_size_bytes.label
                      )
                    }
                    resetDisabled={saving || loading || hasUnsavedChanges}
                  />
                  <SettingField
                    setting={settings.preprocessors.imagemagick.timeout_seconds}
                    value={formState.imagemagickTimeoutSeconds}
                    onChange={(value) => setFormState((current) => (current ? { ...current, imagemagickTimeoutSeconds: value } : current))}
                    errorText={validationErrors?.imagemagickTimeoutSeconds}
                    showErrors={submitAttempted}
                    unitAdornment={t("settings.advanced.fields.seconds")}
                    onReset={() =>
                      handleReset(
                        settings.preprocessors.imagemagick.timeout_seconds.key,
                        settings.preprocessors.imagemagick.timeout_seconds.label
                      )
                    }
                    resetDisabled={saving || loading || hasUnsavedChanges}
                  />
                </SettingsGroup>
              </Stack>
            </SettingsGroup>
          </Stack>
        )}
      </Box>
    </Box>
  );

  if (isMobile) {
    return content;
  }

  return <Box sx={{ overflow: "auto", height: "100%" }}>{content}</Box>;
}
