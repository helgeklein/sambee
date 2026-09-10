import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import { CircularProgress, InputAdornment } from "@mui/material";
import { useEffect, useRef, useState } from "react";

export const SETTING_SUCCESS_DISPLAY_MS = 2_000;

type FieldUpdate = { field: string; value: unknown };

type FieldPersistenceResult<Update extends FieldUpdate> =
  | { status: "completed"; update: Update }
  | { status: "duplicate" }
  | { status: "failed"; error: unknown };

export function useSystemSettingPersistence<Update extends FieldUpdate>(
  commit: (update: Update) => Promise<Update>,
  getErrorMessage: (error: unknown) => string
) {
  const [pendingFields, setPendingFields] = useState<Record<string, boolean>>({});
  const [savedFields, setSavedFields] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const pendingTokens = useRef<Record<string, symbol>>({});
  const successTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      for (const timer of Object.values(successTimers.current)) clearTimeout(timer);
    },
    []
  );

  const clearFieldFeedback = (field: string) => {
    const timer = successTimers.current[field];
    if (timer) clearTimeout(timer);
    delete successTimers.current[field];
    setSavedFields((current) => ({ ...current, [field]: false }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const persist = async (update: Update): Promise<FieldPersistenceResult<Update>> => {
    if (pendingTokens.current[update.field]) return { status: "duplicate" };

    const token = Symbol(update.field);
    pendingTokens.current[update.field] = token;
    clearFieldFeedback(update.field);
    setPendingFields((current) => ({ ...current, [update.field]: true }));
    try {
      const response = await commit(update);
      if (response.field !== update.field) throw new Error("The server returned an update for a different setting.");
      if (!mounted.current || pendingTokens.current[update.field] !== token) return { status: "duplicate" };

      setSavedFields((current) => ({ ...current, [update.field]: true }));
      successTimers.current[update.field] = setTimeout(() => {
        if (mounted.current) setSavedFields((current) => ({ ...current, [update.field]: false }));
        delete successTimers.current[update.field];
      }, SETTING_SUCCESS_DISPLAY_MS);
      return { status: "completed", update: response };
    } catch (error: unknown) {
      if (mounted.current && pendingTokens.current[update.field] === token) {
        setFieldErrors((current) => ({ ...current, [update.field]: getErrorMessage(error) }));
      }
      return { status: "failed", error };
    } finally {
      if (pendingTokens.current[update.field] === token) {
        delete pendingTokens.current[update.field];
        if (mounted.current) setPendingFields((current) => ({ ...current, [update.field]: false }));
      }
    }
  };

  return {
    clearFieldFeedback,
    fieldErrors,
    isPending: (field: string) => Boolean(pendingFields[field]),
    isSaved: (field: string) => Boolean(savedFields[field]),
    persist,
  };
}

export function SettingPersistenceAdornment({
  pending,
  saved,
  savingLabel,
  savedLabel,
}: {
  pending: boolean;
  saved: boolean;
  savingLabel: string;
  savedLabel: string;
}) {
  if (!pending && !saved) return null;
  return (
    <InputAdornment position="end">
      <SettingPersistenceIndicator pending={pending} saved={saved} savingLabel={savingLabel} savedLabel={savedLabel} />
    </InputAdornment>
  );
}

export function SettingPersistenceIndicator({
  pending,
  saved,
  savingLabel,
  savedLabel,
}: {
  pending: boolean;
  saved: boolean;
  savingLabel: string;
  savedLabel: string;
}) {
  if (pending) {
    return <CircularProgress size={18} aria-label={savingLabel} role="status" />;
  }
  if (saved) {
    return <CheckCircleOutlineIcon color="success" fontSize="small" aria-label={savedLabel} />;
  }
  return null;
}
