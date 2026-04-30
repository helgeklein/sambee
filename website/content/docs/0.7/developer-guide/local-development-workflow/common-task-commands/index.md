+++
title = "Common Task Commands"
description = "Use the supported commands and tasks for running services, testing changes, building the website, and syncing version metadata."
+++

Prefer the committed scripts and workspace tasks over improvised one-off commands.

## Daily Entry Points

| Goal | Preferred command or task |
|---|---|
| Start backend dev server | VS Code task `Backend: Start Dev Server` or `./scripts/start-backend` |
| Start frontend dev server | VS Code task `Frontend: Start Dev Server` or `./scripts/start-frontend` |
| Start website dev server | VS Code task `Website: Start Dev Server` or `./scripts/start-website` |
| Run fast repo tests | `./scripts/test` |
| Run repo tests with coverage | `COVERAGE=1 ./scripts/test` |

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
cd companion/src-tauri && cargo test
```

Useful related task:

- VS Code task `Companion: Run Rust Tests`
- VS Code task `Companion: Type Check + Lint`

## Website And Docs Commands

Use these when you are changing the public site, docs content, theme behavior, or docs navigation.

```bash
cd website && npm run build
cd website && npm run dev
cd website && npm run images:generate
cd website && npm run images:validate
```

The website build runs these major steps:

- theme generation
- docs-content validation
- docs inheritance materialization
- Hugo site build

## Version Sync

When you change `VERSION`, run the sync script and review all resulting metadata changes together.

```bash
./scripts/sync-version
```

That workflow updates the frontend and companion package metadata and related version-bearing files.

## Command Selection Rule Of Thumb

- smallest relevant change: run the checks for the area you changed
- cross-boundary change: run checks for every touched subsystem
- docs-only change under `website/`: run `cd website && npm run build`
- dependency or versioning change: run the affected subsystem checks plus the sync workflow if `VERSION` changed

For the broader validation strategy and how to choose depth, continue to [Test Strategy Overview](../../testing-and-quality-gates/test-strategy-overview/).
