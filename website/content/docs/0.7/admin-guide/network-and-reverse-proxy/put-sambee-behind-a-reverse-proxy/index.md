+++
title = "Put Sambee Behind A Reverse Proxy"
description = "Place Sambee behind a reverse proxy, handle HTTPS, and use a concise Caddy example as the baseline product-docs pattern."
+++

For production-style deployments, place a reverse proxy in front of Sambee so HTTPS, hostnames, and external access are handled outside the application container itself.

## Why Use A Reverse Proxy

A reverse proxy gives you a cleaner operational model for:

- HTTPS termination
- hostname-based access
- integrating Sambee into an existing service edge
- keeping the application service behind a stable frontend entry point

## Keep The Product Docs Scope Tight

This guide does not try to become a generic handbook for every reverse proxy.

For the Sambee docs, the main goal is to show how Sambee fits behind a proxy and to provide one concise example that is easy to adapt.

## Concise Caddy-Oriented Compose Example

If you already run a Dockerized Caddy environment, the Sambee service can be connected to that network with a compose layout like this:

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
      - 8000:8000
    volumes:
      - ./data:/app/data
      # Optional:
      # - ./config.toml:/app/config.toml:ro

networks:
  caddy_caddynet:
    external: true
```

The important operational point is that Sambee exposes its application port to the reverse-proxy network rather than acting as the HTTPS edge itself.

## Hostnames And HTTPS

Before exposing Sambee externally, decide:

- which hostname users should use
- which system manages certificates
- whether the proxy is already part of a larger internal or external ingress design

Keep those decisions consistent with the rest of your environment rather than treating Sambee as a special case.

## Verify The Proxy Path

Before declaring the proxy setup done, confirm all of the following:

- the intended hostname reaches Sambee rather than some other service or fallback page
- the certificate and hostname match the deployment users are expected to open
- the Sambee frontend loads through the proxy path, not only through the direct application port

If the direct application port works but the proxy hostname still fails, stay in the proxy layer instead of rebuilding the application immediately.

## Common Failure Modes

- the proxy points at the wrong host or port
- Sambee is not attached to the expected proxy network
- the hostname users open does not match the hostname the proxy is configured for
- the certificate or trust model is wrong for the environment
- a proxy rule routes Sambee traffic to the wrong upstream target

## When Reverse Proxy Problems Look Like Application Problems

Reverse-proxy issues often show up as:

- the frontend never loading
- users reaching the wrong host or port
- HTTPS working for other services but not for Sambee

If the container is healthy but users still cannot reach the service correctly, check the reverse-proxy layer before assuming the application itself is broken.

## Related Pages

- [Reverse Proxy Misconfiguration](../../troubleshooting/reverse-proxy-misconfiguration/): use this when the app is up but hostname or HTTPS routing is still wrong
- [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this when the application path is also failing
