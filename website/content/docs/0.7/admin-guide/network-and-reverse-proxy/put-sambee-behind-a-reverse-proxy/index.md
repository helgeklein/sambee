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

## Companion Native Editing Behind Interactive Auth

If your reverse proxy protects the Sambee backend with an interactive login flow, Companion native editing can still work, but the proxy setup has to satisfy a few constraints.

The Companion runtime opens its own `Sambee Authentication` webview when reverse-proxy auth intercepts backend API calls. After the user signs in there, Companion reuses backend-origin cookies from that embedded webview for its Rust-side API requests.

For that to work reliably:

- The reverse-proxy cookie must be valid for the Sambee backend origin that Companion calls.
- The login flow must work inside the system webview used by Tauri on the target desktop platform.
- The proxy must not depend on browser features that are unavailable in that embedded webview.
- The proxy must allow authenticated requests to the Companion backend endpoints after the embedded webview has established the proxy session.

{{< admonition type="note" >}}
Companion does not and cannot read cookies from the user’s Sambee frontend browser session.
{{< /admonition >}}

Operationally, that means you should test both the browser UI and a real Companion native-edit session when introducing or changing proxy auth. A useful native-edit test signs in through the Companion authentication window, opens an SMB-backed file in a desktop app, uploads or closes the edit session, and confirms that lock release works without a second unexpected login prompt.
