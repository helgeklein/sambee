+++
title = "Deployment Architecture Overview"
description = "Understand Sambee's default single-container deployment model: one application container, one local data directory, SMB connectivity, and optional surrounding components."
+++

Sambee is designed to be straightforward to host. The default architecture is a single-container deployment: one Sambee application container, one local data directory, and network access to the SMB storage you already use.

Use this page to understand that single-container core before moving into prerequisites or step-by-step setup.

## The Core Single-Container Shape

At the center of a normal Sambee deployment is:

- one Sambee application container exposing the frontend and backend together
- one local data directory holding the SQLite database and other persistent application state
- one network path from Sambee to the SMB shares or file servers it needs to access
- browsers connecting to Sambee either directly or through a reverse proxy

If you use the standard Docker path, the architecture is exactly that simple: one Sambee container plus a persistent data mount.

## What Is Required And What Is Optional

| Component or concern | Required for the core deployment | Notes |
|---|---|---|
| Sambee application container | Yes | This is the core web application users connect to. In the standard Docker deployment, it is a single container. |
| Local persistent data directory | Yes | Stores the SQLite database and other local application state. |
| SMB reachability | Yes | Sambee must be able to reach the SMB storage it exposes. |
| Reverse proxy | No | Add one when you need HTTPS, hostname routing, or policy-controlled external access. |
| Companion app on user desktops | No | Needed only for local-drive access and native desktop-app editing workflows. |
| Separate frontend and backend services | No | Sambee's normal deployment model keeps them together in one container instead of splitting them into separate administrator-managed services. |

## Where Complexity Usually Comes From

The core Sambee deployment is a single-container setup. Complexity usually comes from surrounding infrastructure or optional workflows such as:

- reverse-proxy and HTTPS policy
- enterprise network rules between Sambee and SMB infrastructure
- identity, permissions, and access design in the storage environment
- desktop-local Companion workflows for users who need local drives or native-app editing
- operational policies for backups, upgrades, and monitoring

Those are important, but they are not the same thing as Sambee requiring many moving parts. The core architecture stays small even when the surrounding environment is more demanding.

## A Typical Small Deployment

A small deployment often looks like this:

1. A host runs Docker and Docker Compose.
2. One Sambee container runs on that host.
3. A local data directory is mounted for persistence.
4. Sambee connects to an existing NAS, Samba server, or Windows file server over SMB.
5. Users connect from their browsers directly to Sambee or through a reverse proxy if needed.
6. Only the users who need local-drive or native-app workflows install Sambee Companion.

## When This Model Is A Good Fit

This deployment model fits well when you want:

- browser-based access to existing SMB storage
- self-hosted control without splitting the product into many administrator-managed services
- a simple starting point that can later be placed behind a reverse proxy or integrated into stricter environments
- optional desktop-local enhancements instead of mandatory desktop agents everywhere

## Next Steps

- Continue to [What Sambee Requires To Run](../what-sambee-requires-to-run/) to confirm prerequisites and responsibility boundaries.
- If you are ready to set up the service, continue to [Deploy Sambee With Docker](../../installation-and-deployment/deploy-sambee-with-docker/).

## Related Pages

- [Configuration And Data Paths](../../reference/configuration-and-data-paths/): use this when you need the stable path reference for deployment files and persistent data
- [Put Sambee Behind A Reverse Proxy](../../network-and-reverse-proxy/put-sambee-behind-a-reverse-proxy/): use this when the simple direct deployment needs HTTPS, hostname routing, or proxy integration
