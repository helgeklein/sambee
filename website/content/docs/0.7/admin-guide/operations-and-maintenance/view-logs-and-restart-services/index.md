+++
title = "View Logs And Restart Services"
description = "Use Docker Compose logs for Sambee diagnostics and perform routine stop or restart actions safely."
+++

Once Sambee is in service, logs and controlled restarts are the core day-to-day admin tools.

## View Logs

To follow logs for all services:

```bash
docker compose logs -f
```

To focus on the Sambee service only:

```bash
docker compose logs -f sambee
```

Use the service-specific view first when the issue is clearly about the application itself.

## Stop The Deployment

To stop the services:

```bash
docker compose down
```

Use a full stop when you need to perform controlled maintenance, rebuild the image, or restore deployment files.

## Restart As Part Of Operations

Routine restarts are not a substitute for troubleshooting, but they are a legitimate step when:

- you just changed deployment files
- you rebuilt the image
- you completed a controlled maintenance step

If you restart repeatedly without understanding the failure, move to [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/).

## What Good Log Usage Looks Like

Look for patterns such as:

- startup errors
- repeated reconnect or connection failures
- missing static assets or frontend-serving problems
- storage or SMB access failures

Logs are often the fastest way to separate a user-facing symptom from a real deployment fault.

## Related Pages

- [Routine Maintenance Checklist](../routine-maintenance-checklist/): use this for the compact recurring review flow
- [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this when logs show a real deployment fault rather than a routine maintenance step
