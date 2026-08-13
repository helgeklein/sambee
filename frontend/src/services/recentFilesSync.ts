export const RECENT_FILES_CHANGED_EVENT = "sambee:recent-files-changed";

const RECENT_FILES_CHANNEL_NAME = "sambee-recent-files";
const RECENT_FILES_UPDATED_MESSAGE_TYPE = "recent-files-updated";
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(RECENT_FILES_CHANNEL_NAME);

channel?.addEventListener("message", (event: MessageEvent<{ type?: unknown }>) => {
  if (event.data?.type === RECENT_FILES_UPDATED_MESSAGE_TYPE) {
    window.dispatchEvent(new Event(RECENT_FILES_CHANGED_EVENT));
  }
});

export function publishRecentFilesChanged(): void {
  window.dispatchEvent(new Event(RECENT_FILES_CHANGED_EVENT));
  channel?.postMessage({ type: RECENT_FILES_UPDATED_MESSAGE_TYPE });
}
