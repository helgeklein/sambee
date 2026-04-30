+++
title = "Deploy Sambee With Docker"
description = "Deploy Sambee with Docker, prepare the persistent data directory, and bring the application up for the first time."
+++

This page is the main first-run deployment path for Sambee.

## Before You Start

You need:

- Docker and Docker Compose installed
- a host that can reach the SMB infrastructure Sambee will use
- a deployment directory where you can keep local files such as `docker-compose.yml`, optional `config.toml`, and the persistent `data/` directory

For production deployments, prefer a reviewed release tag or commit rather than whatever happens to be at the branch tip.

## 1. Obtain The Source

Clone the repository and move into it:

```bash
git clone https://github.com/helgeklein/sambee.git
cd sambee
```

If you are deploying a reviewed version, check out that trusted tag or commit before continuing.

## 2. Prepare Persistent Storage

Create the local data directory and set ownership to user and group ID `1000`, which the containerized application uses:

```bash
mkdir -p ./data
chown -Rfv 1000:1000 ./data
```

This directory contains the Sambee database and must persist across restarts.

## 3. Create The Compose File

Start from the provided example:

```bash
cp docker-compose.example.yml docker-compose.yml
```

Before first start, review:

- mounted paths
- published ports
- optional config mounts
- how the service will fit into your local network or reverse-proxy setup

## 4. Optional: Create A Local Configuration File

If you need custom settings, create `config.toml` from the example:

```bash
cp config.example.toml config.toml
```

Keep this file local. In production, mount it read-only.

## 5. Optional: Set Up Build Metadata Tracking

For first-time source-based setups, configure the Git hooks used to keep the build metadata current:

```bash
./scripts/setup-git-hooks
```

## 6. Build And Start Sambee

Build the image:

```bash
docker build -t sambee:latest .
```

Then start the application:

```bash
docker compose up -d
```

By default, the service is available at:

- frontend: `http://localhost:8000`
- backend API: `http://localhost:8000/api`
- API docs: `http://localhost:8000/docs`

## Verify The First Deployment

Before moving on, confirm that the deployment really came up cleanly.

- `docker compose ps` shows the `sambee` service running
- the frontend URL responds on the expected host port
- the startup logs do not show an obvious failure loop

For a quick log review:

```bash
docker compose logs sambee --tail 50
```

If the service does not stay up, go to the troubleshooting path before continuing with more setup.

## What This Deployment Page Deliberately Does Not Cover In Depth

This page gets Sambee running first. It does not try to fully cover:

- reverse-proxy design
- HTTPS policy
- detailed configuration reference
- long-term operations and backup procedures

Those topics live elsewhere in the Admin Guide.

## Next Steps

- Continue to [First Startup And First Admin Login](../first-startup-and-first-admin-login/).
- If this deployment will be used beyond a simple local test, continue to [Put Sambee Behind A Reverse Proxy](../../network-and-reverse-proxy/put-sambee-behind-a-reverse-proxy/).

## Related Pages

- [Configure Local Settings And Persistent Storage](../../configuration/configure-local-settings-and-persistent-storage/): adjust local files, ports, and persistence safely
- [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this if the first deployment does not stay healthy
