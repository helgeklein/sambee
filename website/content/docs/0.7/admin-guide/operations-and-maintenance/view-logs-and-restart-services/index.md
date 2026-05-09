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

If you restart repeatedly without understanding the failure, stop restarting and inspect the logs, deployment files, proxy path, and persistent data assumptions directly.
