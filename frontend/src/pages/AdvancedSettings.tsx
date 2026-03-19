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
import { SettingsGroup } from "../components/Settings/SettingsGroup";
import { SettingsSectionHeader } from "../components/Settings/SettingsSectionHeader";
import { settingsPrimaryButtonSx } from "../components/Settings/settingsButtonStyles";
import { getSettingsCategoryDescription, getSettingsCategoryLabel } from "../components/Settings/settingsNavigation";
import api from "../services/api";
import type { AdvancedSystemSettings, AdvancedSystemSettingsUpdate, IntegerSystemSetting } from "../types";
import { getApiErrorMessage } from "../utils/apiErrors";

interface AdvancedSettingsProps {
  dialogSafeHeader?: boolean;
}

interface AdvancedSettingsFormState {
  smbReadChunkSizeBytes: number | null;
  imagemagickMaxFileSizeBytes: number | null;
  imagemagickTimeoutSeconds: number | null;
  graphicsmagickMaxFileSizeBytes: number | null;
  graphicsmagickTimeoutSeconds: number | null;
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
  return new Intl.NumberFormat("en-US").format(value);
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
    graphicsmagickMaxFileSizeBytes: settings.preprocessors.graphicsmagick.max_file_size_bytes.value,
    graphicsmagickTimeoutSeconds: settings.preprocessors.graphicsmagick.timeout_seconds.value,
  };
}

function validateIntegerSetting(setting: IntegerSystemSetting, value: number | null, unitLabel?: string): string | null {
  if (value === null) {
    return `Enter ${setting.label}`;
  }

  if (!Number.isInteger(value)) {
    return `${setting.label} must be a whole number`;
  }

  if (value < setting.min_value || value > setting.max_value) {
    if (unitLabel) {
      return `${setting.label} must be between ${formatInteger(setting.min_value)} and ${formatInteger(setting.max_value)} ${unitLabel}`;
    }

    return `${setting.label} must be between ${formatInteger(setting.min_value)} and ${formatInteger(setting.max_value)}`;
  }

  return null;
}

function validateByteSizeSetting(setting: IntegerSystemSetting, value: number | null): string | null {
  if (value === null) {
    return `Enter ${setting.label}`;
  }

  if (!Number.isInteger(value)) {
    return `${setting.label} must be a whole number`;
  }

  if (value < setting.min_value || value > setting.max_value) {
    return `${setting.label} must be between ${formatByteSize(setting.min_value)} and ${formatByteSize(setting.max_value)}`;
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
      graphicsmagick: {
        max_file_size_bytes: toOptionalNumber(formState.graphicsmagickMaxFileSizeBytes),
        timeout_seconds: toOptionalNumber(formState.graphicsmagickTimeoutSeconds),
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
            Reset override
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
            : `${setting.description} Default: ${setting.default_value}. Range: ${setting.min_value} - ${setting.max_value}.`
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
    : `${setting.description} Default: ${formatBytesWithExactValue(setting.default_value)}. Range: ${formatByteSize(
        setting.min_value
      )} to ${formatByteSize(setting.max_value)}.`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, py: 1.5 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "flex-start", sm: "center" }}>
        <Typography {...fieldLabelTypographyProps}>{setting.label}</Typography>
        {setting.source === "database" && onReset ? (
          <Button size="small" variant="text" onClick={onReset} disabled={resetDisabled}>
            Reset override
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
          label="Value"
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
          label="Unit"
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
      setError(getApiErrorMessage(loadError, "Failed to load advanced settings"));
    } finally {
      setLoading(false);
    }
  }, []);

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
        "seconds"
      ),
      graphicsmagickMaxFileSizeBytes: validateByteSizeSetting(
        settings.preprocessors.graphicsmagick.max_file_size_bytes,
        formState.graphicsmagickMaxFileSizeBytes
      ),
      graphicsmagickTimeoutSeconds: validateIntegerSetting(
        settings.preprocessors.graphicsmagick.timeout_seconds,
        formState.graphicsmagickTimeoutSeconds,
        "seconds"
      ),
    };
  }, [formState, settings]);

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
      setSuccessMessage("Advanced settings saved");
      setSubmitAttempted(false);
    } catch (saveError: unknown) {
      setError(getApiErrorMessage(saveError, "Failed to save advanced settings"));
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
      setSuccessMessage(`${label} reset to inherited value`);
      setSubmitAttempted(false);
    } catch (resetError: unknown) {
      setError(getApiErrorMessage(resetError, "Failed to reset setting override"));
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
            {saving ? <CircularProgress size={18} color="inherit" /> : "Save changes"}
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
            <SettingsGroup title="SMB backends">
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

            <SettingsGroup title="Preprocessors">
              <Stack spacing={3.5}>
                <SettingsGroup title="ImageMagick" titleVariant="subtitle2" titleSx={subsectionHeadingSx}>
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
                    unitAdornment="seconds"
                    onReset={() =>
                      handleReset(
                        settings.preprocessors.imagemagick.timeout_seconds.key,
                        settings.preprocessors.imagemagick.timeout_seconds.label
                      )
                    }
                    resetDisabled={saving || loading || hasUnsavedChanges}
                  />
                </SettingsGroup>

                <SettingsGroup title="GraphicsMagick" titleVariant="subtitle2" titleSx={subsectionHeadingSx}>
                  <ByteSizeSettingField
                    setting={settings.preprocessors.graphicsmagick.max_file_size_bytes}
                    value={formState.graphicsmagickMaxFileSizeBytes}
                    onChange={(value) =>
                      setFormState((current) => (current ? { ...current, graphicsmagickMaxFileSizeBytes: value } : current))
                    }
                    errorText={validationErrors?.graphicsmagickMaxFileSizeBytes}
                    showErrors={submitAttempted}
                    onReset={() =>
                      handleReset(
                        settings.preprocessors.graphicsmagick.max_file_size_bytes.key,
                        settings.preprocessors.graphicsmagick.max_file_size_bytes.label
                      )
                    }
                    resetDisabled={saving || loading || hasUnsavedChanges}
                  />
                  <SettingField
                    setting={settings.preprocessors.graphicsmagick.timeout_seconds}
                    value={formState.graphicsmagickTimeoutSeconds}
                    onChange={(value) =>
                      setFormState((current) => (current ? { ...current, graphicsmagickTimeoutSeconds: value } : current))
                    }
                    errorText={validationErrors?.graphicsmagickTimeoutSeconds}
                    showErrors={submitAttempted}
                    unitAdornment="seconds"
                    onReset={() =>
                      handleReset(
                        settings.preprocessors.graphicsmagick.timeout_seconds.key,
                        settings.preprocessors.graphicsmagick.timeout_seconds.label
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
