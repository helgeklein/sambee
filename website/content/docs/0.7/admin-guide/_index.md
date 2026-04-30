+++
title = "Admin Guide"
+++

Use this guide to deploy, configure, operate, maintain, and support a Sambee installation.

Start here if you want to:

- understand what Sambee needs in order to run
- deploy Sambee with Docker and persistent storage
- place Sambee behind a reverse proxy
- recover admin access or diagnose proxy-side reachability failures
- handle routine operations such as logs, restarts, upgrades, and backups
- troubleshoot service-side failures and support escalated companion-app problems

If you are trying to use Sambee as an end user, use the [User Guide](../user-guide/) instead.

## In This Guide

- [Overview And Planning](./overview-and-planning/): deployment model, prerequisites, and trust boundaries
- [Installation And Deployment](./installation-and-deployment/): first setup and first admin login
- [Network And Reverse Proxy](./network-and-reverse-proxy/): HTTPS, hostnames, reverse-proxy setup, and proxy-side failure diagnosis
- [Configuration](./configuration/): local settings, ports, persistence, and the high-value configuration keys administrators actually change
- [Operations And Maintenance](./operations-and-maintenance/): logs, restarts, routine maintenance checks, updates, and backups
- [User Support And Escalation](./user-support-and-escalation/): when administrators need to step into companion-app or access problems
- [Troubleshooting](./troubleshooting/): startup, connectivity, admin-password recovery, and service-health failures
- [Reference](./reference/): stable ports, deployment paths, configuration/data-path lookup, and companion-support lookup material

## Common Deep Dives

- [Reset The Admin Password](./troubleshooting/reset-the-admin-password/): recover administrator access without resetting the whole deployment
- [Reverse Proxy Misconfiguration](./troubleshooting/reverse-proxy-misconfiguration/): diagnose proxy-side hostname, HTTPS, and reachability failures
- [Companion Support Reference](./reference/companion-support-reference/): find companion logs, preferences, crash-diagnostic entry points, and Windows WebView2 notes

## Use The Right Docs Book

Sambee now has separate guides for separate jobs.

- Use this Admin Guide when the problem is about deployment, configuration, service health, network access, or support diagnostics.
- Use the [User Guide](../user-guide/) when the next step belongs to the person using Sambee day to day.
- Use the [Developer Guide](../developer-guide/) when the question becomes implementation-facing.

