import type { ComponentType } from "preact";
import { AppPickerPreview } from "./components/AppPickerPreview";

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
];
