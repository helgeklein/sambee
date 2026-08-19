interface HistorySyncConfig {
  eventName: string;
  channelName: string;
  messageType: string;
}

export function createHistorySync({ eventName, channelName, messageType }: HistorySyncConfig): () => void {
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName);

  channel?.addEventListener("message", (event: MessageEvent<{ type?: unknown }>) => {
    if (event.data?.type === messageType) {
      window.dispatchEvent(new Event(eventName));
    }
  });

  return () => {
    window.dispatchEvent(new Event(eventName));
    channel?.postMessage({ type: messageType });
  };
}
