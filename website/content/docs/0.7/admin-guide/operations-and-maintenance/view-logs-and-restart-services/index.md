+++
title = "View Logs and Restart Services"
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

If you only need recent startup output, use:

```bash
docker compose logs sambee --tail 100
```

## Stop the Deployment

To stop the services:

```bash
docker compose down
```

Use a full stop when you need to perform controlled maintenance, rebuild the image, or restore deployment files.

## Restart as Part of Operations

Routine restarts are not a substitute for troubleshooting, but they are a legitimate step when:

- You just changed deployment files.
- You rebuilt the image.
- You completed a controlled maintenance step.

To restart only the Sambee service:

```bash
docker compose restart sambee
```

If you restart repeatedly without understanding the failure, move to [Troubleshoot Startup and Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/).

## What Good Log Usage Looks Like

Look for patterns such as:

- Startup errors.
- Repeated reconnect or connection failures.
- Missing static assets or frontend-serving problems.
- Storage or SMB access failures.

Logs are often the fastest way to separate a user-facing symptom from a real deployment fault.

## Related Pages

- [Routine Maintenance Checklist](../routine-maintenance-checklist/): use this for the compact recurring review flow
- [Troubleshoot Startup and Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this when logs show a real deployment fault rather than a routine maintenance step
