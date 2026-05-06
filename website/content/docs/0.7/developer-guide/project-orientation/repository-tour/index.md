+++
title = "Repository Tour"
+++

This repository is organized around product boundaries, not just programming languages.

## Top-Level Areas

| Path | What it contains | Start here when |
|---|---|---|
| `backend/` | FastAPI application, models, services, storage code, and backend tests | you are changing API behavior, SMB handling, server-side validation, or edit-lock behavior |
| `frontend/` | React browser app, UI components, pages, hooks, services, and browser-side tests | you are changing the main web UI or browser behavior |
| `companion/` | Tauri desktop app with Preact UI and Rust backend | you are changing local-drive access, native-app editing, pairing, or desktop-side behavior |
| `scripts/` | repo-level helper scripts for dev services, tests, version sync, and setup | you need the supported workflow instead of an ad hoc command |

## Important Root Files

These files shape contributor workflows even though they are not feature code.

| Path | Why it matters |
|---|---|
| `VERSION` | single source of truth for the current release identifier |
| `config.example.toml` | starting point for local configuration |
| `config.toml` | active local configuration in development or deployment |
| `README.md` | high-level product framing |
| `AGENTS.md` | repository-specific working rules for this environment |
| `biome.json` | shared formatting and lint configuration for JavaScript and TypeScript work |

## Product-Specific Notes

- `backend/app/` is where the service code lives. Use it when the browser depends on server behavior or when SMB behavior changes.
- `backend/tests/` holds the backend validation layer. Keep it close to backend behavior changes.
- `frontend/src/` is the main browser app surface. Pages, services, and UI contracts all converge here.
- `companion/src/` holds the desktop UI, while `companion/src-tauri/` holds the Rust backend, local API, and deep-link handling.
## Where to Look First for Common Changes

- Browser workflow change: start in `frontend/`, then confirm the backend or companion contract the UI depends on.
- SMB behavior change: start in `backend/`, then validate the frontend behavior that consumes it.
- Native-app editing or local-drive change: start in `companion/`, then review the related browser and backend contract.

## What Not to Do

- Do not treat the repo as three isolated apps. Many changes cross backend, frontend, and companion boundaries.
- Do not assume lockfiles, version metadata, or generated files are incidental. Several workflows rely on them as reviewed source.

If you know which area you need, continue to [Local Development Workflow](../../local-development-workflow/) or jump directly to the relevant architecture section.
