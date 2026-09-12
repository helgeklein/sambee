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
  label: string;
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
  requiresTwoPanes?: boolean;
}

const FILE_OPERATION_DEFINITIONS: readonly FileOperationDefinition[] = [
  { id: "new-directory" },
  { id: "new-file" },
  { id: "rename" },
  { id: "delete" },
  { id: "copy", requiresTwoPanes: true },
  { id: "move", requiresTwoPanes: true },
  { id: "create-archive" },
  { id: "extract-archive" },
  { id: "refresh" },
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
      label,
      tooltip: unavailableReason ? `${label} (${shortcut}): ${unavailableReason}` : `${label} (${shortcut})`,
      enabled: actionAvailability.available,
      unavailableReason,
      onClick: handlers[definition.id],
    } satisfies FileOperationAction;
  });
}
