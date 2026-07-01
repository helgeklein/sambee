export interface ServerWebSocketLocation {
  protocol: string;
  hostname: string;
  port: string;
}

/**
 * Build the authenticated server WebSocket URL used by the browser file view.
 *
 * Uses the current page origin so dev and production follow the same browser
 * networking path. The browser WebSocket API cannot set auth headers, so the
 * bearer token is passed as a query parameter.
 */
export function buildServerWebSocketUrl(location: ServerWebSocketLocation, accessToken: string | null): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const baseUrl = location.port ? `${protocol}//${location.hostname}:${location.port}/api/ws` : `${protocol}//${location.hostname}/api/ws`;

  return accessToken ? `${baseUrl}?token=${encodeURIComponent(accessToken)}` : baseUrl;
}
