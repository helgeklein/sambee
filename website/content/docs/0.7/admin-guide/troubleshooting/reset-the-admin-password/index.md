+++
title = "Reset The Admin Password"
description = "Recover administrator access by regenerating the admin password without wiping the rest of the Sambee deployment state."
+++

Use this page when the Sambee deployment is otherwise healthy but the administrator can no longer sign in because the current admin password is unavailable or known to be wrong.

## What This Recovery Changes

This recovery path deletes only the `admin` user row so Sambee can generate a fresh first-time password on the next startup.

It should preserve the rest of the deployment state, including:

- existing SMB connections
- stored configuration and security state in the database
- the rest of the deployment files under the normal data directory

## Before You Start

Confirm these boundaries first:

- the service itself is reachable enough that this is really an authentication problem rather than a startup or proxy problem
- you are working against the correct deployment directory and database volume
- the service name is `sambee` in your compose file, or you are ready to substitute your local service name

## Recovery Procedure

Stop only the Sambee service:

```bash
docker compose stop sambee
```

Delete only the `admin` user record from the database:

```bash
docker compose run --rm --no-deps sambee sqlite3 /app/data/sambee.db "DELETE FROM users WHERE username='admin';"
```

Start Sambee again:

```bash
docker compose up -d sambee
```

Read the newly generated password from the startup logs:

```bash
docker compose logs sambee --tail 100 | grep -A 5 "FIRST-TIME SETUP"
```

Then sign in again with:

- username: `admin`, unless your deployment uses a different configured admin username
- password: the newly generated value from the logs

## Verify Recovery

Confirm all of the following before closing the incident:

- the logs show a fresh `FIRST-TIME SETUP - SAVE THESE CREDENTIALS` block with a new password
- the admin sign-in now works
- the rest of the deployment state is still present after login

If the deployment itself is unhealthy, return to the broader troubleshooting path instead of repeating the password reset.

## Common Failure Modes

- trying to use `docker compose exec` against a stopped service
- deleting more than the `admin` user row
- treating a reverse-proxy or general service failure as if it were only a password problem

## Related Pages

- [First Startup And First Admin Login](../../installation-and-deployment/first-startup-and-first-admin-login/): compare the regenerated login flow to the first-run flow
- [Troubleshoot Startup And Connectivity Issues](../troubleshoot-startup-and-connectivity-issues/): return here when the problem is broader than administrator access recovery
