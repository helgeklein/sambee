+++
title = "Deploy Sambee with Docker"
+++

## Before You Start

You need:

- Docker and `docker compose` installed.
- A host that can reach the SMB file servers Sambee will use.
- A deployment directory where you can keep local files such as `docker-compose.yml`, optional `config.toml`, and the persistent `data/` directory.

## 1. Obtain the Source

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

## 3. Create the Compose File

Start from the provided example:

```bash
cp docker-compose.example.yml docker-compose.yml
```

Before first start, review:

- Mounted paths.
- Published ports.
- Optional config mounts.
- How the service will fit into your network or reverse-proxy setup.

## 4. Optional: Create a Local Configuration File

If you need custom settings, create `config.toml` from the example:

```bash
cp config.example.toml config.toml
```

You do not need `config.toml` for a basic deployment. Create it only if you need to change defaults such as authentication, logging, or Companion download settings.

Keep this file local. In production, mount it read-only.

## 5. Build and Start Sambee

Build the image:

```bash
docker build -t sambee:latest .
```

Then start the application:

```bash
docker compose up -d
```

By default, the service is available at:

- Frontend: `http://localhost:8000`
- Backend API: `http://localhost:8000/api`
- API docs: `http://localhost:8000/docs`

## Verify the Deployment

Before moving on, confirm that the deployment really came up cleanly.

- The `docker compose ps` output shows the `sambee` service running.
- The frontend URL responds on the expected host port.
- The startup logs do not show an obvious failure loop.

For a quick log review:

```bash
docker compose logs sambee --tail 100
```
