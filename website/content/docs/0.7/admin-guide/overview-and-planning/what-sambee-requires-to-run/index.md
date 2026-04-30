+++
title = "What Sambee Requires To Run"
description = "Understand the deployment model, runtime prerequisites, trust boundaries, and when to use the other Sambee docs books."
+++

Sambee is a self-hosted service for browser-based SMB access, optional local-drive access through Sambee Companion, and browser or desktop-assisted file workflows.

This page is the orientation point for administrators before deployment starts.

## Core Runtime Requirements

At a minimum, a working Sambee deployment needs:

- Docker and Docker Compose on the host where you plan to run Sambee
- persistent local storage for Sambee data
- network reachability between Sambee and the SMB infrastructure it must access
- a deployment model for HTTPS and external access if users will not stay on a local-only network path

## What Sambee Actually Consists Of

In operational terms, Sambee is:

- one deployed application service exposing the frontend and backend together
- a local data directory that includes the SQLite database
- connectivity out to SMB shares and related infrastructure
- optional companion-app workflows on user desktops when local drives or desktop-app editing are needed

## Trust And Responsibility Boundaries

These boundaries matter when you are deciding who should troubleshoot what.

- The Sambee service is your responsibility as an administrator.
- SMB access depends on the storage environment Sambee is connecting to.
- Companion-dependent features depend partly on the user's local desktop environment.
- Browser-only usage issues belong in the User Guide until they clearly become deployment, network, or policy problems.

## Which Docs Book To Use Next

Use the right guide for the job:

- stay in the Admin Guide for deployment, configuration, service health, logging, updates, backups, and support diagnostics
- send normal browsing, previewing, editing, and local-drive usage questions to the [User Guide](../../../user-guide/)
- use the [Developer Guide](../../../developer-guide/) when the question becomes implementation-facing

## Next Steps

- If you are starting a deployment, continue to [Deploy Sambee With Docker](../../installation-and-deployment/deploy-sambee-with-docker/).
- If Sambee is already running and you need HTTPS or hostname routing, continue to [Put Sambee Behind A Reverse Proxy](../../network-and-reverse-proxy/put-sambee-behind-a-reverse-proxy/).

## Related Pages

- [Configuration And Data Paths](../../reference/configuration-and-data-paths/): use this when the next question is where the deployment files and persistent data actually live
- [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this when the service is already deployed but no longer behaving normally
