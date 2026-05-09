+++
title = "Companion Support Reference"
+++

## Preference Files

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\app.sambee.companion\` |
| macOS | `~/Library/Application Support/app.sambee.companion/` |
| Linux | `~/.local/share/app.sambee.companion/` |

Deleting `user-preferences.json` and `app-preferences.json` resets companion settings.

## Log Files

| Platform | Location |
|---|---|
| Windows | `%LOCALAPPDATA%\Sambee\Companion\logs\sambee-companion.log` |
| macOS | `~/Library/Application Support/app.sambee.companion/logs/sambee-companion.log` |
| Linux | `~/.local/share/sambee-companion/logs/sambee-companion.log` |

The companion writes both Rust-backend messages and TypeScript-frontend messages into the same rotating log file.

## Log Levels

| Level | When captured | Typical use |
|---|---|---|
| `error` | Always | failures that stop an operation from completing |
| `warn` | Always | degraded but non-fatal behavior |
| `info` | Verbose mode only | lifecycle steps and state transitions |
| `debug` | Verbose mode only | detailed diagnostic context |

Errors and warnings are always written, even when verbose logging is off. That keeps production incidents diagnosable without requiring the user to reproduce them in a special logging mode.

## Verbose Logging Controls

Verbose logging is read once at startup, so restart the companion after changing it.

### Windows Registry Value

Set `VerboseLogging` to `1` under:

```text
HKEY_CURRENT_USER\Software\Sambee\Companion
```

Command-line example:

```cmd
reg add "HKCU\Software\Sambee\Companion" /v VerboseLogging /t REG_DWORD /d 1 /f
```

To disable it again:

```cmd
reg add "HKCU\Software\Sambee\Companion" /v VerboseLogging /t REG_DWORD /d 0 /f
```

### Environment Variable

On any platform, you can also launch the companion with:

```bash
SAMBEE_LOG_VERBOSE=1 ./sambee-companion
```

The environment variable takes priority over the Windows registry setting and is the simplest one-off debugging option across platforms.

Use verbose logging when the normal log file does not explain why startup, local-drive access, or file-return workflows are failing.

## Log Rotation

The companion rotates logs automatically to avoid unbounded disk growth.

- Maximum file size: 5 MB per log file.
- Maximum files: 3 total, including the active file.
- Worst-case disk usage: About 15 MB.

Rotation uses the usual numbered-copy scheme: the active `.log` becomes `.log.1`, the previous `.log.1` becomes `.log.2`, and the oldest rotated file is removed.

## Log Format

Each line follows this structure:

```text
YYYY-MM-DDThh:mm:ss.mmmZ LEVEL [module] message
```

Example:

```text
2026-02-17T14:30:45.123Z INFO  [sambee_companion_lib] Step 1: Exchanging URI token...
2026-02-17T14:30:45.456Z ERROR [frontend] Upload failed: network timeout
2026-02-17T14:30:46.789Z WARN  [sambee_companion_lib::commands::upload] Upload attempt 1/3 failed: connection refused
```

Frontend messages use the module target `frontend` so you can distinguish browser-side UI logging from Rust-side command and backend behavior.

## How Logging Reaches the File

The companion uses one unified file-log pipeline.

### Rust Side

The Rust logging module in `companion/src-tauri/src/logging.rs` implements the `log::Log` trait. Existing Rust-side `info!()`, `warn!()`, `error!()`, and `debug!()` calls therefore write into the same rotating companion log file.

If file logging initialization fails, the app falls back to stderr logging so startup can still proceed and terminal-launched sessions still have diagnostic output.

### Frontend Side

The frontend logger in `companion/src/lib/logger.ts` writes to both:

- The browser console for local developer-tools visibility.
- The Rust backend through the `log_from_frontend` Tauri command so the same message lands in the file log.

That means support logs can contain both frontend and backend events in one timeline.

The frontend logger is fire-and-forget. Logging should never block the UI or surface a user-facing error because the log write itself failed.

## Windows Webview2 Runtime Data

On Windows, the embedded WebView2 runtime stores its data at:

- `%LOCALAPPDATA%\app.sambee.companion\EBWebView\`

This directory is runtime-managed and is recreated automatically if removed.
