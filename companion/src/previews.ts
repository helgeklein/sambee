import type { ComponentType } from "preact";
import { AppPickerPreview } from "./components/AppPickerPreview";
import { ConflictDialogPreview } from "./components/ConflictDialogPreview";
import { DoneEditingWindowPreview } from "./components/DoneEditingWindowPreview";
import { LargeFileWarningPreview } from "./components/LargeFileWarningPreview";
import { RecoveryDialogPreview } from "./components/RecoveryDialogPreview";

export interface CompanionPreviewDefinition {
  path: string;
  title: string;
  description: string;
  component: ComponentType;
}

export const COMPANION_PREVIEWS: CompanionPreviewDefinition[] = [
  {
    path: "/preview/app-picker",
    title: "App Picker",
    description: "Preview the native app selection dialog with mock application data and theme/state controls.",
    component: AppPickerPreview,
  },
  {
    path: "/preview/conflict-dialog",
    title: "Conflict Dialog",
    description: "Preview the inline conflict resolution dialog used by Done Editing, with theme and action-result controls.",
    component: ConflictDialogPreview,
  },
  {
    path: "/preview/done-editing",
    title: "Done Editing Window",
    description: "Preview the compact Done Editing window with theme, file-state, and processing-state controls.",
    component: DoneEditingWindowPreview,
  },
  {
    path: "/preview/large-file-warning",
    title: "Large File Warning",
    description: "Preview the blocking large-file warning dialog with theme and action-result controls.",
    component: LargeFileWarningPreview,
  },
  {
    path: "/preview/recovery-dialog",
    title: "Recovery Dialog",
    description: "Preview the leftover recovery dialog with theme, item-count, and action-result controls.",
    component: RecoveryDialogPreview,
  },
];
