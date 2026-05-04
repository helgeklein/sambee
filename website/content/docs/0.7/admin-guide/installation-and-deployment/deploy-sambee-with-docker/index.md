+++
title = "Deploy Sambee With Docker"
description = "Deploy Sambee with Docker, prepare the persistent data directory, and bring the application up for the first time."
+++

This is the first page in the deployment sequence.

## Before You Start

You need:

- Docker and `docker compose` installed
- a host that can reach the SMB server, Samba server, or NAS Sambee will use
- a deployment directory where you can keep local files such as `docker-compose.yml`, optional `config.toml`, and the persistent `data/` directory

For production, deploy a release tag rather than the current branch tip. In practice, that means checking out a published version before you build the image.

## 1. Obtain The Source

Clone the repository and move into it:

```bash
git clone https://github.com/helgeklein/sambee.git
cd sambee
```

If you are deploying a release, check out that tag before continuing:

```bash
git checkout <release-tag>
```

## 2. Prepare Persistent Storage

Create the local data directory and set ownership to user and group ID `1000`, which the containerized application uses:

```bash
mkdir -p ./data
chown -Rfv 1000:1000 ./data
```

This directory contains the Sambee database and other state that must survive restarts, rebuilds, and host reboots.

## 3. Create The Compose File

Start from the provided example:

```bash
cp docker-compose.example.yml docker-compose.yml
```

Before first start, review:

- mounted paths
- published ports
- optional config mounts
- how the service will fit into your network or reverse-proxy setup

## 4. Optional: Create A Local Configuration File

If you need custom settings, create `config.toml` from the example:

```bash
cp config.example.toml config.toml
```

You do not need `config.toml` for a basic deployment. Create it only if you need to change defaults such as authentication, logging, or Companion download settings.

Keep this file local. In production, mount it read-only.

## 5. Optional: Set Up Build Metadata Tracking

If you keep a long-lived source checkout and want build metadata to stay current automatically, set up the repository Git hooks:

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
docker compose logs sambee --tail 100
```

If the service does not stay up, go to the troubleshooting path before continuing with more setup.

## Next Steps

- Continue to [First Startup And First Admin Login](../first-startup-and-first-admin-login/) to retrieve the initial credentials and confirm the first admin sign-in.
- If this deployment will be used beyond a simple local test, continue to [Put Sambee Behind A Reverse Proxy](../../network-and-reverse-proxy/put-sambee-behind-a-reverse-proxy/).

## Related Pages

- [Configure Local Settings And Persistent Storage](../../configuration/configure-local-settings-and-persistent-storage/): adjust local files, ports, and persistence safely
- [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this if the first deployment does not stay healthy
