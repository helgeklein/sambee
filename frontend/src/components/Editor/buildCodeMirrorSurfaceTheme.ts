import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export interface CodeMirrorSurfaceThemeOptions {
  activeLineBackground: string;
  borderColor: string;
  currentSearchMatchBackground: string;
  isDarkMode: boolean;
  otherSearchMatchBackground: string;
  selectionBackground: string;
  surfaceBackground: string;
  textColor: string;
}

export function buildCodeMirrorSurfaceTheme({
  activeLineBackground,
  borderColor,
  currentSearchMatchBackground,
  isDarkMode,
  otherSearchMatchBackground,
  selectionBackground,
  surfaceBackground,
  textColor,
}: CodeMirrorSurfaceThemeOptions): Extension[] {
  return [
    EditorView.theme(
      {
        ".cm-editor": {
          color: textColor,
          backgroundColor: "transparent",
        },
        ".cm-scroller, .cm-content": {
          color: textColor,
          backgroundColor: "transparent",
          caretColor: textColor,
        },
        ".cm-selectionBackground": {
          backgroundColor: selectionBackground,
        },
        ".cm-searchMatch": {
          backgroundColor: otherSearchMatchBackground,
        },
        ".cm-searchMatch-selected": {
          backgroundColor: currentSearchMatchBackground,
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: textColor,
        },
        ".cm-activeLine": {
          backgroundColor: "transparent",
        },
        "&.cm-focused .cm-activeLine": {
          backgroundColor: activeLineBackground,
        },
        ".cm-matchingBracket, .cm-nonmatchingBracket": {
          outline: `1px solid ${borderColor}`,
        },
        ".cm-tooltip": {
          backgroundColor: surfaceBackground,
          border: `1px solid ${borderColor}`,
          color: textColor,
        },
        ".cm-tooltip-autocomplete ul li[aria-selected]": {
          backgroundColor: activeLineBackground,
          color: textColor,
        },
        ".cm-completionIcon": {
          opacity: 0.75,
        },
        ".cm-panels": {
          backgroundColor: surfaceBackground,
          color: textColor,
          borderBottom: `1px solid ${borderColor}`,
        },
        ".cm-panels.cm-panels-bottom": {
          borderBottom: 0,
          borderTop: `1px solid ${borderColor}`,
        },
      },
      { dark: isDarkMode }
    ),
  ];
}