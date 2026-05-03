+++
title = "What Sambee Consists Of"
description = "Understand the major Sambee subsystems and the user-facing capability boundaries contributors need to preserve."
+++

Sambee is not a single app with one execution model. It is a coordinated system with separate responsibilities in the browser, on the server, on the desktop, and on the public website.

## The Major Pieces

| Subsystem | Main responsibility | Where it lives |
|---|---|---|
| Browser app | User-facing file browsing, preview, editing UI, and service calls | `frontend/` |
| Backend service | Authentication, API endpoints, SMB access, server-side file handling, locks, and notifications | `backend/` |
| Companion app | Native-app editing, local-drive access, pairing, and desktop-local integrations | `companion/` |
| Website and docs | Marketing pages, versioned docs books, and docs build tooling | `website/` |

## Capability Boundaries Contributors Must Preserve

Sambee deliberately separates browser-only workflows from companion-backed workflows.

Browser-only workflows:

- browsing SMB shares
- previewing supported content in the browser
- managing files through the web interface
- editing Markdown directly in the browser

Companion-backed workflows:

- browsing local drives on the same machine as the browser
- opening files in installed native desktop applications
- returning native-app edits to the source location
- syncing localization and other browser-to-desktop state where the product requires it

Those boundaries matter because the product makes different trust, runtime, and platform assumptions in each path.

## How A Normal Request Path Splits

For an SMB-browser workflow:

1. The browser app issues authenticated API calls.
2. The backend enforces server-side policy and talks to SMB storage.
3. The browser renders the result.

For a companion-backed workflow:

1. The browser app still owns the main user workflow.
2. The companion is discovered or launched locally.
3. Browser and companion exchange trusted local information through pairing or deep links, depending on the flow.
4. The backend remains the source of truth for SMB edit workflows, while the companion adds desktop-local capability.

## Why The Website Lives In The Same Repository

The public site and versioned docs live in the same repository because they are part of the shipping product surface.

- Homepage messaging has to match real capabilities.
- Published docs sets have to stay aligned with releases.
- Contributor docs need direct access to the same code, content, navigation, and build scripts they describe.

## What This Means For Contributors

When you change Sambee, do not treat every feature as interchangeable.

- A frontend-only change can still break a backend contract.
- A backend change can alter browser behavior, companion behavior, or both.
- A companion change can affect desktop editing, local drives, and paired browser expectations.
- A docs or website change can affect version routing, navigation, and contributor guidance even when no product code changes.

Use the rest of this guide to go deeper into each subsystem rather than trying to keep the whole model in your head at once.
