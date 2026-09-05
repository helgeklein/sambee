import { EditorSelection, type Extension, type Text } from "@codemirror/state";
import { EditorView, layer, RectangleMarker } from "@codemirror/view";
import { getCodeMirrorHorizontalInset } from "./getCodeMirrorHorizontalInset";

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

function expandSelectionRectangles(
  view: EditorView,
  markers: readonly RectangleMarker[],
  rangeClass: string,
  lineBlockBounds?: { top: number; bottom: number }
): RectangleMarker[] {
  const targetHeight = view.defaultLineHeight;
  const expandToDefaultLineHeight = markers.every((marker) => marker.height < targetHeight);

  const rows: Array<{ markers: RectangleMarker[]; top: number; bottom: number }> = [];

  for (const marker of markers) {
    const row = rows.find((candidate) => Math.abs(candidate.top - marker.top) < 0.5);

    if (row) {
      row.markers.push(marker);
      row.bottom = Math.max(row.bottom, marker.top + marker.height);
    } else {
      rows.push({ markers: [marker], top: marker.top, bottom: marker.top + marker.height });
    }
  }

  rows.sort((left, right) => left.top - right.top);

  const devicePixelRatio = view.contentDOM.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  const viewportTop = view.scrollDOM.getBoundingClientRect().top;
  const snapToDevicePixel = (position: number) => Math.round((viewportTop + position) * devicePixelRatio) / devicePixelRatio - viewportTop;

  return rows.flatMap((row, index) => {
    const previousRow = rows[index - 1];
    const nextRow = rows[index + 1];
    const unroundedTop = previousRow
      ? (previousRow.bottom + row.top) / 2
      : (lineBlockBounds?.top ?? (expandToDefaultLineHeight ? row.top - (targetHeight - (row.bottom - row.top)) / 2 : row.top));
    const unroundedBottom = nextRow
      ? (row.bottom + nextRow.top) / 2
      : (lineBlockBounds?.bottom ?? (expandToDefaultLineHeight ? row.bottom + (targetHeight - (row.bottom - row.top)) / 2 : row.bottom));
    const top = previousRow ? snapToDevicePixel(unroundedTop) : unroundedTop;
    const bottom = nextRow ? snapToDevicePixel(unroundedBottom) : unroundedBottom;

    return row.markers.map((marker) => new RectangleMarker(rangeClass, marker.left, top, marker.width, bottom - top));
  });
}

function getLineBlockMarkerBounds(view: EditorView, position: number): { top: number; bottom: number } {
  const block = view.lineBlockAt(position);
  const scrollRect = view.scrollDOM.getBoundingClientRect();
  const baseTop = scrollRect.top - view.scrollDOM.scrollTop * view.scaleY;
  const blockTop = view.documentTop + block.top * view.scaleY - baseTop;

  return { top: blockTop, bottom: blockTop + block.height * view.scaleY };
}

function alignSelectionRectanglesWithContentInset(
  view: EditorView,
  markers: readonly RectangleMarker[],
  rangeClass: string
): RectangleMarker[] {
  const horizontalInset = getCodeMirrorHorizontalInset(view);

  return markers.map((marker) => {
    if (marker.left >= horizontalInset || marker.width === null) {
      return marker;
    }

    const right = marker.left + marker.width;
    const left = Math.min(horizontalInset, right);

    return new RectangleMarker(rangeClass, left, marker.top, right - left, marker.height);
  });
}

function buildEmptyLineSelectionMarkers(view: EditorView, position: number, rangeClass: string): RectangleMarker[] {
  const cursorMarkers = RectangleMarker.forRange(view, rangeClass, EditorSelection.cursor(position));
  const lineBlockBounds = getLineBlockMarkerBounds(view, position);

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
    rangeClass,
    lineBlockBounds
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
          const line = view.state.doc.lineAt(segment.from);
          const lineBlockBounds =
            segment.emptyLine || segment.from !== line.from || segment.to !== line.to
              ? undefined
              : getLineBlockMarkerBounds(view, segment.from);
          const segmentMarkers = segment.emptyLine
            ? buildEmptyLineSelectionMarkers(view, segment.from, rangeClass)
            : expandSelectionRectangles(
                view,
                RectangleMarker.forRange(view, rangeClass, EditorSelection.range(segment.from, segment.to)),
                rangeClass,
                lineBlockBounds
              );

          markers.push(...alignSelectionRectanglesWithContentInset(view, segmentMarkers, rangeClass));
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
    "& > .cm-scroller > .cm-content ::selection": {
      backgroundColor: "transparent",
    },
    "& > .cm-scroller > .cm-content > .cm-line::selection, & > .cm-scroller > .cm-content > .cm-line ::selection": {
      backgroundColor: "transparent",
    },
    [`.${rangeClass}`]: {
      backgroundColor: selectionBackground,
    },
  });
}
