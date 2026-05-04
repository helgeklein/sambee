+++
title = "Network And Reverse Proxy"
description = "Configure external access, HTTPS, and reverse-proxy routing for Sambee."
+++

Sambee can run directly on its application port, but production deployments usually put a reverse proxy in front of it.

A reverse proxy is the service that handles the public hostname, HTTPS certificates, and forwarding traffic to Sambee. Common examples are Caddy, Nginx, and Traefik.

Start with:

- [Put Sambee Behind A Reverse Proxy](./put-sambee-behind-a-reverse-proxy/)

Related supporting pages:

- [Reverse Proxy Misconfiguration](../troubleshooting/reverse-proxy-misconfiguration/)

Use this section when the question is about hostnames, HTTPS, or how user traffic reaches the Sambee service.
