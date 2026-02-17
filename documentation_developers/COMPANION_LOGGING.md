# Companion App Logging

The Sambee Companion uses a unified logging system that writes structured log messages from both the Rust backend and the TypeScript frontend into a single rotating log file.

## Log Location

| Platform | Path |
|----------|------|
| **Windows** | `%LOCALAPPDATA%\Sambee\Companion\logs\sambee-companion.log` |
| **Linux** | `~/.local/share/sambee-companion/logs/sambee-companion.log` |
| **macOS** | `~/Library/Application Support/app.sambee.companion/logs/sambee-companion.log` |

## Log Levels

| Level | When captured | Typical use |
|-------|---------------|-------------|
| `error` | Always | Failures that prevent an operation from completing |
| `warn` | Always | Non-fatal issues, degraded behavior |
| `info` | Verbose mode only | Lifecycle steps, state transitions |
| `debug` | Verbose mode only | Detailed diagnostic data |

Errors and warnings are **always** written to the log file regardless of the verbose setting, ensuring that production issues can be diagnosed. Info and debug messages require verbose mode to be enabled.

## Enabling Verbose Logging

Verbose logging is read once at startup. After changing the setting, restart the companion.

### Windows — Registry Value

Set the DWORD value `VerboseLogging` to `1` under:

```
HKEY_CURRENT_USER\Software\Sambee\Companion
```

To set it from the command line:

```cmd
reg add "HKCU\Software\Sambee\Companion" /v VerboseLogging /t REG_DWORD /d 1 /f
```

To disable:

```cmd
reg add "HKCU\Software\Sambee\Companion" /v VerboseLogging /t REG_DWORD /d 0 /f
```

### All Platforms — Environment Variable

Set `SAMBEE_LOG_VERBOSE=1` before launching the companion:

```bash
SAMBEE_LOG_VERBOSE=1 ./sambee-companion
```

The environment variable takes priority and works on all platforms, making it useful for development and one-off debugging sessions.

## Log Rotation

Log files are automatically rotated to prevent disk flooding:

- **Max file size**: 5 MB per log file
- **Max files**: 3 (current + 2 rotated copies)
- **Max disk usage**: 15 MB (worst case)

Rotation scheme: when the active log exceeds 5 MB, it is renamed to `.log.1`, the previous `.log.1` becomes `.log.2`, and `.log.2` is deleted. A fresh `.log` is then opened.

## Log Format

Each line follows this format:

```
YYYY-MM-DDThh:mm:ss.mmmZ LEVEL [module] message
```

Example:

```
2026-02-17T14:30:45.123Z INFO  [sambee_companion_lib] Step 1: Exchanging URI token...
2026-02-17T14:30:45.456Z ERROR [frontend] Upload failed: network timeout
2026-02-17T14:30:46.789Z WARN  [sambee_companion_lib::commands::upload] Upload attempt 1/3 failed: connection refused
```

Frontend messages use the module target `frontend` to distinguish them from Rust-side messages.

## Architecture

### Rust Side

The logging module ([companion/src-tauri/src/logging.rs](../companion/src-tauri/src/logging.rs)) implements the `log::Log` trait, replacing `env_logger`. All existing `info!()`, `warn!()`, `error!()`, and `debug!()` macros throughout the Rust codebase automatically write to the log file.

If file logging initialization fails (e.g., permissions issue), the system falls back to `env_logger` (stderr) so the application can still start.

### Frontend Side

The logger module ([companion/src/lib/logger.ts](../companion/src/lib/logger.ts)) exports a `log` object with `error()`, `warn()`, `info()`, and `debug()` methods. Each method:

1. Writes to the browser console (for dev tools visibility)
2. Sends the message to the Rust backend via the `log_from_frontend` Tauri command

Usage:

```typescript
import { log } from "./lib/logger";

log.error("Upload failed", error);
log.warn("Theme decode issue");
log.info("Update available: v2.1");
log.debug("Polling file status...");
```

The `log_from_frontend` command is fire-and-forget — logging never blocks the UI or throws exceptions.
