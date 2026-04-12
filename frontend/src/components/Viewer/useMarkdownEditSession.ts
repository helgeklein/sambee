import { type RefObject, useCallback, useEffect, useRef } from "react";
import { MARKDOWN_EDITOR_BASELINE_SYNC_WINDOW_MS } from "./markdownEditorConstants";

interface UseMarkdownEditSessionOptions {
  isEditing: boolean;
  isSaving: boolean;
  contentRef: RefObject<HTMLDivElement>;
  hasPendingUnsavedChangesAction: boolean;
  restoreEditingFocus: () => (() => void) | undefined;
  setDraftContent: (markdown: string) => void;
  setEditBaselineContent: (markdown: string) => void;
}

export interface MarkdownEditSessionController {
  beginBaselineSyncWindow: () => void;
  clearBaselineSyncWindow: () => void;
  clearPendingBaselineSync: () => void;
  handleEditorChange: (markdown: string) => void;
  handleEditorUserEdit: () => void;
  markEditSessionPristine: () => void;
  requestRestoreEditingFocus: () => void;
}

export function useMarkdownEditSession({
  isEditing,
  isSaving,
  contentRef,
  hasPendingUnsavedChangesAction,
  restoreEditingFocus,
  setDraftContent,
  setEditBaselineContent,
}: UseMarkdownEditSessionOptions): MarkdownEditSessionController {
  const hasUserEditedRef = useRef(false);
  const allowBaselineSyncRef = useRef(false);
  const pendingRestoreEditorFocusRef = useRef(false);
  const pendingBaselineSyncTimeoutRef = useRef<number | null>(null);
  const baselineSyncWindowTimeoutRef = useRef<number | null>(null);

  const clearPendingBaselineSync = useCallback(() => {
    if (pendingBaselineSyncTimeoutRef.current !== null) {
      window.clearTimeout(pendingBaselineSyncTimeoutRef.current);
      pendingBaselineSyncTimeoutRef.current = null;
    }
  }, []);

  const clearBaselineSyncWindow = useCallback(() => {
    if (baselineSyncWindowTimeoutRef.current !== null) {
      window.clearTimeout(baselineSyncWindowTimeoutRef.current);
      baselineSyncWindowTimeoutRef.current = null;
    }

    allowBaselineSyncRef.current = false;
  }, []);

  const beginBaselineSyncWindow = useCallback(() => {
    clearBaselineSyncWindow();
    allowBaselineSyncRef.current = true;
    baselineSyncWindowTimeoutRef.current = window.setTimeout(() => {
      baselineSyncWindowTimeoutRef.current = null;
      allowBaselineSyncRef.current = false;
    }, MARKDOWN_EDITOR_BASELINE_SYNC_WINDOW_MS);
  }, [clearBaselineSyncWindow]);

  const markEditSessionPristine = useCallback(() => {
    hasUserEditedRef.current = false;
  }, []);

  const requestRestoreEditingFocus = useCallback(() => {
    pendingRestoreEditorFocusRef.current = true;
  }, []);

  const handleEditorChange = useCallback(
    (nextMarkdown: string) => {
      if (isEditing && allowBaselineSyncRef.current && !hasUserEditedRef.current) {
        clearPendingBaselineSync();
        pendingBaselineSyncTimeoutRef.current = window.setTimeout(() => {
          pendingBaselineSyncTimeoutRef.current = null;

          if (allowBaselineSyncRef.current && !hasUserEditedRef.current) {
            setEditBaselineContent(nextMarkdown);
          }
        }, 0);
      }

      setDraftContent(nextMarkdown);
    },
    [clearPendingBaselineSync, isEditing, setDraftContent, setEditBaselineContent]
  );

  const handleEditorUserEdit = useCallback(() => {
    clearPendingBaselineSync();
    clearBaselineSyncWindow();
    hasUserEditedRef.current = true;
  }, [clearBaselineSyncWindow, clearPendingBaselineSync]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const interactionRoot = contentRef.current;

    if (!interactionRoot) {
      return;
    }

    const handleEditorFocusIn = (event: FocusEvent) => {
      const target = event.target;

      if (target instanceof HTMLElement && target.matches('[contenteditable="true"], textarea')) {
        clearBaselineSyncWindow();
      }
    };

    interactionRoot.addEventListener("focusin", handleEditorFocusIn);

    return () => {
      interactionRoot.removeEventListener("focusin", handleEditorFocusIn);
    };
  }, [clearBaselineSyncWindow, contentRef, isEditing]);

  useEffect(() => {
    if (!isEditing || isSaving || !pendingRestoreEditorFocusRef.current || hasPendingUnsavedChangesAction) {
      return;
    }

    pendingRestoreEditorFocusRef.current = false;

    return restoreEditingFocus();
  }, [hasPendingUnsavedChangesAction, isEditing, isSaving, restoreEditingFocus]);

  useEffect(() => {
    return () => {
      clearPendingBaselineSync();
      clearBaselineSyncWindow();
    };
  }, [clearBaselineSyncWindow, clearPendingBaselineSync]);

  return {
    beginBaselineSyncWindow,
    clearBaselineSyncWindow,
    clearPendingBaselineSync,
    handleEditorChange,
    handleEditorUserEdit,
    markEditSessionPristine,
    requestRestoreEditingFocus,
  };
}
