export interface ServerWebSocketLocation {
  protocol: string;
  hostname: string;
  port: string;
}

/**
 * Build the authenticated server WebSocket URL used by the browser file view.
 *
 * In development the backend always listens on port 8000, while production
 * uses the current page port. The browser WebSocket API cannot set auth
 * headers, so the bearer token is passed as a query parameter.
 */
export function buildServerWebSocketUrl(location: ServerWebSocketLocation, accessToken: string | null): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const isDevelopment = location.port === "3000" || location.hostname === "localhost";
  const port = isDevelopment ? "8000" : location.port;
  const baseUrl = port ? `${protocol}//${location.hostname}:${port}/api/ws` : `${protocol}//${location.hostname}/api/ws`;

  return accessToken ? `${baseUrl}?token=${encodeURIComponent(accessToken)}` : baseUrl;
}
