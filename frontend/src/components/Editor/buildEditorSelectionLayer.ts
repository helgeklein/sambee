import { EditorSelection, type Extension, type Text } from "@codemirror/state";
import { EditorView, layer, RectangleMarker } from "@codemirror/view";

export const EDITOR_SELECTION_RANGE_CLASS = "sambee-editor-selection-range";
export const EDITOR_SELECTION_LAYER_CLASS = "sambee-editor-selection-layer";

export interface SelectionLineSegment {
  from: number;
  to: number;
  emptyLine: boolean;
}

export function getSelectionLineSegments(doc: Text, range: { from: number; to: number }): SelectionLineSegment[] {
  const segments: SelectionLineSegment[] = [];

  let line = doc.lineAt(range.from);

  for (;;) {
    const segmentFrom = Math.max(range.from, line.from);
    const segmentTo = Math.min(range.to, line.to);

    if (segmentFrom < segmentTo) {
      segments.push({ from: segmentFrom, to: segmentTo, emptyLine: false });
    } else if (line.length === 0 && range.from <= line.from && line.from < range.to) {
      // Mirror VS Code's visual behavior on empty lines by painting a single
      // character cell at the line start when the selection crosses that row.
      segments.push({ from: line.from, to: line.to, emptyLine: true });
    }

    if (line.to >= range.to) {
      break;
    }

    line = doc.line(line.number + 1);
  }

  return segments;
}

function expandSelectionRectangles(view: EditorView, markers: readonly RectangleMarker[], rangeClass: string): RectangleMarker[] {
  const targetHeight = view.defaultLineHeight;

  return markers.map((marker) => {
    if (marker.height >= targetHeight) {
      return marker;
    }

    const expansion = (targetHeight - marker.height) / 2;

    return new RectangleMarker(rangeClass, marker.left, marker.top - expansion, marker.width, targetHeight);
  });
}

function buildEmptyLineSelectionMarkers(view: EditorView, position: number, rangeClass: string): RectangleMarker[] {
  const cursorMarkers = RectangleMarker.forRange(view, rangeClass, EditorSelection.cursor(position));

  return expandSelectionRectangles(
    view,
    cursorMarkers.map(
      (marker) =>
        new RectangleMarker(
          rangeClass,
          marker.left,
          marker.top,
          marker.width === null ? view.defaultCharacterWidth : Math.max(marker.width, view.defaultCharacterWidth),
          marker.height
        )
    ),
    rangeClass
  );
}

export function buildSelectionLayerExtension({
  layerClass = EDITOR_SELECTION_LAYER_CLASS,
  rangeClass = EDITOR_SELECTION_RANGE_CLASS,
}: {
  layerClass?: string;
  rangeClass?: string;
} = {}): Extension {
  return layer({
    above: false,
    class: layerClass,
    update(update) {
      return update.docChanged || update.selectionSet || update.viewportChanged;
    },
    markers(view) {
      const markers: RectangleMarker[] = [];

      for (const range of view.state.selection.ranges) {
        if (range.empty) {
          continue;
        }

        for (const segment of getSelectionLineSegments(view.state.doc, range)) {
          if (segment.emptyLine) {
            markers.push(...buildEmptyLineSelectionMarkers(view, segment.from, rangeClass));
          } else {
            markers.push(
              ...expandSelectionRectangles(
                view,
                RectangleMarker.forRange(view, rangeClass, EditorSelection.range(segment.from, segment.to)),
                rangeClass
              )
            );
          }
        }
      }

      return markers;
    },
  });
}

export function buildSelectionLayerTheme({
  rangeClass = EDITOR_SELECTION_RANGE_CLASS,
  selectionBackground,
}: {
  rangeClass?: string;
  selectionBackground: string;
}): Extension {
  return EditorView.theme({
    ".cm-content ::selection": {
      backgroundColor: "transparent",
    },
    ".cm-line::selection, .cm-line ::selection": {
      backgroundColor: "transparent",
    },
    [`.${rangeClass}`]: {
      backgroundColor: selectionBackground,
    },
  });
}
