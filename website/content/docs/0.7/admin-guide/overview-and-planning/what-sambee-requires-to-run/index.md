+++
title = "What Sambee Requires To Run"
description = "Turn Sambee's deployment model into a short runtime and prerequisite checklist."
+++

This page follows Deployment Architecture Overview and turns that model into a short prerequisite checklist.

## Core Runtime Requirements

At a minimum, a working Sambee deployment needs:

- Docker and `docker compose` on the host where you plan to run Sambee
- persistent local storage for the `data/` directory
- network access from Sambee to the SMB server or NAS it must reach
- if users will connect through a hostname or over HTTPS, a reverse-proxy or ingress plan for that traffic

In practical terms, make sure the host can:

- resolve the SMB server name or IP address
- reach the SMB service on the ports your environment uses, usually `445` and sometimes `139`
- keep the `data/` directory across restarts, rebuilds, and host reboots

## Trust And Responsibility Boundaries

These boundaries help you decide who should troubleshoot a problem.

- The Sambee service is your responsibility as an administrator.
- SMB access also depends on the storage system Sambee is connecting to, including share permissions, name resolution, and network policy.
- Companion-based features also depend on the user's local desktop environment, such as installed apps, certificate trust, and proxy settings.
- Browser-only usage questions belong in the User Guide until they clearly become deployment, network, or policy problems.

## Next Steps

- If you are starting a deployment, continue to [Deploy Sambee With Docker](../../installation-and-deployment/deploy-sambee-with-docker/).
- If Sambee is already running and you need HTTPS or hostname routing, continue to [Put Sambee Behind A Reverse Proxy](../../network-and-reverse-proxy/put-sambee-behind-a-reverse-proxy/).

## Related Pages

- [Port And Path Reference](../../reference/port-and-path-reference/): use this when the next question is where the deployment files and persistent data actually live
- [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this when the service is already deployed but no longer behaving normally
