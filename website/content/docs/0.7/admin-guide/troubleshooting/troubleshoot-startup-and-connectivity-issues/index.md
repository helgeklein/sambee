+++
title = "Troubleshoot Startup And Connectivity Issues"
description = "Troubleshoot the most common service-side failures in Sambee: startup problems, frontend loading issues, SMB connectivity failures, and related login problems."
+++

Use this page when the deployment itself looks unhealthy or unreachable.

## Verify The Failure Boundary First

Before changing anything, identify which boundary is actually failing.

- does the `sambee` service stay up at all
- does the direct application path respond on the expected host port
- does only the proxied hostname fail

Those answers tell you whether you are in a general deployment fault, a proxy-only fault, or a narrower login or support incident.

## Container Will Not Start Cleanly

Start with the service state and the Sambee logs:

```bash
docker compose ps
```

```bash
docker compose logs sambee --tail 100
```

Look for explicit startup errors before changing configuration or rebuilding the image blindly.

## Frontend Is Not Loading

If the service appears to be up but the frontend does not load as expected, rebuild the image and restart the deployment:

```bash
docker compose build --no-cache sambee
docker compose up -d
```

You can also verify that static files exist inside the container:

```bash
docker compose exec sambee ls -la /app/static
```

If the container is healthy but users still cannot reach the UI correctly, inspect the reverse-proxy layer next.

If the direct application path works but the hostname or HTTPS path does not, go to [Reverse Proxy Misconfiguration](../reverse-proxy-misconfiguration/).

## Cannot Connect To SMB Shares

If Sambee itself is up but SMB access fails, check basic network reachability to the target SMB host:

```bash
docker compose exec sambee ping your-smb-host
```

Then verify:

- credentials are correct
- the expected SMB ports are reachable
- logs show a storage or connectivity issue rather than a general application failure

Ping is only a quick reachability check. Even if ping works, Sambee still needs SMB access on the right ports for your environment.

## First Login Or Admin Password Problems

If the first login fails, confirm that you retrieved the password from the expected startup logs.

You should see a `FIRST-TIME SETUP - SAVE THESE CREDENTIALS` block with the generated username and password.

If the admin password is lost later, use [Reset The Admin Password](../reset-the-admin-password/) instead of keeping the recovery steps buried inside this broad troubleshooting page.

## Companion-Related Symptoms That Reach This Page

Companion issues belong here when they no longer look like normal end-user workflow mistakes.

Examples:

- desktop-app edits never upload back even though the user followed the normal flow
- Companion will not start at all on the affected machine
- the local environment blocks the trust or connectivity assumptions Companion depends on

Use [Support Companion-App Escalation](../../user-support-and-escalation/support-companion-app-escalation/) when the problem is specifically moving into support diagnostics.

If you need more detail from the desktop app, collect the Companion logs and enable verbose logging as described in [Companion Support Reference](../../reference/companion-support-reference/).

## Related Pages

- [Reset The Admin Password](../reset-the-admin-password/): use this when the deployment is healthy but administrator access needs recovery
- [Reverse Proxy Misconfiguration](../reverse-proxy-misconfiguration/): use this when the service is up but the hostname or HTTPS path is wrong
- [Support Companion-App Escalation](../../user-support-and-escalation/support-companion-app-escalation/): use this when the failure is moving into environment or desktop-support diagnostics
