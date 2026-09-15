import { useEffect, useRef, useState } from "react";
import { type EditorChangeSummary, getEditorChangeSummary } from "../Editor/editorChangeTracking";

const CHANGE_SUMMARY_DEBOUNCE_MS = 250;

interface UseEditorChangeSummaryOptions {
  baseline: string;
  current: string;
  enabled: boolean;
  immediateUpdateToken: number;
}

export function useEditorChangeSummary({
  baseline,
  current,
  enabled,
  immediateUpdateToken,
}: UseEditorChangeSummaryOptions): EditorChangeSummary | null {
  const [summary, setSummary] = useState<EditorChangeSummary | null>(null);
  const previousImmediateUpdateTokenRef = useRef(immediateUpdateToken);

  useEffect(() => {
    if (!enabled) {
      setSummary(null);
      return;
    }

    const updateSummary = () => setSummary(getEditorChangeSummary(baseline, current));
    if (previousImmediateUpdateTokenRef.current !== immediateUpdateToken) {
      previousImmediateUpdateTokenRef.current = immediateUpdateToken;
      updateSummary();
      return;
    }

    const timeoutId = window.setTimeout(updateSummary, CHANGE_SUMMARY_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [baseline, current, enabled, immediateUpdateToken]);

  return summary;
}
