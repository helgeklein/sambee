import { describe, expect, it } from "vitest";

import { buildServerWebSocketUrl } from "../../services/serverWebsocket";

describe("Server WebSocket URL", () => {
  it("uses the backend dev port and includes the auth token", () => {
    const wsUrl = buildServerWebSocketUrl(
      {
        protocol: "http:",
        hostname: "localhost",
        port: "3000",
      },
      "mock-token"
    );

    expect(wsUrl).toBe("ws://localhost:8000/api/ws?token=mock-token");
  });

  it("uses the current production port when present", () => {
    const wsUrl = buildServerWebSocketUrl(
      {
        protocol: "https:",
        hostname: "sambee.example",
        port: "8443",
      },
      "secure-token"
    );

    expect(wsUrl).toBe("wss://sambee.example:8443/api/ws?token=secure-token");
  });

  it("omits the port when the page origin has none", () => {
    const wsUrl = buildServerWebSocketUrl(
      {
        protocol: "https:",
        hostname: "sambee.example",
        port: "",
      },
      "prod-token"
    );

    expect(wsUrl).toBe("wss://sambee.example/api/ws?token=prod-token");
  });

  it("omits the token query parameter when no token is available", () => {
    const wsUrl = buildServerWebSocketUrl(
      {
        protocol: "http:",
        hostname: "files.internal",
        port: "8080",
      },
      null
    );

    expect(wsUrl).toBe("ws://files.internal:8080/api/ws");
  });

  it("URL-encodes tokens before placing them in the query string", () => {
    const wsUrl = buildServerWebSocketUrl(
      {
        protocol: "http:",
        hostname: "localhost",
        port: "3000",
      },
      "token with spaces/+?"
    );

    expect(wsUrl).toBe("ws://localhost:8000/api/ws?token=token%20with%20spaces%2F%2B%3F");
  });
});
