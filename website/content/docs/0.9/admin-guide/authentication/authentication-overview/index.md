+++
title = "Authentication Overview"
+++

Sambee supports multiple authentication modes: OpenID Connect (OIDC), local passwords, and no authentication (perimeter-trust mode).

To configure Sambee authenticaion, open **Settings** > **Administration** > **Authentication**.

## Choose an Authentication Mode

| Mode | Login behavior | User management |
|---|---|---|
| No authentication | Sambee does not authenticate users. Use this only when a trusted reverse proxy or network perimeter controls all access to Sambee. | Creating users and managing local passwords are unavailable. |
| Password only (default) | Shows the local username and password form. | Administrators can create users and set or reset local passwords. |
| OIDC or password | Shows the OIDC login and local username/password fields on the same page. | Administrators can create local-password users. OIDC also provisions passwordless users after an admitted sign-in. |
| OIDC only | Starts the OIDC login transparently. | Sambee provisions passwordless users after their first admitted OIDC sign-in. Manual user creation and local-password management are unavailable. |

Use **OIDC or password** while introducing OIDC. Switch to **OIDC only** only after an administrator has completed the interactive test and verified the recovery procedure. Select **Password only** when local credentials should be the only sign-in method.

For local-password setup and recovery, see [Password Authentication](../password-authentication/). For provider setup, see [OpenID Connect Authentication Setup](../openid-connect-authentication-setup/).

## Authentication Configuration

Sambee stores the selected authentication mode in its database. New installations default to **Password only** until an administrator selects another mode in **Settings** > **Administration** > **Authentication**.

The [configuration file](../../reference/configuration-file-reference) has one authentication-related runtime override: it bypasses authentication enforcement without changing the mode saved in the UI. This override is useful mainly during development.

## No Authentication

**No authentication** is a perimeter-trust mode. Sambee does not validate a user identity, consume reverse-proxy identity headers, or enforce a proxy-specific authorization policy. It assumes that every request reaching Sambee was already authorized by infrastructure you operate.

Before activation, the UI requires an explicit acknowledgement and revokes all active Sambee sessions. Do not enable this mode on a directly reachable service or behind a proxy that does not enforce authentication and access control.

Sambee keeps existing user records and local password hashes when you select this mode, but does not use them for authentication. User Management does not offer manual user creation or local-password resets until you select a password-capable mode.

