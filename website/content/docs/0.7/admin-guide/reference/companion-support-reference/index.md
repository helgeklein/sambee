+++
title = "Companion Support Reference"
description = "Look up companion logs, preferences, crash-diagnostic entry points, verbose logging controls, and Windows WebView2 runtime-data paths."
+++

This page is stable lookup material for administrators supporting escalated Sambee Companion issues.

Use it when you already know the issue has moved past normal end-user setup and you need support-oriented locations or runtime details.

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

## Crash And Launch Diagnostics

When the companion fails before normal workflow logging is enough, start with the platform-native diagnostics:

- Windows: Event Viewer
- macOS: Console.app crash reports
- Linux: launch `sambee-companion` from a terminal to watch log output directly

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

## Windows WebView2 Runtime Data

On Windows, the embedded WebView2 runtime stores its data at:

- `%LOCALAPPDATA%\app.sambee.companion\EBWebView\`

This directory is runtime-managed and is recreated automatically if removed.

## Related Pages

- [Support Companion-App Escalation](../../user-support-and-escalation/support-companion-app-escalation/): use this when deciding whether the issue belongs in admin support at all
- [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this when the problem is actually broader than a companion-only support incident
