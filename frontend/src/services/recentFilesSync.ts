import { createHistorySync } from "./historySync";

export const RECENT_FILES_CHANGED_EVENT = "sambee:recent-files-changed";

const RECENT_FILES_CHANNEL_NAME = "sambee-recent-files";
const RECENT_FILES_UPDATED_MESSAGE_TYPE = "recent-files-updated";

export const publishRecentFilesChanged = createHistorySync({
  eventName: RECENT_FILES_CHANGED_EVENT,
  channelName: RECENT_FILES_CHANNEL_NAME,
  messageType: RECENT_FILES_UPDATED_MESSAGE_TYPE,
});
