+++
title = "Put Sambee behind a Reverse Proxy"
+++

For production-style deployments, place a reverse proxy in front of Sambee to handle HTTPS.

## Why Use a Reverse Proxy

A reverse proxy gives you a cleaner operational model for:

- HTTPS and certificate management
- A stable hostname and routing layer in front of the container

## Caddy Example

If you already run a dockerized Caddy environment, the Sambee service can be connected to that network with a compose layout like this:

```yaml
services:
  sambee:
    container_name: sambee
    hostname: sambee
    build: .
    restart: unless-stopped
    networks:
      - caddy_caddynet
    expose:
      - "8000"
    volumes:
      - ./data:/app/data
      # Optional:
      # - ./config.toml:/app/config.toml:ro

networks:
  caddy_caddynet:
    external: true
```

Here, `expose` makes Sambee's port `8000` available to other containers on the same Docker network without publishing it directly to the host.

The important point is that Sambee serves plain HTTP to the reverse proxy and does not act as the HTTPS edge itself.
