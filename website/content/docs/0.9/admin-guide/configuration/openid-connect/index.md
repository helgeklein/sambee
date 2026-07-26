+++
title = "OpenID Connect Authentication"
+++

Sambee can authenticate users through one OpenID Connect (OIDC) provider. OIDC identities resolve to local Sambee users, and Sambee continues to issue its own application sessions. Provider access and ID tokens are never accepted as Sambee sessions.

## Choose a Sign-In Mode

Sambee supports three database-managed sign-in modes:

| Mode | Login behavior |
|---|---|
| Password only | Shows the local username and password form. |
| OIDC or password | Shows the provider button and local username and password fields on the same page. |
| OIDC only | Starts the provider login transparently. After an explicit logout, Sambee shows a **Sign in again** action instead of immediately logging the user back in. |

Use **OIDC or password** while introducing a provider. Switch to **OIDC only** only after an administrator has completed the interactive test and the recovery procedure has been verified.

## Configure Server Prerequisites

Set these environment variables on the Sambee backend:

| Variable | Purpose |
|---|---|
| `SAMBEE_PUBLIC_URL` | The externally reachable HTTPS origin for Sambee, without a path. |
| `SAMBEE_OIDC_SECRET_KEY` | A persistent Fernet key used to encrypt the client secret and temporary OIDC flow data. |

Generate a key with the backend's installed `cryptography` package:

```bash
python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
```

Store the key in the deployment's secret manager. Back it up separately from the database. Losing it makes the stored client secret unreadable. Changing it without running the rotation command has the same effect.

For `https://files.example.com`, register this exact callback URI at the provider:

```text
https://files.example.com/api/auth/oidc/callback
```

Sambee requires HTTPS outside development. Development HTTP is accepted only for literal loopback hosts. Discovery, JWKS, token, and UserInfo requests use validated outbound connections, do not follow redirects, and reject unsafe resolved addresses.

## Configure the Provider

Create a confidential web client with these properties:

- Authorization Code flow.
- PKCE with `S256`.
- Client authentication with `client_secret_basic` at the token endpoint.
- ID tokens signed with `RS256`.
- The exact Sambee callback URI.
- The `openid` scope and any scopes needed for the configured username, name, email, and groups claims.

Choose a username claim that is stable and unique for every user. Sambee binds identities by the immutable OIDC issuer and subject. It does not automatically link an existing account merely because a returned username matches.

### Authelia Example

The relevant Authelia client entry can look like this. Replace the URLs, policy, client secret, and group names for the deployment.

```yaml
identity_providers:
	oidc:
		clients:
			- client_id: sambee
				client_name: Sambee
				client_secret: '$plaintext$replace-with-a-long-random-secret'
				public: false
				authorization_policy: two_factor
				redirect_uris:
					- https://files.example.com/api/auth/oidc/callback
				scopes:
					- openid
					- profile
					- email
					- groups
				response_types:
					- code
				grant_types:
					- authorization_code
				token_endpoint_auth_method: client_secret_basic
				id_token_signed_response_alg: RS256
```

Consult the Authelia documentation for syntax supported by the installed Authelia version. Store the same plaintext client secret in Sambee's Authentication settings.

## Connect and Test

Open **Settings > Administration > Authentication** as a local administrator.

1. Enter the provider name, issuer URL, client ID, and client secret.
1. Configure scopes and claims.
1. Choose whether all provider users or only selected groups may sign in.
1. Enter exact group names for administrator and editor role mappings. Administrator mapping takes precedence over editor mapping; admitted users without either mapping become viewers.
1. Confirm that the username claim is stable and unique.
1. Select the intended sign-in mode.
1. Select **Connect and test** and complete provider sign-in in the same browser.
1. Verify the returned username, email, and groups.
1. When changing the provider identity namespace, review the proposed provider username for every linked or pending local account. Correct any empty or duplicate usernames.
1. Select **Activate configuration**.

Testing does not change the active configuration. Activation succeeds only when the tested identity resolves to an administrator, the test belongs to the initiating administrator, and the active configuration has not changed since the test began. Leaving the client-secret field blank preserves an existing stored secret.

Changing the provider identity namespace is an explicit identity migration. Sambee removes obsolete identity links and pending mappings only after the administrator reviews a complete replacement plan. The tested administrator is linked directly to the new identity; every other reviewed account receives an exact pending mapping and establishes its immutable identity under the new namespace on its next admitted login. Activation stops if the mapping set changed during testing or if reviewed provider usernames are empty or duplicated.

## Recover Password-Only Access

The web recovery action requires at least one active administrator with a local password. It switches to Password only and revokes all current sessions.

If OIDC prevents web access, run the backend CLI from the application environment:

```bash
cd backend
python -m app.oidc_admin password-only
```

For Docker Compose, run the same module inside the backend container. The command refuses to proceed if no active local-password administrator exists.

## Rotate the Encryption Key

Write a newly generated Fernet key to a root-readable temporary file, then run:

```bash
cd backend
python -m app.oidc_admin rotate-key --new-key-file /run/secrets/sambee-oidc-key-new
```

The command decrypts the stored client secret with the current `SAMBEE_OIDC_SECRET_KEY`, encrypts it with the new key, increments the configuration revision, and invalidates pending OIDC flows. Update `SAMBEE_OIDC_SECRET_KEY` to the new value before restarting Sambee. Keep the old key until the command and restart have both succeeded.

## Export Audit Events

OIDC configuration and identity events are stored in the Sambee database. They do not contain raw subjects, provider tokens, client secrets, authorization codes, nonces, verifiers, or one-time login grants. Events are retained until the database is removed or an external retention process deletes them.

Export the complete audit stream as JSON Lines:

```bash
cd backend
python -m app.oidc_admin export-audit --output sambee-audit.jsonl
```

