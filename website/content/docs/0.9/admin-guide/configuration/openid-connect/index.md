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

1. Copy the displayed redirect URI and register it on the provider.
1. Enter the provider name, issuer URL, client ID, and client secret. The visibility control reveals only the unsent value in the current browser field; Sambee never returns the stored secret.
1. Configure scopes and claims.
1. Choose whether all provider users or only selected groups may sign in.
1. Enter exact group names for administrator and editor role mappings. Administrator mapping takes precedence over editor mapping; admitted users without either mapping become viewers.
1. Confirm that the username claim is stable and unique.
1. Select **OIDC or password** or **OIDC only**. Use the separate recovery action to switch an active configuration to **Password only**.
1. Select **Connect and test** and complete provider sign-in in the same browser.
1. Verify the returned username, email, groups, matching admission group when group admission is configured, and resulting role. Account mapping does not override admission, and activation remains unavailable unless the tested identity is admitted as an administrator.
1. Adjust the OIDC sign-in mode, admission policy, role mappings, or username-claim uniqueness confirmation as needed. Sambee reevaluates these policy-only changes from the tested identity without another provider login. Changing the provider, scopes, or claim names discards the test and requires **Connect and test** again.
1. Review existing local accounts and select the accounts to map.
1. Select **Activate configuration**, then confirm that the tested identity will be linked to your current administrator account. The confirmation summarizes login and provisioning behavior, shows the exact number of accounts that will be signed out, and identifies when your administrator account is included and which provider you must use to continue.

Testing does not change the active configuration. Activation succeeds only when the tested identity resolves to an administrator, the test belongs to the initiating administrator, and the active configuration has not changed since the test began. Leaving the client-secret field blank preserves an existing stored secret.

The current setup test is retained for the browser tab if the page reloads. If another administrator changes account mappings during review, Sambee reloads the current mapping plan in the same tested flow and discards stale edits. If the provider configuration changed, or the saved test expired, Sambee discards the tested flow and requires another provider test. Temporary network failures retain the flow so the result can be loaded again. If the connection is interrupted during activation, select **Activate configuration** again. Sambee retries the same tested flow and returns the completed activation result when the first request already succeeded.

Select **Cancel** to delete the test's encrypted candidate and tested identity immediately. Closing the page without canceling leaves the test unavailable to other administrators and lets it expire automatically.

### Review Existing Accounts

Initial activation and provider identity namespace replacement both show every existing local account except the administrator who completed the test. Select an account only when its provider username has been confirmed.

The proposed username is a hint unless it comes from a previous pending mapping. Previous pending mappings are selected by default. Last-seen provider usernames and local usernames remain unselected until an administrator confirms them. Provider usernames are matched exactly after surrounding whitespace is removed. The tested administrator and every selected account must use different provider usernames. Creating selected account mappings also requires confirmation that the configured username claim is stable and unique for every user.

Inactive and expired accounts appear separately and cannot be selected. Reactivate an account before mapping it.

In **OIDC or password** mode, accounts may be omitted. An omitted account can continue using its local password when one is configured. Review passwordless omissions carefully because they cannot sign in until an administrator creates a mapping. If an omitted person signs in through OIDC first, their provider username may collide with an existing local account or Sambee may create a separate local account.

In **OIDC only** mode, activation requires a separate acknowledgement for every omitted active account. An omitted account cannot sign in after activation.

Changing the provider identity namespace is an explicit identity migration. Sambee removes obsolete identity links and pending mappings only after the complete replacement plan is reviewed. The tested administrator is linked directly to the new identity. Every selected account receives an exact pending mapping and establishes its immutable identity under the new namespace on its next admitted login. Activation stops if mappings change during review or if selected provider usernames are empty or duplicated.

### Remap All OIDC Accounts

Use **Remap all OIDC accounts** when provider subjects changed even though the issuer, client ID, and claim names stayed the same. This commonly follows an identity-provider reinstall or migration.

Remapping requires another interactive provider test and uses the same account review as initial activation. Confirmation removes current OIDC links and pending mappings, signs out affected users, and creates the reviewed replacements in one transaction. Local users and their data are preserved.

## Manage Account Mappings

Open **Settings > Administration > Users** to review how each local account authenticates. An account may show **Local password**, **OIDC linked**, or both. Established mappings show the provider name and last successful OIDC login. A pending mapping shows the exact provider username that must complete the first admitted OIDC login, who created the mapping, and when it was created.

Administrators can perform these operations:

- Map an unlinked local account to an expected provider username.
- Cancel a pending mapping.
- Change a linked account to a different provider username. This removes the existing immutable identity and creates a pending mapping.
- Use **Advanced OIDC actions** to move an established identity to another active, unlinked local account.
- Use **Advanced OIDC actions** to detach an established identity from a local account.

Changing, moving, or detaching an established identity revokes affected Sambee sessions. Detaching does not revoke access at the identity provider. Remove provider admission separately when the person must no longer sign in.

Mapping updates are atomic and revision checked. If another administrator changes mappings while the page is open, Sambee rejects the stale update; reload the users page and review the current state. In **OIDC only** mode, Sambee prevents removal of the last active OIDC administrator mapping.

Deleting a local user also removes their established identity, pending mappings targeting that user, and incomplete OIDC flows in the same transaction. Pending mappings that the deleted user created for other accounts remain active and show **Deleted user** as their creator. Deletion remains subject to the last-administrator guard.

## Recover Password-Only Access

The web recovery action requires at least one active, unexpired administrator with a local password. Before confirmation, Sambee shows how many active, unexpired accounts have no local password and requires explicit acknowledgement that they will lose sign-in access. It switches to Password only and revokes all current sessions only when the configuration and displayed account count are still current. If either changed, Authentication settings reloads the current impact and requires confirmation again.

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

