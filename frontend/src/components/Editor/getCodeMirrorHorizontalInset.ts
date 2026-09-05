import type { EditorView } from "@codemirror/view";
import { CODEMIRROR_EDITOR_HORIZONTAL_INSET_CSS_VARIABLE } from "../../theme/viewerStyles";

export function getCodeMirrorHorizontalInset(view: EditorView): number {
  const rawInset = view.contentDOM.ownerDocument.defaultView
    ?.getComputedStyle(view.contentDOM)
    .getPropertyValue(CODEMIRROR_EDITOR_HORIZONTAL_INSET_CSS_VARIABLE);
  const inset = Number.parseFloat(rawInset ?? "");

  return Number.isFinite(inset) && inset >= 0 ? inset : 0;
}
