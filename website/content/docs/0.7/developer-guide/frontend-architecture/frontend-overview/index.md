+++
title = "Frontend Overview"
description = "Understand how the React browser app is structured and how it coordinates browsing, preview, editing, pairing, and UI-system concerns."
+++

The frontend is a React and TypeScript application built with Vite. It is responsible for presenting Sambee's workflows clearly while respecting the backend and companion contracts behind them.

## What The Frontend Owns

The browser app is responsible for:

- routing users into the main product surfaces
- rendering the file browser, viewer, and editing flows
- managing browser-side state, selection, and navigation behavior
- calling backend and companion-facing services through typed client code
- applying theming, localization, and browser-side logging behavior

## Main Frontend Areas

| Area | Responsibility |
|---|---|
| `frontend/src/pages/` | page-level product flows such as the file browser |
| `frontend/src/components/` | reusable UI building blocks |
| `frontend/src/services/` | API clients, browser-to-companion integration, and other service helpers |
| `frontend/src/i18n/` | typed translation resources and locale wiring |
| `frontend/src/theme/` | theme configuration and theme-selection behavior |
| `frontend/src/utils/` | formatting, registry, and other supporting utilities |

## File Browser As The Core Surface

The file browser is the center of the main product UI.

- it supports single-pane and dual-pane workflows
- it keeps layout state and pane routing aligned with the URL
- it coordinates selection, search, sorting, CRUD actions, viewer state, and keyboard behavior
- it handles WebSocket-driven directory refresh behavior

That is why frontend changes in the file browser often have broader user impact than they first appear to.

For the main browsing surface itself, continue to [File Browser And Navigation Model](../file-browser-and-navigation-model/).

## Frontend Contracts That Matter

### Backend Contracts

The frontend depends on stable backend response shapes. When those change, update the corresponding types, service logic, and contract tests together.

### Companion Contracts

The frontend is also the browser-side orchestrator for companion detection, pairing, local-drive access, and native-app editing initiation. That means browser-side state and desktop-side behavior are tightly linked even though they live in different projects.

### Theming And Localization

The app treats theme behavior and localization as typed, explicit systems rather than loose UI sugar.

- frontend copy should come from the translation system
- locale handling and regional formatting are treated as product behavior
- theme behavior is centralized instead of ad hoc component styling

## Cross-Cutting Frontend Concerns

- keyboard-first browsing and command surfaces
- typed logging and backend tracing configuration
- viewer behavior by file type and preview capability
- responsive behavior, including mobile limitations and dual-pane desktop features

## Go Deeper

- [File Browser And Navigation Model](../file-browser-and-navigation-model/): pane state, URL routing, keyboard flows, and refresh behavior
- [Viewer Architecture And Preview Contracts](../viewer-architecture-and-preview-contracts/): file-type registries, preview selection, and conversion-sensitive viewer behavior
- [Logging And Localization](../../cross-cutting-systems/logging-and-localization/): shared frontend-facing rules for diagnostics, translatable UI copy, and locale behavior

## Validation Expectations

When frontend behavior changes, start with:

```bash
cd frontend && npm test
cd frontend && npx tsc --noEmit
cd frontend && npm run lint
```

If the change also affects backend or companion contracts, add the matching checks there too.
