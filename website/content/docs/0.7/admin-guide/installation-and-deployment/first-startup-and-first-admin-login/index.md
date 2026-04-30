+++
title = "First Startup And First Admin Login"
description = "Confirm that Sambee started successfully, retrieve the initial admin password, and complete the first admin sign-in."
+++

Once the containers are up, the next job is to confirm that Sambee started cleanly and that you can sign in as the initial administrator.

## Confirm Startup

After `docker compose up -d`, check that the Sambee service is running and emitting normal startup logs.

If the service does not come up cleanly, jump to [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/).

## Retrieve The Initial Admin Password

Get the first-time admin password from the logs:

```bash
docker compose logs sambee | grep -A 5 "FIRST-TIME SETUP"
```

You will need:

- username: `admin`, unless you changed it through configuration
- password: the generated password from the logs

## Sign In

Open Sambee in the browser at the frontend URL for your deployment and sign in with the initial admin credentials.

This first sign-in confirms that:

- the service is reachable
- the frontend is loading
- the backend startup completed far enough to expose the first-time setup information

## If The Login Fails

Common reasons include:

- the service did not start cleanly
- the password was copied incorrectly from the logs
- the frontend is not actually loading from the expected container

If you cannot retrieve the password or the login still fails, use [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/).

## Next Steps

- If you still need HTTPS or hostname routing, continue to [Put Sambee Behind A Reverse Proxy](../../network-and-reverse-proxy/put-sambee-behind-a-reverse-proxy/).
- If you need to customize local settings or persistence behavior, continue to [Configure Local Settings And Persistent Storage](../../configuration/configure-local-settings-and-persistent-storage/).

## Related Pages

- [Reset The Admin Password](../../troubleshooting/reset-the-admin-password/): use this later if administrator access needs recovery without resetting the rest of the deployment
- [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this when the login issue is really a broader startup or reachability problem
