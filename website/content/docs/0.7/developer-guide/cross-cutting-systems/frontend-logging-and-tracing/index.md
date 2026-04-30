+++
title = "Frontend Logging And Tracing"
description = "Understand how one browser-app log call can drive both local console output and optional backend trace collection."
+++

The browser app has one shared logging API, but it can feed two different diagnostic surfaces.

- browser-console output for local development and interactive debugging
- backend trace collection for support workflows and cases where direct console access is unavailable

That split matters because a small frontend logging change can improve one surface while degrading the other.

## Main Implementation Files

| File | Role |
|---|---|
| `frontend/src/services/logger.ts` | shared logging entry point and backend-tracing orchestration |
| `frontend/src/services/loggingConfig.ts` | fetches and caches server logging config |
| `frontend/src/services/logBuffer.ts` | buffers trace events before flush |
| `frontend/src/services/logTransport.ts` | sends trace batches to `/api/logs/mobile` |
| `frontend/src/pages/Login.tsx` and `frontend/src/pages/FileBrowser.tsx` | initialize tracing after authenticated app startup |

## Runtime Flow

1. the authenticated browser app calls `logger.initializeBackendTracing()`
2. the logger loads config through `loggingConfig.getConfig()`
3. console logging level is updated from backend config when enabled
4. backend tracing is enabled only when the server config allows it
5. each logger call writes to the console if its level passes the console threshold
6. the same call asynchronously checks trace level and component filters before buffering a backend trace entry
7. the buffer flushes by size or interval and posts the batch to `/api/logs/mobile`

The log call is the single source of truth. Contributors should not have to choose between console visibility and trace collection by using different APIs.

## Configuration Model

The frontend pulls logging state from the backend rather than hard-coding it in the browser app.

- `logging_enabled` and `logging_level` control console output
- `tracing_enabled`, `tracing_level`, and `tracing_components` control backend trace collection
- `loggingConfig` caches the fetched config in `localStorage` for five minutes to avoid repeated requests

The logger also keeps different local defaults before server config is loaded.

- development builds default to verbose console logging
- production builds default to warnings and errors
- test runs skip backend tracing setup entirely

## Buffering And Transport

Backend tracing is buffered on purpose.

- `LogBuffer` groups trace entries in memory instead of posting every log call immediately
- each batch carries a generated session ID plus device information such as user agent, screen size, and touch capability
- the default flush behavior is size-based or time-based, whichever happens first
- failed flushes keep the buffered entries for retry on the next flush attempt

This design keeps routine logging cheap while still giving the backend enough session context to debug real field problems.

## Contributor Rules

- use the shared logger instead of scattering long-lived `console.*` calls through components and hooks
- pass a component tag when backend trace filtering matters to the workflow you are changing
- do not assume a visible console message also means backend tracing is enabled for that session
- keep structured context specific and actionable instead of dumping large objects or noisy state snapshots
- do not move tracing initialization earlier than authenticated startup without checking token and request-path assumptions

## Common Failure Modes

- adding raw console logs that never reach backend trace collection
- expecting a server-side logging-config change to apply instantly while a cached config is still valid
- using inconsistent component names that make trace filtering unreliable
- adding high-volume debug logs that drown out the actionable events
- treating trace transport failures as if they were equivalent to application failures

## Validation Expectations

When this area changes, usually run:

```bash
cd frontend && npx tsc --noEmit
cd frontend && npm run lint
```

Add or update targeted frontend tests when the change affects config caching, filtering behavior, startup initialization, or log transport. The service tests under `frontend/src/services/__tests__/` are usually the right place for that coverage.

## Related Pages

- [Logging And Localization](../logging-and-localization/): keep the broader cross-boundary logging rules in view
- [Frontend Overview](../../frontend-architecture/frontend-overview/): place the logging pipeline in the wider browser-app architecture
- [Test Strategy Overview](../../testing-and-quality-gates/test-strategy-overview/): choose validation depth based on real regression risk
