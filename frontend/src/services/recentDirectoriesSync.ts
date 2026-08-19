import { createHistorySync } from "./historySync";

export const RECENT_DIRECTORIES_CHANGED_EVENT = "sambee:recent-directories-changed";

const RECENT_DIRECTORIES_CHANNEL_NAME = "sambee-recent-directories";
const RECENT_DIRECTORIES_UPDATED_MESSAGE_TYPE = "recent-directories-updated";

export const publishRecentDirectoriesChanged = createHistorySync({
  eventName: RECENT_DIRECTORIES_CHANGED_EVENT,
  channelName: RECENT_DIRECTORIES_CHANNEL_NAME,
  messageType: RECENT_DIRECTORIES_UPDATED_MESSAGE_TYPE,
});
