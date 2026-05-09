+++
title = "Architecture Overview"
+++

Sambee has a deliberately simple architecture: a single container contains everything that is needed, plus - optionally - a reverse proxy.

## Single Docker Container

At the center of a Sambee deployment is:

- A container running the Sambee backend and serving the frontend via HTTP.
- A local data directory holding the SQLite database and other persistent application state.
- Network connectivity from the Sambee backend to the SMB shares you want to access through Sambee.

Browsers connect to Sambee either directly or through a reverse proxy.

## What Is Required and What Is Optional

| Component or concern | Required | Notes |
|---|---|---|
| Sambee application container | Yes | This is the web application users open in their browsers. |
| Local persistent data directory | Yes | Stores the SQLite database and other data Sambee must keep across restarts. |
| SMB connectivity | Yes | Sambee must be able to reach the SMB storage it presents to users. |
| Reverse proxy | No | Add one when you need HTTPS, hostname routing, or controlled external access. |
| Companion app on user desktops | No | Needed only for local-drive access and desktop-app editing workflows.
