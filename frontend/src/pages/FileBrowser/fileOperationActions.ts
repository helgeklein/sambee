import type { BrowserItem, ContentLocation } from "./contentProviders";
import type { PaneId } from "./types";

export type FileOperationActionId =
  | "new-directory"
  | "new-file"
  | "rename"
  | "delete"
  | "copy"
  | "move"
  | "create-archive"
  | "extract-archive"
  | "refresh";

export interface FileOperationAvailability {
  available: boolean;
  reason?: string;
}

export type FileOperationSurface = "desktop-toolbar" | "compact-item-menu" | "compact-selection-menu" | "compact-create-menu";

export type FileOperationScope = "item" | "selection" | "pane";

export interface FileOperationPolicyContext {
  paneId: PaneId;
  items: readonly BrowserItem[];
  focusedItem?: BrowserItem;
}

export interface CapturedDestination {
  paneId: PaneId;
  location: ContentLocation;
}

export interface FileOperationInvocationContext extends FileOperationPolicyContext {
  destination?: CapturedDestination;
}

export interface FileOperationPlacement {
  surface: FileOperationSurface;
  scope: FileOperationScope;
  priority: number;
}

export interface FileOperationAction {
  id: FileOperationActionId;
  surface: FileOperationSurface;
  scope: FileOperationScope;
  priority: number;
  label: string;
  shortcut: string;
  tooltip: string;
  enabled: boolean;
  unavailableReason?: string;
  onClick: () => void;
}

interface FileOperationActionContext {
  hasTwoPanes: boolean;
  surface?: FileOperationSurface;
  availability: Record<FileOperationActionId, FileOperationAvailability>;
  labels: Record<FileOperationActionId, string>;
  shortcuts: Record<FileOperationActionId, string>;
  unavailableReasons: Partial<Record<FileOperationActionId, string>>;
  handlers: Record<FileOperationActionId, () => void>;
}

interface FileOperationDefinition {
  id: FileOperationActionId;
  placements: readonly FileOperationPlacement[];
  requiresTwoPanes?: boolean;
}

const FILE_OPERATION_DEFINITIONS: readonly FileOperationDefinition[] = [
  {
    id: "new-directory",
    placements: [
      { surface: "desktop-toolbar", scope: "pane", priority: 1 },
      { surface: "compact-create-menu", scope: "pane", priority: 1 },
    ],
  },
  {
    id: "new-file",
    placements: [
      { surface: "desktop-toolbar", scope: "pane", priority: 2 },
      { surface: "compact-create-menu", scope: "pane", priority: 2 },
    ],
  },
  {
    id: "rename",
    placements: [
      { surface: "desktop-toolbar", scope: "item", priority: 3 },
      { surface: "compact-item-menu", scope: "item", priority: 3 },
    ],
  },
  {
    id: "delete",
    placements: [
      { surface: "desktop-toolbar", scope: "selection", priority: 4 },
      { surface: "compact-item-menu", scope: "item", priority: 4 },
      { surface: "compact-selection-menu", scope: "selection", priority: 4 },
    ],
  },
  {
    id: "copy",
    placements: [
      { surface: "desktop-toolbar", scope: "selection", priority: 5 },
      { surface: "compact-selection-menu", scope: "selection", priority: 1 },
    ],
    requiresTwoPanes: true,
  },
  {
    id: "move",
    placements: [
      { surface: "desktop-toolbar", scope: "selection", priority: 6 },
      { surface: "compact-selection-menu", scope: "selection", priority: 2 },
    ],
    requiresTwoPanes: true,
  },
  {
    id: "create-archive",
    placements: [
      { surface: "desktop-toolbar", scope: "selection", priority: 7 },
      { surface: "compact-selection-menu", scope: "selection", priority: 3 },
    ],
  },
  {
    id: "extract-archive",
    placements: [
      { surface: "desktop-toolbar", scope: "item", priority: 8 },
      { surface: "compact-item-menu", scope: "item", priority: 5 },
    ],
  },
  { id: "refresh", placements: [{ surface: "desktop-toolbar", scope: "pane", priority: 9 }] },
];

export function createFileOperationActions({
  hasTwoPanes,
  surface = "desktop-toolbar",
  availability,
  labels,
  shortcuts,
  unavailableReasons,
  handlers,
}: FileOperationActionContext) {
  return FILE_OPERATION_DEFINITIONS.flatMap((definition) => {
    if (definition.requiresTwoPanes && !hasTwoPanes) return [];
    const placement = definition.placements.find((candidate) => candidate.surface === surface);
    if (!placement) return [];

    const actionAvailability = availability[definition.id];
    const label = labels[definition.id];
    const shortcut = shortcuts[definition.id];
    const unavailableReason = actionAvailability.available ? undefined : unavailableReasons[definition.id];

    return [
      {
        id: definition.id,
        surface,
        scope: placement.scope,
        priority: placement.priority,
        label,
        shortcut,
        tooltip: unavailableReason ? `${label} (${shortcut}): ${unavailableReason}` : `${label} (${shortcut})`,
        enabled: actionAvailability.available,
        unavailableReason,
        onClick: handlers[definition.id],
      } satisfies FileOperationAction,
    ];
  }).sort((left, right) => left.priority - right.priority);
}
