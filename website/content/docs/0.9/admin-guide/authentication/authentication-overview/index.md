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

For local-password setup and recovery, see [Password Authentication](../password-authentication/). For provider setup, see [OpenID Connect Authentication](../openid-connect/).

## Initial Setting From the Configuration File

Before an administrator activates an authentication mode in the UI, Sambee uses the configuration file setting `security.auth_method`.

The first successful authentication-mode activation in the UI stores the selected mode in Sambee's database. From then on, the UI setting is authoritative and Sambee ignores later changes to `security.auth_method` in the configuration file.

## No Authentication

**No authentication** is a perimeter-trust mode. Sambee does not validate a user identity, consume reverse-proxy identity headers, or enforce a proxy-specific authorization policy. It assumes that every request reaching Sambee was already authorized by infrastructure you operate.

Before activation, the UI requires an explicit acknowledgement and revokes all active Sambee sessions. Do not enable this mode on a directly reachable service or behind a proxy that does not enforce authentication and access control.

