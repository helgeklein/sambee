+++
title = "Set up the Development Environment"
description = "Use the supported development environment, understand what it configures automatically, and know which baseline rules matter before you change dependencies or tooling."
+++

The supported contributor path is the repository dev container.

## Preferred Setup Path

The project is designed to be opened in VS Code with Dev Containers.

Baseline assumptions from the maintained setup:

- Python is pinned to the reviewed `3.13.12` baseline.
- Node and npm are available for frontend and companion work.
- Rust tooling is available for companion development.
- post-create setup installs reviewed dependencies, initializes local state, and prepares default config where needed.

## First-Time Setup

1. Open the repository in VS Code.
2. Reopen in the dev container when prompted.
3. Let the post-create setup complete.

The standard setup performs these tasks automatically:

- configures Git hooks used by the repository workflow
- installs backend dependencies from the hashed lockfiles
- installs Node dependencies from the committed lockfiles
- installs `pip-audit` and `cargo-audit` at the pinned versions used in CI
- initializes the local database
- creates a default `config.toml` if one is missing

The Git-hook setup matters more than it first appears.

- the repo uses hooks from `.githooks/`
- those hooks keep `GIT_COMMIT` aligned after commits and checkouts
- they preserve the repository's Git LFS hook integration
- they block pushes of `wip/*` branches

If you work outside the dev container, run:

```bash
./scripts/setup-git-hooks
```

## Local Service URLs

In the standard development setup, the main services are:

- frontend: `http://localhost:3000`
- backend: `http://localhost:8000`

The backend and frontend dev servers are usually started automatically by the workspace tasks.

## Dependency Trust Rules

Contributors are expected to use the reviewed dependency workflow rather than ad hoc installs.

- use `npm ci` in `frontend/`, `companion/`, and `website/` for routine installs
- use the backend lockfile workflow instead of floating Python installs
- treat `requirements*.txt`, lockfiles, and version metadata as reviewed source, not disposable setup noise
- keep Tauri JavaScript packages and Rust crates aligned when companion dependencies move
- treat Python runtime upgrades and high-risk frontend ecosystem upgrades as coordinated manual changes

## Configuration Expectations

Local development depends on configuration, but the repo is designed to create a sane default local configuration automatically.

- `config.example.toml` is the template
- `config.toml` is the active local configuration
- the backend startup workflow creates a default config with secure keys if one is missing

Do not assume production deployment rules and local development rules are identical. The Admin Guide covers deployment-specific setup.

## When to Leave the Happy Path

Use the default container-based workflow unless you have a specific reason not to.

- If your issue is environment-specific, fix the supported workflow first.
- If you change tooling or dependencies, expect to update the corresponding reviewed inputs and rerun the relevant validation commands.
- If you change version metadata, treat `VERSION` and the sync workflow as part of the change.

## Common Setup Failures

If startup fails immediately after opening the dev container, start with the supported workflow rather than ad hoc fixes.

Common cases:

- missing `config.toml`: the backend startup workflow should create a default config automatically
- frontend `vite: not found` or `node_modules` permission failures: remove the broken install and rerun `npm ci` in `frontend/`
- service startup confusion: backend and frontend dev servers are usually started by workspace tasks, so check task state before assuming the app itself is broken

Once the environment is ready, continue to [Common Task Commands](../common-task-commands/).
