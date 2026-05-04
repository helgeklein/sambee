+++
title = "Admin Guide"
+++

Sambee is a self-hosted web app for browsing and managing files on SMB (Server Message Block) shares from a browser.

Use this guide to plan, deploy, configure, maintain, and troubleshoot a Sambee service. Sambee Companion is the optional desktop app for local-drive access and desktop-app editing.

Start here if you want to:

- understand what Sambee needs in order to run
- deploy Sambee with Docker and persistent storage
- place Sambee behind a reverse proxy for HTTPS or hostname-based access
- recover admin access or diagnose proxy-side failures
- handle routine operations such as logs, restarts, upgrades, and backups
- support escalated Sambee Companion problems

If you are trying to use Sambee as an end user, use the [User Guide](../user-guide/) instead. If the question becomes implementation-facing, use the [Developer Guide](../developer-guide/).

## In This Guide

- [Overview And Planning](./overview-and-planning/): what Sambee is, how it fits into your environment, and what it needs to run
- [Installation And Deployment](./installation-and-deployment/): the shortest path to a working deployment and first admin sign-in
- [Network And Reverse Proxy](./network-and-reverse-proxy/): HTTPS, hostnames, and reverse-proxy setup
- [Configuration](./configuration/): local settings, ports, persistence, and the config keys admins most often change
- [Operations And Maintenance](./operations-and-maintenance/): logs, restarts, routine checks, upgrades, and backups
- [User Support And Escalation](./user-support-and-escalation/): when a user problem becomes an admin task
- [Troubleshooting](./troubleshooting/): startup, connectivity, admin-password recovery, and proxy-side failures
- [Reference](./reference/): ports, paths, and companion-support lookup material

## Common Deep Dives

- [Reset The Admin Password](./troubleshooting/reset-the-admin-password/): recover administrator access without resetting the whole deployment
- [Reverse Proxy Misconfiguration](./troubleshooting/reverse-proxy-misconfiguration/): diagnose proxy-side hostname, HTTPS, and reachability failures
- [Companion Support Reference](./reference/companion-support-reference/): find companion logs, preferences, crash-diagnostic entry points, and Windows WebView2 notes

