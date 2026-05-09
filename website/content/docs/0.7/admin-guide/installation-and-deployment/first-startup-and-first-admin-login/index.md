+++
title = "First Startup and First Admin Login"
+++

Once the container is up, retrieve the initial credentials and confirm that you can sign in as the first administrator.

## Retrieve the Initial Admin Password

Get the first-time admin password from the logs:

```bash
docker compose logs sambee --tail 100 | grep -A 5 "FIRST-TIME SETUP"
```

You are looking for a log block labeled `FIRST-TIME SETUP - SAVE THESE CREDENTIALS` with lines for the username and password.

You will need:

- Username: `admin`, unless you changed it through configuration.
- Password: The generated password from the logs.

## Sign In

Open Sambee in the browser at the frontend URL for your deployment and sign in with the initial admin credentials.

This first sign-in confirms that:

- The service is reachable.
- The frontend is loading.
- The backend startup completed far enough to expose the first-time setup information.
