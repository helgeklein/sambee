+++
title = "Reverse Proxy Misconfiguration"
+++

Use this page when Sambee appears to run, but users still cannot reach it correctly through the intended hostname or HTTPS entry point.

## When This Page Fits

This is usually the right page when:

- the Sambee container is healthy but the public or internal hostname still fails
- direct access to the application port behaves differently from the proxied hostname
- users report TLS, certificate, or wrong-host behavior rather than a clear backend crash

## Separate Proxy Problems from Application Problems

Start by confirming which boundary is actually failing.

1. confirm the Sambee service is running
2. confirm the direct application URL or host port responds as expected for your deployment
3. confirm the proxied hostname still fails or routes incorrectly

If the direct service path is already broken, go back to the broader troubleshooting page first.

## Common Proxy-Side Failure Patterns

- the reverse proxy points at the wrong host or port
- the Sambee container is not attached to the expected proxy network
- the public hostname resolves to the wrong target
- the TLS certificate does not match the hostname users are actually opening
- the proxy host or path rules do not route Sambee traffic where you think they do

In the sample Caddy-oriented model, a very common mistake is forgetting that Sambee must be reachable on the shared proxy network rather than acting as the HTTPS edge itself.

## What to Verify before Changing the App

Check these items before rebuilding Sambee or changing application configuration blindly:

- the proxy can still reach the upstream Sambee service on the expected target port
- the intended hostname is the same one users are opening
- the certificate and trust model match the actual deployment environment
- the Sambee logs do not already show a general application startup failure

## Related Pages

- [Put Sambee behind a Reverse Proxy](../../network-and-reverse-proxy/put-sambee-behind-a-reverse-proxy/): return here for the normal setup model and the concise Caddy-oriented example
- [Troubleshoot Startup and Connectivity Issues](../troubleshoot-startup-and-connectivity-issues/): use this when the deployment boundary is still unclear or the app path is also broken
