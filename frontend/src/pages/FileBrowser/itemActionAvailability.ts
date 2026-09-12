import { FileType } from "../../types";
import { getCompatibleViewerIds } from "../../utils/FileTypeRegistry";
import { type ContentOperationEnvironment, getNativeOpenAvailability } from "./contentOperations";
import type { BrowserItem } from "./contentProviders";

export interface ItemActionAvailability {
  canOpenInBrowserViewer: boolean;
  canChooseBrowserViewer: boolean;
  canOpenInNativeApp: boolean;
  canChooseNativeApp: boolean;
}

interface ItemActionAvailabilityInput {
  item?: BrowserItem;
  nativeAppCapability: boolean;
  isCompanionPaired: boolean;
  environment: ContentOperationEnvironment;
}

export function getItemActionAvailability({
  item,
  nativeAppCapability,
  isCompanionPaired,
  environment,
}: ItemActionAvailabilityInput): ItemActionAvailability {
  if (!item || item.entry.type !== FileType.FILE || item.entry.link_target?.target?.type === FileType.DIRECTORY) {
    return {
      canOpenInBrowserViewer: false,
      canChooseBrowserViewer: false,
      canOpenInNativeApp: false,
      canChooseNativeApp: false,
    };
  }

  const compatibleViewerIds = getCompatibleViewerIds(item.entry.name, item.entry.mime_type ?? "application/octet-stream");
  const canOpenInBrowserViewer = compatibleViewerIds.length > 0;
  const canOpenInNativeApp = isCompanionPaired && nativeAppCapability && getNativeOpenAvailability(item.handle, environment).available;

  return {
    canOpenInBrowserViewer,
    canChooseBrowserViewer: canOpenInBrowserViewer,
    canOpenInNativeApp,
    canChooseNativeApp: canOpenInNativeApp,
  };
}
