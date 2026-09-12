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

export interface FileOperationAction {
  id: FileOperationActionId;
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
  availability: Record<FileOperationActionId, FileOperationAvailability>;
  labels: Record<FileOperationActionId, string>;
  shortcuts: Record<FileOperationActionId, string>;
  unavailableReasons: Partial<Record<FileOperationActionId, string>>;
  handlers: Record<FileOperationActionId, () => void>;
}

interface FileOperationDefinition {
  id: FileOperationActionId;
  priority: number;
  requiresTwoPanes?: boolean;
}

const FILE_OPERATION_DEFINITIONS: readonly FileOperationDefinition[] = [
  { id: "new-directory", priority: 1 },
  { id: "new-file", priority: 2 },
  { id: "rename", priority: 3 },
  { id: "delete", priority: 4 },
  { id: "copy", priority: 5, requiresTwoPanes: true },
  { id: "move", priority: 6, requiresTwoPanes: true },
  { id: "create-archive", priority: 7 },
  { id: "extract-archive", priority: 8 },
  { id: "refresh", priority: 9 },
];

export function createFileOperationActions({
  hasTwoPanes,
  availability,
  labels,
  shortcuts,
  unavailableReasons,
  handlers,
}: FileOperationActionContext) {
  return FILE_OPERATION_DEFINITIONS.filter((definition) => !definition.requiresTwoPanes || hasTwoPanes).map((definition) => {
    const actionAvailability = availability[definition.id];
    const label = labels[definition.id];
    const shortcut = shortcuts[definition.id];
    const unavailableReason = actionAvailability.available ? undefined : unavailableReasons[definition.id];

    return {
      id: definition.id,
      priority: definition.priority,
      label,
      shortcut,
      tooltip: unavailableReason ? `${label} (${shortcut}): ${unavailableReason}` : `${label} (${shortcut})`,
      enabled: actionAvailability.available,
      unavailableReason,
      onClick: handlers[definition.id],
    } satisfies FileOperationAction;
  });
}
