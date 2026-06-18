+++
title = "Common Task Commands"
+++

Prefer the committed scripts and workspace tasks over improvised one-off commands.

## Daily Entry Points

| Goal | Preferred command or task |
|---|---|
| Start backend dev server | VS Code task `Backend: Start Dev Server` or `./scripts/start-backend` |
| Start frontend dev server | VS Code task `Frontend: Start Dev Server` or `./scripts/start-frontend` |
| Start both local dev servers together | `./scripts/dev-start` |
| Stop local dev servers together | `./scripts/dev-stop` |
| Inspect local dev logs | `./scripts/logs` |
| Run fast repo tests | `./scripts/test` |
| Run repo tests with coverage | `COVERAGE=1 ./scripts/test` |

`./scripts/test` now includes the companion Windows GNU target compatibility check when the local toolchain is available.
In the devcontainer, that toolchain is preinstalled as part of the image build.

## Backend Commands

Use these when you are changing backend behavior, API contracts, or SMB handling.

```bash
cd backend && pytest -v
cd backend && mypy app
```

Useful related task:

- VS Code task `Backend: Run Tests`
- VS Code task `Backend: Type Check (mypy)`

## Frontend Commands

Use these when the browser UI, routing, services, or typed frontend behavior changes.

```bash
cd frontend && npm test
cd frontend && npx tsc --noEmit
cd frontend && npm run lint
```

Useful related task:

- VS Code task `Frontend: Run Tests`
- VS Code task `Frontend: Type Check + Lint`

## Companion Commands

Use these when local-drive access, native-app editing, or Tauri-side behavior changes.

```bash
cd companion && npm run lint
cd companion && npx tsc --noEmit
cd companion && npm run check:rust:windows
cd companion/src-tauri && cargo test
```

Use `npm run check:rust:windows` as a local Windows-target compatibility check.
It runs `cargo check` for `x86_64-pc-windows-gnu` from Linux and is intended to catch cross-target breakage early without replacing the real Windows release build.

Useful related task:

- VS Code task `Companion: Run Rust Tests`
- VS Code task `Companion: Validation Suite`

The committed devcontainer image now includes:

- the Rust target `x86_64-pc-windows-gnu`
- the MinGW toolchain package `gcc-mingw-w64-x86-64`

That means a rebuilt devcontainer can run the companion Windows GNU cross-check without extra manual setup.

## Local Dev Logs and Service Control

Use the committed helper scripts first when you are diagnosing the supported local development workflow.

### Combined Dev Server Control

These scripts manage the local backend and frontend together:

```bash
./scripts/dev-start
./scripts/dev-stop
./scripts/dev-stop && ./scripts/dev-start
```

Use those entry points when you want the repo's own startup logging and local log-file layout instead of ad hoc process control.

### Log Inspection

The supported local log viewer is:

```bash
./scripts/logs
./scripts/logs -f
./scripts/logs -n 200
```

That script summarizes service status and tails the main local development log files.

The current local log files are:

- `/tmp/backend.log`
- `/tmp/frontend.log`
- `/tmp/dev-start.log`
- `/tmp/post-start.log`

You can inspect individual files directly when needed:

```bash
tail -f /tmp/backend.log
tail -f /tmp/frontend.log
tail -f /tmp/dev-start.log
tail -f /tmp/post-start.log
```

### Search and Status Checks

When the helper scripts are not enough, targeted shell checks are still useful.

```bash
pgrep -f "uvicorn.*app.main:app"
pgrep -f "vite"
lsof -i :3000,8000
grep -i error /tmp/*.log
grep -i warning /tmp/*.log
grep -i smb /tmp/backend.log
grep -E "\([0-9]{4,}\.[0-9]+ms\)" /tmp/backend.log
```

Treat these as diagnostics for the local development environment, not as the primary supported control surface.

Be especially careful with broad `pkill -f vite`-style commands in a workspace that can also run website or companion dev servers.

### Rotating and Clearing Local Logs

When local logs become noisy, use the committed rotation script first:

```bash
./scripts/rotate-logs
```

That script archives current `/tmp/*.log` files into `/tmp/logs-archive/` and truncates the live files in place so active writers keep working.

To inspect archived logs:

```bash
ls -lh /tmp/logs-archive/
```

Manual truncation is still possible for local development, but it is a deliberately destructive cleanup step:

```bash
> /tmp/backend.log
> /tmp/frontend.log
> /tmp/dev-start.log
> /tmp/post-start.log
```

Use that only when you intentionally want to discard the current local log history.

### Practical Local Triage Order

For the supported dev workflow, a reasonable first pass is:

1. run `./scripts/logs`
2. verify the expected dev processes or ports if the summary looks wrong
3. search `/tmp/*.log` for the concrete failure signal
4. restart with `./scripts/dev-stop && ./scripts/dev-start` if the issue is clearly local-process state rather than a code defect

## Version Sync

When you change `VERSION`, run the sync script and review all resulting metadata changes together.

```bash
./scripts/sync-version
```

That workflow updates the frontend and companion package metadata and related version-bearing files.

## Command Selection Rule of Thumb

- smallest relevant change: run the checks for the area you changed
- cross-boundary change: run checks for every touched subsystem
- dependency or versioning change: run the affected subsystem checks plus the sync workflow if `VERSION` changed

For companion-native changes that affect packaging, Windows-specific crates, or Tauri platform integration, include the Windows GNU cross-check in the local validation set even when you are not creating release artifacts.

For the broader validation strategy and how to choose depth, continue to [Test Strategy Overview](../../testing-and-quality-gates/test-strategy-overview/).
