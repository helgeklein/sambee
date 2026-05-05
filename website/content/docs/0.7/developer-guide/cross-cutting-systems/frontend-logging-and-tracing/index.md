+++
title = "Frontend Logging and Tracing"
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
| `backend/app/api/logs.py` | serves frontend logging config and accepts uploaded trace batches |
| `backend/app/services/log_manager.py` | writes trace batches to JSONL files and cleans up retained logs |
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
- `frontend_tracing_username_regex` on the backend can disable tracing for users who do not match the configured pattern
- `loggingConfig` caches the fetched config in `localStorage` for five minutes to avoid repeated requests

The logger also keeps different local defaults before server config is loaded.

- development builds default to verbose console logging
- production builds default to warnings and errors
- test runs skip backend tracing setup entirely

The current backend contract is exposed through `GET /api/logs/config` and returns:

- `logging_enabled`
- `logging_level`
- `tracing_enabled`
- `tracing_level`
- `tracing_components`

`loggingConfig` then adds a client-side timestamp when caching the response locally.

### Level and Component Filtering

Console logging and backend tracing are independent.

- console output is gated only by `logging_enabled` plus the effective console level
- backend tracing is gated by `tracing_enabled`, `tracing_level`, and optional component matching
- an empty `tracing_components` list means all components are accepted
- component matching is exact string matching, so inconsistent tag names reduce the usefulness of filtered tracing quickly

Level filtering is threshold-based.

- `DEBUG` allows everything
- `INFO` suppresses only `DEBUG`
- `WARNING` allows `WARNING` and `ERROR`
- `ERROR` allows only `ERROR`

## Buffering and Transport

Backend tracing is buffered on purpose.

- `LogBuffer` groups trace entries in memory instead of posting every log call immediately
- each batch carries a generated session ID plus device information such as user agent, screen size, and touch capability
- the default flush behavior is size-based or time-based, whichever happens first
- failed flushes keep the buffered entries for retry on the next flush attempt

The current implementation details are worth preserving:

- `LogBuffer` generates one session ID for the browser runtime that enabled tracing
- the batch payload includes `userAgent`, screen size, `devicePixelRatio`, platform, and touch capability
- `LogTransport` uses `fetch` directly instead of the shared API service to avoid circular dependencies in the logging stack
- trace uploads include the bearer token when one is available
- if repeated flush failures push the in-memory buffer above twice the configured size, the oldest entries are dropped to cap memory growth

This design keeps routine logging cheap while still giving the backend enough session context to debug real field problems.

### Backend Receipt and Storage

The backend logging API is simple and file-backed.

- `POST /api/logs/mobile` accepts a trace batch for the authenticated user
- `GET /api/logs/config` serves the frontend logging configuration
- `GET /api/logs/list` lists available uploaded mobile-log files
- `GET /api/logs/download/{filename}` downloads a stored log file

Uploaded trace batches are written under `data/mobile_logs/` as JSONL files.

- the first line is metadata, including session ID, device info, server timestamp, and request metadata such as client IP or user agent
- subsequent lines are individual log entries
- retention cleanup is handled by `MobileLogManager.cleanup_old_logs()` using the configured retention window

This is why frontend logging changes can affect both browser behavior and support-facing backend artifacts.

## Component Tags and Taxonomy

Component tags are optional for console output but important for backend tracing.

Representative tags currently used in the frontend include:

- `api`
- `auth`
- `backend-recovery`
- `browser`
- `browser-perf`
- `companion`
- `config`
- `directory-search-provider`
- `file-browser`
- `viewer`
- `websocket`

These tags are not just naming style. They are the filter vocabulary for targeted trace collection.

Contributors should:

- reuse an existing tag when the log belongs to an established subsystem
- add a new tag only when it introduces a real new filter boundary
- keep names stable once they appear in backend config or support playbooks

One log call still drives both surfaces. The component tag only changes backend-tracing selection behavior.

## Error Context and Safety Rules

`logger.error()` enriches the provided context when an `Error` object is passed.

- `error.message`
- `error.stack`
- `error.name`

That gives support traces more useful failure context without forcing every caller to serialize errors manually.

Contributors still need to be selective.

- include actionable IDs, paths, counts, durations, or status values
- avoid passwords, tokens, private payloads, or large opaque objects
- avoid high-volume logs inside tight loops or animation-heavy code paths

## Contributor Rules

- use the shared logger instead of scattering long-lived `console.*` calls through components and hooks
- pass a component tag when backend trace filtering matters to the workflow you are changing
- do not assume a visible console message also means backend tracing is enabled for that session
- keep structured context specific and actionable instead of dumping large objects or noisy state snapshots
- do not move tracing initialization earlier than authenticated startup without checking token and request-path assumptions

The supported call shape is:

- `logger.debug(message, context?, component?)`
- `logger.info(message, context?, component?)`
- `logger.warn(message, context?, component?)`
- `logger.error(message, context?, component?, error?)`

Parameter order matters. If a component tag is needed, it is the third argument for non-error calls and still the third argument for `logger.error()` before the optional `Error` object.

The older dedicated trace-only helpers are gone. Shared logger calls are the canonical path.

## Test and Runtime Nuances

The logger deliberately behaves differently in tests.

- test detection suppresses console output
- backend tracing initialization is skipped in test environments
- `loggingConfig` falls back to a disabled state when config loading fails

This is intentional defensive behavior, not a missing feature. It keeps tests quieter and prevents trace setup from leaking across environments.

## Common Failure Modes

- adding raw console logs that never reach backend trace collection
- expecting a server-side logging-config change to apply instantly while a cached config is still valid
- using inconsistent component names that make trace filtering unreliable
- adding high-volume debug logs that drown out the actionable events
- treating trace transport failures as if they were equivalent to application failures

Other common mistakes include:

- assuming the mobile-log download endpoint is `/api/logs/{filename}` instead of the current `/api/logs/download/{filename}` route
- documenting stale field names such as `enabled` or `log_level` instead of the current `logging_*` and `tracing_*` contract
- swapping the logger parameter order and accidentally passing the component tag as context

## Validation Expectations

When this area changes, usually run:

```bash
cd frontend && npx tsc --noEmit
cd frontend && npm run lint
```

Add or update targeted frontend tests when the change affects config caching, filtering behavior, startup initialization, or log transport.

The current targeted suites already cover the most important contracts:

- `frontend/src/services/__tests__/loggingConfig.test.ts` for config shape, threshold logic, and disabled-state behavior
- `frontend/src/services/__tests__/mobileLoggingApi.test.ts` for the mobile-log API payload and response contract

If the change touches backend receipt, storage, or filename behavior, pair the frontend checks with the relevant backend tests around `backend/app/api/logs.py` and `backend/tests/test_logging_config.py`.

## Related Pages

- [Logging and Localization](../logging-and-localization/): keep the broader cross-boundary logging rules in view
- [Frontend Overview](../../frontend-architecture/frontend-overview/): place the logging pipeline in the wider browser-app architecture
- [Test Strategy Overview](../../testing-and-quality-gates/test-strategy-overview/): choose validation depth based on real regression risk
