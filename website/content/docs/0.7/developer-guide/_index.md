+++
title = "Developer Guide"
+++

Use this guide to understand how Sambee is built, how to work safely in the repository, and how to validate changes across the backend, frontend, companion, and website.

Start here if you want to:

- understand how the browser app, backend, companion, and public website fit together
- find the right place in the repository before changing code or docs
- set up the development environment and use the common contributor workflows
- understand the high-level architecture of the backend, frontend, companion, and docs system
- understand deeper contributor rules for preview pipelines, companion trust, docs authoring, or version-sensitive changes
- choose the right validation commands before you open a pull request

If you are trying to use Sambee day to day, use the [User Guide](../user-guide/) instead. If the problem is deployment, configuration, or service operations, use the [Admin Guide](../admin-guide/).

## In This Guide

- [Project Orientation](./project-orientation/): understand the product boundaries and the repository layout
- [Local Development Workflow](./local-development-workflow/): set up the environment and find the commands you will actually use
- [Backend Architecture](./backend-architecture/): understand the FastAPI service, SMB-facing behavior, and server-side contracts
- [Frontend Architecture](./frontend-architecture/): understand the browser app, page structure, and UI behavior contracts
- [Companion Architecture](./companion-architecture/): understand the desktop app, pairing model, local-drive access, and native-app editing workflow
- [Website And Docs System](./website-and-docs-system/): understand the Hugo site, versioned docs structure, and navigation model
- [Cross-Cutting Systems](./cross-cutting-systems/): understand shared logging, localization, and other rules that span more than one app
- [Testing And Quality Gates](./testing-and-quality-gates/): choose the right checks for the change you are making
- [Contribution Workflows](./contribution-workflows/): plan and review changes with the right scope, docs updates, and validation depth
- [Release And Versioning](./release-and-versioning/): handle dependency updates, version metadata, and docs-version changes safely

## Use The Right Docs Book

Sambee keeps user, admin, and contributor content separate on purpose.

- Use the Developer Guide when the next question is implementation-facing.
- Use the [User Guide](../user-guide/) when the next step belongs to the person using Sambee in normal workflows.
- Use the [Admin Guide](../admin-guide/) when the next step is deployment, configuration, operations, or escalation.

