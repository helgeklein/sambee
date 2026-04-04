import type { ClientRequest, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createLogger, defineConfig } from "vite";

const FRONTEND_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(FRONTEND_DIR, "..");
const BACKEND_PROXY_TARGET = "http://localhost:8000";
const BACKEND_PROXY_TIMEOUT_MS = 60_000;
const TRANSIENT_PROXY_ERROR_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE"]);
const TRANSIENT_PROXY_ERROR_MESSAGES = ["socket hang up", "aborted", "upstream prematurely closed connection"];
const OPTIMIZE_DEPS_ENTRIES = [
  "index.html",
  "src/**/*.{ts,tsx}",
  "!src/**/*.test.{ts,tsx}",
  "!src/**/*.spec.{ts,tsx}",
  "!src/**/__tests__/**",
  "!src/**/__mocks__/**",
  "!src/test/**",
];

interface ProxyErrorLike {
  code?: unknown;
  message?: unknown;
}

interface EndableResponseLike {
  end: () => void;
}

function getProxyErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as ProxyErrorLike).code;
  return typeof code === "string" ? code : null;
}

function getProxyErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return "";
  }

  const message = (error as ProxyErrorLike).message;
  return typeof message === "string" ? message : "";
}

function isTransientProxyError(error: unknown): boolean {
  const code = getProxyErrorCode(error);
  if (code && TRANSIENT_PROXY_ERROR_CODES.has(code)) {
    return true;
  }

  const message = getProxyErrorMessage(error).toLowerCase();
  return TRANSIENT_PROXY_ERROR_MESSAGES.some((token) => message.includes(token));
}

function isServerResponse(value: unknown): value is ServerResponse {
  return typeof value === "object" && value !== null && "req" in value;
}

function isEndableResponse(value: unknown): value is EndableResponseLike {
  return typeof value === "object" && value !== null && "end" in value && typeof value.end === "function";
}

const baseLogger = createLogger();

function readWorkspaceBuildValue(fileName: string, fallback: string): string {
  try {
    const value = readFileSync(resolve(WORKSPACE_ROOT, fileName), "utf8").trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

const SAMBEE_VERSION = readWorkspaceBuildValue("VERSION", "unknown");
const SAMBEE_GIT_COMMIT = readWorkspaceBuildValue("GIT_COMMIT", "unknown");

// https://vite.dev/config/
export default defineConfig({
  customLogger: baseLogger,
  define: {
    __SAMBEE_VERSION__: JSON.stringify(SAMBEE_VERSION),
    __SAMBEE_GIT_COMMIT__: JSON.stringify(SAMBEE_GIT_COMMIT),
  },
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    proxy: {
      "/api": {
        target: BACKEND_PROXY_TARGET,
        changeOrigin: true,
        timeout: BACKEND_PROXY_TIMEOUT_MS,
        proxyTimeout: BACKEND_PROXY_TIMEOUT_MS,
        configure(proxy) {
          queueMicrotask(() => {
            proxy.removeAllListeners("error");
            proxy.on("error", (error, ...args: unknown[]) => {
              const response = args[1];

              if (!isTransientProxyError(error)) {
                if (isServerResponse(response)) {
                  const requestUrl = response.req.url ?? "unknown request";
                  baseLogger.error(`http proxy error: ${requestUrl}\n${(error as Error).stack ?? String(error)}`, {
                    timestamp: true,
                    error: error as Error,
                  });
                } else {
                  baseLogger.error(`ws proxy error:\n${(error as Error).stack ?? String(error)}`, {
                    timestamp: true,
                    error: error as Error,
                  });
                }
              }

              if (isServerResponse(response)) {
                if (!response.headersSent && !response.writableEnded) {
                  response.writeHead(502, {
                    "Content-Type": "text/plain",
                  });
                }

                if (!response.writableEnded) {
                  response.end();
                }
                return;
              }

              if (isEndableResponse(response)) {
                response.end();
              }
            });
          });

          proxy.on("proxyReq", (proxyReq: ClientRequest, req: IncomingMessage, res: ServerResponse) => {
            const abortProxyRequest = () => {
              if (!proxyReq.destroyed) {
                proxyReq.destroy();
              }
            };

            req.once("aborted", abortProxyRequest);
            res.once("close", () => {
              if (!res.writableEnded) {
                abortProxyRequest();
              }
            });
          });
        },
      },
    },
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    // Crawl lazy-loaded route modules during startup so navigation does not
    // trigger mid-session dependency re-optimization and a forced client reload.
    // Exclude test-only files so browser startup does not prebundle Node-only
    // dependencies pulled in by the Vitest MSW server.
    entries: OPTIMIZE_DEPS_ENTRIES,
    include: ["yet-another-react-lightbox", "yet-another-react-lightbox/plugins/zoom"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Avoid forcing React and MUI into separate chunks because their
          // runtime linkage can create circular chunks in production builds.
          if (id.includes("react-markdown") || id.includes("remark-gfm") || id.includes("rehype-highlight")) {
            return "markdown";
          }

          if (id.includes("react-pdf")) {
            return "pdf";
          }

          return undefined;
        },
      },
    },
  },
});
