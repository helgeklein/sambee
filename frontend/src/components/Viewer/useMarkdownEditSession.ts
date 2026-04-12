import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
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
  hasUserEditedInSession: boolean;
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
  const [hasUserEditedInSession, setHasUserEditedInSession] = useState(false);
  const allowBaselineSyncRef = useRef(false);
  const pendingRestoreEditorFocusRef = useRef(false);
  const pendingBaselineSyncRequestIdRef = useRef(0);
  const baselineSyncWindowTimeoutRef = useRef<number | null>(null);

  const clearPendingBaselineSync = useCallback(() => {
    pendingBaselineSyncRequestIdRef.current += 1;
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
    setHasUserEditedInSession(false);
  }, []);

  const requestRestoreEditingFocus = useCallback(() => {
    pendingRestoreEditorFocusRef.current = true;
  }, []);

  const handleEditorChange = useCallback(
    (nextMarkdown: string) => {
      if (isEditing && allowBaselineSyncRef.current && !hasUserEditedRef.current) {
        clearPendingBaselineSync();
        const requestId = pendingBaselineSyncRequestIdRef.current;

        queueMicrotask(() => {
          if (pendingBaselineSyncRequestIdRef.current !== requestId) {
            return;
          }

          if (allowBaselineSyncRef.current && !hasUserEditedRef.current) {
            setEditBaselineContent(nextMarkdown);
            return;
          }

          setDraftContent(nextMarkdown);
        });

        return;
      }

      setDraftContent(nextMarkdown);
    },
    [clearPendingBaselineSync, isEditing, setDraftContent, setEditBaselineContent]
  );

  const handleEditorUserEdit = useCallback(() => {
    clearBaselineSyncWindow();
    hasUserEditedRef.current = true;
    setHasUserEditedInSession(true);
  }, [clearBaselineSyncWindow]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    const interactionRoot = contentRef.current;

    if (!interactionRoot) {
      return;
    }

    const handleEditorInteractionStart = (event: Event) => {
      const target = event.target;

      if (target instanceof HTMLElement && target.matches('[contenteditable="true"], textarea')) {
        clearBaselineSyncWindow();
      }
    };

    const handleToolbarInteractionStart = (event: Event) => {
      const target = event.target;

      if (target instanceof HTMLElement && target.closest('[data-toolbar-item="true"], [data-toolbar-item]')) {
        clearBaselineSyncWindow();
      }
    };

    interactionRoot.addEventListener("keydown", handleEditorInteractionStart);
    interactionRoot.addEventListener("pointerdown", handleEditorInteractionStart);
    interactionRoot.addEventListener("keydown", handleToolbarInteractionStart);
    interactionRoot.addEventListener("pointerdown", handleToolbarInteractionStart);

    return () => {
      interactionRoot.removeEventListener("keydown", handleEditorInteractionStart);
      interactionRoot.removeEventListener("pointerdown", handleEditorInteractionStart);
      interactionRoot.removeEventListener("keydown", handleToolbarInteractionStart);
      interactionRoot.removeEventListener("pointerdown", handleToolbarInteractionStart);
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
    hasUserEditedInSession,
    markEditSessionPristine,
    requestRestoreEditingFocus,
  };
}
