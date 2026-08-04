+++
title = "Authentication Overview"
+++

Sambee supports multiple authentication modes: OpenID Connect (OIDC), local passwords, and no authentication (perimeter-trust mode).

To configure Sambee authenticaion, open **Settings** > **Administration** > **Authentication**.

## Choose an Authentication Mode

| Mode | Login behavior |
|---|---|
| No authentication | Sambee does not authenticate users. Use this only when a trusted reverse proxy or network perimeter controls all access to Sambee. |
| Password only | Shows the local username and password form. |
| OIDC or password | Shows the OIDC login and local username/password fields on the same page. |
| OIDC only | Starts the OIDC login transparently. |

Use **OIDC or password** while introducing OIDC. Switch to **OIDC only** only after an administrator has completed the interactive test and verified the recovery procedure. Select **Password only** when local credentials should be the only sign-in method.

For local-password setup and recovery, see [Password Authentication](../password-authentication/). For provider setup, see [OpenID Connect Authentication Setup](../openid-connect-authentication-setup/).

## Authentication Configuration

Sambee stores the selected authentication mode in its database. New installations default to **Password only** until an administrator selects another mode in **Settings** > **Administration** > **Authentication**.

The configuration file does not select an authentication mode. It has one authentication-related runtime override: `[auth] disable_enforcement = true`. This bypasses authentication enforcement without changing the mode saved in the UI. The Authentication page displays a warning while the override is active; UI changes are saved but cannot take effect until you remove the override and restart Sambee.

`auth_method` is no longer supported in either `[auth]` or `[security]`. Sambee rejects it during startup. Update the configuration manually; existing installations are not migrated automatically.

## No Authentication

**No authentication** is a perimeter-trust mode. Sambee does not validate a user identity, consume reverse-proxy identity headers, or enforce a proxy-specific authorization policy. It assumes that every request reaching Sambee was already authorized by infrastructure you operate.

Before activation, the UI requires an explicit acknowledgement and revokes all active Sambee sessions. Do not enable this mode on a directly reachable service or behind a proxy that does not enforce authentication and access control.

