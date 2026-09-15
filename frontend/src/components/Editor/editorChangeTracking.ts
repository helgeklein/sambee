import type { Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import { diffArrays } from "diff";

export type EditorChangeKind = "added" | "modified" | "deleted";

export interface EditorChangeMarker {
  lineNumber: number;
  kinds: EditorChangeKind[];
}

export interface EditorChangeSummary {
  added: number;
  deleted: number;
  markers: EditorChangeMarker[];
  modified: number;
}

const CHANGE_SYMBOLS: Record<EditorChangeKind, string> = {
  added: "+",
  modified: "~",
  deleted: "-",
};

class EditorChangeGutterMarker extends GutterMarker {
  constructor(
    private readonly kinds: EditorChangeKind[],
    private readonly labels: EditorChangeTrackingLabels
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = `sambee-editor-change-marker sambee-editor-change-marker--${this.kinds.join("-")}`;
    marker.textContent = this.kinds.map((kind) => CHANGE_SYMBOLS[kind]).join("");
    marker.title = this.kinds.map((kind) => this.labels[kind]).join(", ");
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }
}

function getLines(value: string): string[] {
  if (!value) {
    return [];
  }

  const normalized = value.endsWith("\n") ? value.slice(0, -1) : value;
  return normalized ? normalized.split("\n") : [];
}

function addMarker(markers: Map<number, Set<EditorChangeKind>>, lineNumber: number, kind: EditorChangeKind): void {
  const lineMarkers = markers.get(lineNumber) ?? new Set<EditorChangeKind>();
  lineMarkers.add(kind);
  markers.set(lineNumber, lineMarkers);
}

export function getEditorChangeSummary(baseline: string, current: string): EditorChangeSummary {
  const markers = new Map<number, Set<EditorChangeKind>>();
  const currentLineCount = getLines(current).length;
  let added = 0;
  let deleted = 0;
  let modified = 0;
  let currentLine = 1;
  let removedLines = 0;
  let addedLines = 0;

  const flushChangeGroup = () => {
    if (removedLines === 0 && addedLines === 0) {
      return;
    }

    const replacementCount = Math.min(removedLines, addedLines);
    for (let index = 0; index < replacementCount; index += 1) {
      addMarker(markers, currentLine + index, "modified");
    }
    modified += replacementCount;

    for (let index = replacementCount; index < addedLines; index += 1) {
      addMarker(markers, currentLine + index, "added");
    }
    added += addedLines - replacementCount;

    if (removedLines > replacementCount) {
      const nextSurvivingLine = currentLine + addedLines;
      const deletionAnchor = nextSurvivingLine <= currentLineCount ? nextSurvivingLine : currentLineCount > 0 ? currentLineCount : 1;
      addMarker(markers, deletionAnchor, "deleted");
      deleted += removedLines - replacementCount;
    }

    currentLine += addedLines;
    removedLines = 0;
    addedLines = 0;
  };

  for (const change of diffArrays(getLines(baseline), getLines(current))) {
    const lineCount = change.value.length;
    if (change.removed) {
      removedLines += lineCount;
      continue;
    }
    if (change.added) {
      addedLines += lineCount;
      continue;
    }

    flushChangeGroup();
    currentLine += lineCount;
  }

  flushChangeGroup();

  return {
    added,
    deleted,
    markers: [...markers.entries()].map(([lineNumber, kinds]) => ({ lineNumber, kinds: [...kinds] })),
    modified,
  };
}

export interface EditorChangeTrackingLabels {
  added: string;
  deleted: string;
  modified: string;
}

export function buildEditorChangeTrackingExtension(summary: EditorChangeSummary, labels: EditorChangeTrackingLabels): Extension {
  const markers = new Map(summary.markers.map((marker) => [marker.lineNumber, marker]));
  return [
    gutter({
      class: "sambee-editor-change-gutter",
      lineMarker: (_view, line) => {
        const marker = markers.get(line.number);
        return marker ? new EditorChangeGutterMarker(marker.kinds, labels) : null;
      },
    }),
    EditorView.baseTheme({
      ".sambee-editor-change-gutter": {
        minWidth: "1.5rem",
      },
      ".sambee-editor-change-marker": {
        display: "block",
        minWidth: "1.25rem",
        fontFamily: "monospace",
        fontWeight: "700",
        textAlign: "center",
      },
      ".sambee-editor-change-marker--added": { color: "#1b7f3a" },
      ".sambee-editor-change-marker--modified": { color: "#9a6700" },
      ".sambee-editor-change-marker--deleted": { color: "#b42318" },
    }),
  ];
}
