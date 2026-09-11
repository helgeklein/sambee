import { useEffect, useRef, useState } from "react";
import { SettingSaveStatus, SettingSaveStatusAdornment } from "../components/Settings/SettingSaveStatus";
import { SETTING_SUCCESS_DISPLAY_MS } from "../services/settingSaveFeedback";

export { SETTING_SUCCESS_DISPLAY_MS } from "../services/settingSaveFeedback";
export { SettingSaveStatus as SettingPersistenceIndicator, SettingSaveStatusAdornment as SettingPersistenceAdornment };
export const SYSTEM_SETTING_PERSIST_TIMEOUT_MS = 15_000;
const SYSTEM_SETTING_PERSIST_TIMEOUT_MESSAGE = "Saving this setting timed out. Check the connection and try again.";

type FieldUpdate = { field: string; value: unknown };

type SystemSettingCommitOptions = {
  signal: AbortSignal;
};

type FieldPersistenceResult<Update extends FieldUpdate> =
  | { status: "completed"; update: Update }
  | { status: "unchanged" }
  | { status: "duplicate" }
  | { status: "failed"; error: unknown };

class SystemSettingPersistTimeoutError extends Error {
  constructor() {
    super(SYSTEM_SETTING_PERSIST_TIMEOUT_MESSAGE);
    this.name = "SystemSettingPersistTimeoutError";
  }
}

function areSettingValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

export function useSystemSettingPersistence<Update extends FieldUpdate>(
  commit: (update: Update, options: SystemSettingCommitOptions) => Promise<Update>,
  getErrorMessage: (error: unknown) => string,
  timeoutMs = SYSTEM_SETTING_PERSIST_TIMEOUT_MS
) {
  const [pendingFields, setPendingFields] = useState<Record<string, boolean>>({});
  const [savedFields, setSavedFields] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const pendingTokens = useRef<Record<string, symbol>>({});
  const abortControllers = useRef<Record<string, AbortController>>({});
  const successTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      for (const timer of Object.values(successTimers.current)) clearTimeout(timer);
      for (const controller of Object.values(abortControllers.current)) controller.abort();
    };
  }, []);

  const clearFieldFeedback = (field: string) => {
    const timer = successTimers.current[field];
    if (timer) clearTimeout(timer);
    delete successTimers.current[field];
    setSavedFields((current) => ({ ...current, [field]: false }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const persist = async (update: Update, confirmedValue?: unknown): Promise<FieldPersistenceResult<Update>> => {
    if (confirmedValue !== undefined && areSettingValuesEqual(update.value, confirmedValue)) return { status: "unchanged" };
    if (pendingTokens.current[update.field]) return { status: "duplicate" };

    const token = Symbol(update.field);
    const controller = new AbortController();
    pendingTokens.current[update.field] = token;
    abortControllers.current[update.field] = controller;
    clearFieldFeedback(update.field);
    setPendingFields((current) => ({ ...current, [update.field]: true }));
    let rejectTimeout: (reason: SystemSettingPersistTimeoutError) => void;
    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    const timeout = setTimeout(() => {
      rejectTimeout(new SystemSettingPersistTimeoutError());
      controller.abort();
    }, timeoutMs);
    try {
      const response = await Promise.race([commit(update, { signal: controller.signal }), timeoutPromise]);
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
        const message = error instanceof SystemSettingPersistTimeoutError ? SYSTEM_SETTING_PERSIST_TIMEOUT_MESSAGE : getErrorMessage(error);
        setFieldErrors((current) => ({ ...current, [update.field]: message }));
      }
      return { status: "failed", error };
    } finally {
      clearTimeout(timeout);
      if (pendingTokens.current[update.field] === token) {
        delete pendingTokens.current[update.field];
        delete abortControllers.current[update.field];
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
