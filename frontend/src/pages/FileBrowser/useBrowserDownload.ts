import type { TFunction } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../services/logger";
import { FileType } from "../../types";
import { downloadContentSelection } from "./contentOperations";
import type { BrowserItem, ContentProviderRegistry } from "./contentProviders";

export function useBrowserDownload(providers: ContentProviderRegistry, t: TFunction, showNotice: (message: string) => void) {
  const controllerRef = useRef<AbortController | null>(null);
  const [downloadKind, setDownloadKind] = useState<"file" | "archive" | null>(null);
  const isDownloading = downloadKind !== null;

  useEffect(() => () => controllerRef.current?.abort(), []);

  const cancelDownload = useCallback(() => controllerRef.current?.abort(), []);
  const startDownload = useCallback(
    async (items: readonly BrowserItem[]) => {
      const item = items[0];
      if (controllerRef.current || !item || items.some((selected) => !selected.entry.is_readable)) return;

      const controller = new AbortController();
      controllerRef.current = controller;
      setDownloadKind(items.length > 1 || item.entry.type === FileType.DIRECTORY ? "archive" : "file");
      try {
        await downloadContentSelection(items, providers, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          logger.error("File download failed", { error, path: item.handle.path }, "file-browser");
          showNotice(
            error instanceof Error && error.message === "temporary_archive_size_limit_exceeded"
              ? t("fileBrowser.transfers.downloadSizeLimitExceeded")
              : error instanceof Error
                ? error.message
                : t("fileBrowser.transfers.downloadFailed")
          );
        }
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setDownloadKind(null);
        }
      }
    },
    [providers, showNotice, t]
  );

  return { startDownload, cancelDownload, isDownloading, downloadKind };
}
