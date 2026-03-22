export type NativeShareResult = "shared" | "cancelled" | "unsupported";
type ShareConnection = {
  saveData?: boolean;
  effectiveType?: string;
};

interface ShareOptions {
  file?: File;
  title?: string;
  text?: string;
  url?: string;
}

type ShareNavigator = Navigator & {
  share?: (data?: ShareData) => Promise<void>;
  canShare?: (data?: ShareData) => boolean;
  connection?: ShareConnection;
};

function getShareNavigator(): ShareNavigator | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  return navigator as ShareNavigator;
}

export function supportsNativeShare(): boolean {
  return typeof getShareNavigator()?.share === "function";
}
export function shouldWarmNativeSharePayload(): boolean {
  const connection = getShareNavigator()?.connection;
  if (!connection) {
    return true;
  }

  if (connection.saveData) {
    return false;
  }

  return !["slow-2g", "2g", "3g"].includes(connection.effectiveType ?? "");
}

export function createShareFile(blob: Blob, filename: string): File {
  const fileType = blob.type || "application/octet-stream";
  return new File([blob], filename, { type: fileType });
}

function canShareFiles(file: File): boolean {
  const shareNavigator = getShareNavigator();
  if (!shareNavigator || typeof shareNavigator.canShare !== "function") {
    return false;
  }

  try {
    return shareNavigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareNativeContent({ file, title, text, url }: ShareOptions): Promise<NativeShareResult> {
  const shareNavigator = getShareNavigator();
  if (!shareNavigator?.share) {
    return "unsupported";
  }

  const shareData: ShareData = {};
  const canShareFile = file ? canShareFiles(file) : false;

  if (file && canShareFile) {
    shareData.files = [file];
  }

  if (title) {
    shareData.title = title;
  }

  if (text) {
    shareData.text = text;
  }

  if (url) {
    shareData.url = url;
  }

  if (!shareData.files && !shareData.title && !shareData.text && !shareData.url) {
    return "unsupported";
  }

  try {
    await shareNavigator.share(shareData);
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return "cancelled";
    }

    throw error;
  }
}
