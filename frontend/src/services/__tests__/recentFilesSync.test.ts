import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRecentFilesChannel, getRecentFilesMessageHandler } = vi.hoisted(() => {
  let recentFilesChannel: MockBroadcastChannel | null = null;
  let recentFilesMessageHandler: ((event: MessageEvent<{ type?: unknown }>) => void) | null = null;

  class MockBroadcastChannel {
    addEventListener = vi.fn((eventName: string, listener: (event: MessageEvent<{ type?: unknown }>) => void) => {
      if (eventName === "message") {
        recentFilesMessageHandler = listener;
      }
    });
    postMessage = vi.fn();

    constructor(name: string) {
      if (name === "sambee-recent-files") {
        recentFilesChannel = this;
      }
    }
  }

  vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
  return {
    getRecentFilesChannel: () => recentFilesChannel,
    getRecentFilesMessageHandler: () => recentFilesMessageHandler,
  };
});

import { publishRecentFilesChanged, RECENT_FILES_CHANGED_EVENT } from "../recentFilesSync";

describe("recentFilesSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("notifies the current tab and broadcasts successful history changes", () => {
    const listener = vi.fn();
    window.addEventListener(RECENT_FILES_CHANGED_EVENT, listener);

    publishRecentFilesChanged();

    expect(listener).toHaveBeenCalledOnce();
    expect(getRecentFilesChannel()?.postMessage).toHaveBeenCalledWith({ type: "recent-files-updated" });
    window.removeEventListener(RECENT_FILES_CHANGED_EVENT, listener);
  });

  it("forwards a history change received from another tab", () => {
    const listener = vi.fn();
    window.addEventListener(RECENT_FILES_CHANGED_EVENT, listener);

    getRecentFilesMessageHandler()?.({ data: { type: "recent-files-updated" } } as MessageEvent<{ type?: unknown }>);

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(RECENT_FILES_CHANGED_EVENT, listener);
  });
});
