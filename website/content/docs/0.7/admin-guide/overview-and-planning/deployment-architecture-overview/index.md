+++
title = "Deployment Architecture Overview"
description = "Understand Sambee's default single-container deployment model: one application container, one local data directory, SMB connectivity, and optional surrounding components."
+++

Most Sambee deployments are simple: one application container, one local data directory, and network access to existing SMB storage.

SMB (Server Message Block) is the file-sharing protocol used by Windows file servers, Samba servers, and many NAS devices. Sambee Companion is optional and is needed only for local-drive access and for opening files in installed desktop applications.

This page is the first step in the planning path. The next page turns this deployment model into a short prerequisite checklist.

## The Core Single-Container Shape

At the center of a normal Sambee deployment is:

- one Sambee container serving both the frontend and backend
- one local data directory holding the SQLite database and other persistent application state
- one network path from Sambee to the SMB shares or file servers it needs to access
- browsers connecting to Sambee either directly or through a reverse proxy

If you use the standard Docker path, the architecture is exactly that simple: one Sambee container plus a persistent data mount.

## What Is Required And What Is Optional

| Component or concern | Required for the core deployment | Notes |
|---|---|---|
| Sambee application container | Yes | This is the web application users open in their browsers. |
| Local persistent data directory | Yes | Stores the SQLite database and other data Sambee must keep across restarts. |
| SMB reachability | Yes | Sambee must be able to reach the SMB storage it presents to users. |
| Reverse proxy | No | Add one when you need HTTPS, hostname routing, or controlled external access. |
| Companion app on user desktops | No | Needed only for local-drive access and desktop-app editing workflows. |
| Separate frontend and backend services | No | The standard deployment keeps them together in one container. |

## Where Complexity Usually Comes From

The core Sambee deployment is small. Extra complexity usually comes from the surrounding environment or optional workflows such as:

- reverse-proxy and HTTPS policy
- enterprise network rules between Sambee and SMB infrastructure
- identity, permissions, and access design in the storage environment
- desktop-local Companion workflows for users who need local drives or native-app editing
- operational policies for backups, upgrades, and monitoring

Those are real admin concerns, but they do not change the basic Sambee deployment model.

## A Typical Small Deployment

A small deployment often looks like this:

1. A host runs Docker and `docker compose`.
2. One Sambee container runs on that host.
3. A local data directory is mounted for persistence.
4. Sambee connects to an existing NAS, Samba server, or Windows file server over SMB.
5. Users connect from their browsers directly to Sambee or through a reverse proxy if needed.
6. Only the users who need local-drive or native-app workflows install Sambee Companion.

## When This Model Is A Good Fit

This deployment model fits well when you want:

- browser-based access to existing SMB storage
- a self-hosted service without splitting the product into many separately managed components
- a simple starting point that can later be placed behind a reverse proxy or integrated into stricter environments
- optional desktop integration instead of mandatory desktop software on every machine

## Next Steps

- Continue to [What Sambee Requires To Run](../what-sambee-requires-to-run/) to confirm prerequisites and responsibility boundaries.

## Related Pages

- [Port And Path Reference](../../reference/port-and-path-reference/): use this when you need the stable lookup page for ports, deployment files, and persistent data
- [Put Sambee Behind A Reverse Proxy](../../network-and-reverse-proxy/put-sambee-behind-a-reverse-proxy/): use this when the simple direct deployment needs HTTPS, hostname routing, or proxy integration
