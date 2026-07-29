+++
title = "Password Authentication"
+++

Password authentication uses Sambee's local username and password form. Select **Password only** in **Settings** > **Administration** > **Authentication** when local credentials should be the only sign-in method.

See [Authentication Overview](../authentication-overview/) to compare all authentication modes.

## Switch to Password-Only Access

The web activation requires at least one active, unexpired administrator with a local password. Before confirmation, Sambee shows how many active, unexpired accounts have no local password and requires explicit acknowledgement that they will lose sign-in access.

Sambee revokes all current sessions only when the configuration and displayed account count are still current. If either changes, Authentication settings reloads the current impact and requires confirmation again.

## Recover From an OIDC Failure

If OIDC prevents web access, run the backend CLI from the application environment:

```bash
cd backend
python -m app.oidc_admin set-mode password-only
```

For Docker Compose, run the same module inside the backend container. The command displays the number of active local-password administrators and active passwordless accounts that will lose access. Review those counts, then type `password-only` exactly to confirm. Sambee rechecks the configuration and both counts before applying the change; if they changed, rerun the command and review the new impact.

The command refuses to proceed if no active local-password administrator exists. For deliberate containment of a compromised identity provider, `set-mode password-only --force` permits the switch after an explicit warning and confirmation. This leaves no usable administrator and is not a credential-reset or login-bypass mechanism. `--force` is rejected when a usable local administrator exists.

