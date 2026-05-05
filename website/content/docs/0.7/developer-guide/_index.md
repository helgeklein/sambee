+++
title = "Developer Guide"
+++

Use this guide to understand how Sambee is built across the backend, frontend, and companion, work safely in the repository and choose the right contributor workflow, understand the architecture and cross-cutting systems before changing code, and validate changes with the right checks before review or release.

## Start Here if You Want To

- understand how the browser app, backend, and companion fit together
- find the right place in the repository before changing code
- set up the development environment and use the common contributor workflows
- understand the high-level architecture of the backend, frontend, and companion
- understand deeper contributor rules for preview pipelines, companion trust, or version-sensitive changes
- choose the right validation commands before you open a pull request

## In This Guide

- [Project Orientation](./project-orientation/): understand the product boundaries and the repository layout
- [Local Development Workflow](./local-development-workflow/): set up the environment and find the commands you will actually use
- [Backend Architecture](./backend-architecture/): understand the FastAPI service, SMB-facing behavior, and server-side contracts
- [Frontend Architecture](./frontend-architecture/): understand the browser app, page structure, and UI behavior contracts
- [Companion Architecture](./companion-architecture/): understand the desktop app, pairing model, local-drive access, and native-app editing workflow
- [Cross-Cutting Systems](./cross-cutting-systems/): understand shared logging, localization, and other rules that span more than one app
- [Testing and Quality Gates](./testing-and-quality-gates/): choose the right checks for the change you are making
- [Contribution Workflows](./contribution-workflows/): plan and review changes with the right scope and validation depth
- [Release and Versioning](./release-and-versioning/): handle dependency updates and version metadata safely

## Use the Right Guide

- Use the Developer Guide when the next question is implementation-facing.
- Use the [Website Dev Guide](../website-dev-guide/) when the work is on the public website, published docs content, docs tooling, or shared website theme systems.
- Use the [User Guide](../user-guide/) when the next step belongs to the person using Sambee in normal workflows.
- Use the [Admin Guide](../admin-guide/) when the next step is deployment, configuration, operations, or escalation.

