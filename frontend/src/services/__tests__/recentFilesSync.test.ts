import { beforeEach, describe, expect, it, vi } from "vitest";

const { getHistoryChannel, getHistoryMessageHandler } = vi.hoisted(() => {
  const historyChannels = new Map<string, MockBroadcastChannel>();
  const historyMessageHandlers = new Map<string, (event: MessageEvent<{ type?: unknown }>) => void>();

  class MockBroadcastChannel {
    addEventListener = vi.fn((eventName: string, listener: (event: MessageEvent<{ type?: unknown }>) => void) => {
      if (eventName === "message") {
        historyMessageHandlers.set(this.name, listener);
      }
    });
    postMessage = vi.fn();

    constructor(readonly name: string) {
      historyChannels.set(name, this);
    }
  }

  vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
  return {
    getHistoryChannel: (name: string) => historyChannels.get(name),
    getHistoryMessageHandler: (name: string) => historyMessageHandlers.get(name),
  };
});

import { publishRecentDirectoriesChanged, RECENT_DIRECTORIES_CHANGED_EVENT } from "../recentDirectoriesSync";
import { publishRecentFilesChanged, RECENT_FILES_CHANGED_EVENT } from "../recentFilesSync";

describe("history synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      eventName: RECENT_FILES_CHANGED_EVENT,
      channelName: "sambee-recent-files",
      messageType: "recent-files-updated",
      publish: publishRecentFilesChanged,
    },
    {
      eventName: RECENT_DIRECTORIES_CHANGED_EVENT,
      channelName: "sambee-recent-directories",
      messageType: "recent-directories-updated",
      publish: publishRecentDirectoriesChanged,
    },
  ])(
    "notifies the current tab and broadcasts successful history changes for $channelName",
    ({ eventName, channelName, messageType, publish }) => {
      const listener = vi.fn();
      window.addEventListener(eventName, listener);

      publish();

      expect(listener).toHaveBeenCalledOnce();
      expect(getHistoryChannel(channelName)?.postMessage).toHaveBeenCalledWith({ type: messageType });
      window.removeEventListener(eventName, listener);
    }
  );

  it.each([
    {
      eventName: RECENT_FILES_CHANGED_EVENT,
      channelName: "sambee-recent-files",
      messageType: "recent-files-updated",
    },
    {
      eventName: RECENT_DIRECTORIES_CHANGED_EVENT,
      channelName: "sambee-recent-directories",
      messageType: "recent-directories-updated",
    },
  ])("forwards history changes received from another tab for $channelName", ({ eventName, channelName, messageType }) => {
    const listener = vi.fn();
    window.addEventListener(eventName, listener);

    getHistoryMessageHandler(channelName)?.({ data: { type: messageType } } as MessageEvent<{ type?: unknown }>);

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(eventName, listener);
  });
});
