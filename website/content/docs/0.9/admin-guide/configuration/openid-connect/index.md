+++
title = "OpenID Connect Authentication"
+++

Sambee can authenticate users through OpenID Connect (OIDC). OIDC identities resolve to local Sambee users.

## Choose an Authentication Mode

Open **Settings** > **Administration** > **Authentication** and choose the mode before configuring any provider fields. Sambee supports four modes:

| Mode | Login behavior |
|---|---|
| No authentication | Sambee does not authenticate users. Use this only when a trusted reverse proxy or network perimeter controls all access to Sambee. |
| Password only | Shows the local username and password form. |
| OIDC or password | Shows the OIDC login and local username/password fields on the same page. |
| OIDC only | Starts the OIDC login transparently. |

Use **OIDC or password** while introducing OIDC. Switch to **OIDC only** only after an administrator has completed the interactive test and the recovery procedure has been verified. Select **Password only** when local credentials should be the only sign-in method.

### Initial Setting Read From Configuration File

Before an administrator activates an authentication mode in the UI, Sambee uses the configuration file setting `security.auth_method`.

The first successful authentication-mode activation in the UI stores the selected mode in Sambee's database. From then on, the UI setting is authoritative and Sambee ignores later changes to `security.auth_method` in the configuration file.

### No Authentication

"No authentication" mode is a perimeter-trust mode in which Sambee doesn't validate a user identity, consume reverse-proxy identity headers, or enforce a proxy-specific authorization policy. It assumes that every request reaching Sambee was already authorized by infrastructure you operate.

Before activation, the UI requires an explicit acknowledgement and revokes all active Sambee sessions. Do not enable this mode on a directly reachable service or behind a proxy that does not enforce authentication and access control.

## Configure Network Settings

### Public URL

Open **Settings** > **Administration** > **Network** and set **Public URL** to Sambee's externally reachable HTTPS origin, e.g.:

```text
https://files.example.com
```

Notes:

- Changing the public URL cancels incomplete OIDC sign-ins and tests. Register the new callback URI before activating an OIDC-only configuration.

### OIDC Callback URI

Once the public URL is set, Sambee displays the OIDC callback URI (which you'll need later), e.g.:

```text
https://files.example.com/api/auth/oidc/callback
```

### Reverse Proxy IP Ranges

Configure **Trusted reverse proxy CIDRs** when all of the following is true:

- A reverse proxy sits in front of Sambee.
- The proxy forwards the original visitor IP address.
- You want Sambee to use that address for authentication request limits.

Enter the IP addresses or network ranges of the proxies that connect directly to Sambee; do not enter end-user networks or arbitrary private ranges.

#### Example

If Nginx at `10.20.30.15` is the only server that can reach Sambee and it forwards `X-Forwarded-For`, enter `10.20.30.15/32`.

## Configure the OpenID Connect Identity Provider (IdP)

Prepare the IAM server (the machine that acts as OpenID Connect provider for Sambee) by creating a new OpenID Connect IdP with the following properties:

- Confidential web client
- Authorization code flow
- PKCE with `S256`
- Client authentication with `client_secret_basic` at the token endpoint
- ID tokens signed with `RS256`
- Sambee's callback URI (see above) registered as callback/redirect URI
- The scopes `openid`, `profile`, `email`, `groups`

### Choose the Username Claim

Sambee needs to know which field from the user data returned from the provider it can use to match the IdP's user account to an account in Sambee's local database of users. This field is called the username claim.

The username claim value must be present for every person who can sign in, stable for that person, and unique across all provider users. Confirm this from the identity provider's attribute documentation and user data.

Sambee uses the username claim:

- to create and review pending mappings between IdP users and Sambee users, and
- to match an IdP account to a pending mapping when the person first signs in.

Once a person first signed in, Sambee creates an identity link from the provider's immutable issuer and subject field values.

### Authelia Example

The relevant Authelia client entry can look like this:

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

Notes:

- Use your own values for the following fields: `client_secret`, `authorization_policy`, `redirect_uris`.
- The `profile` scope makes Authelia's `preferred_username` claim available from the username used to sign in, which is exactly what Sambee expects in its default OIDC settings (see below).
- Consult the Authelia documentation for syntax supported by your installed Authelia version.

## Configure Sambee

Open **Settings** > **Administration** > **Authentication**.

### 1. Choose the Sign-In Mode

Select one of these values in **Authentication mode**:

- **OIDC or password**
- **OIDC only**

### 2. Enter Provider Details

Complete these fields in the **Provider** section:

| Sambee field | Value to enter |
|---|---|
| **Provider name** | A recognizable name for the provider, such as `Authelia` or `Microsoft Entra ID`. |
| **Issuer URL** | The provider's HTTPS issuer URL. For Authelia, this is normally the externally reachable URL of the Authelia portal, such as `https://auth.example.com`. <br />Open `https://auth.example.com/.well-known/openid-configuration` and enter the exact value of its `issuer` field. |
| **Client ID** | The client ID configured in the OIDC IdP. |
| **Client secret** | The matching client secret. <br />On later changes, leave this blank to retain the stored secret. <br />The visibility button only reveals the value currently typed in the browser; Sambee never returns the stored secret. |
| **Scopes** | A comma-separated list. Include `openid` and every scope required to return the claims configured below, such as `profile`, `email`, and `groups`. |

### 3. Configure Access

Complete these fields in the **Access** section:

| Sambee field | Value to enter |
|---|---|
| **Admission** | Select **All authenticated users** to admit every provider user, or **Only selected groups** to limit access to named groups. |
| **Admission groups** | When **Admission** is **Only selected groups**, enter the exact identity-provider groups that may sign in, separated by commas. |
| **Administrator groups** | Enter the exact identity-provider groups whose members should administer Sambee, separated by commas. At least one administrator group is required. |
| **Editor groups** | Optionally enter the exact identity-provider groups whose members should be able to edit content but not administer Sambee, separated by commas. |

Group names are matched exactly after surrounding whitespace is removed. A group cannot be both an administrator and editor group. Administrator mapping takes precedence over editor mapping; admitted users with neither mapping become viewers.

### Advanced Claims

The default claim names work with most OpenID Connect providers. Expand **Advanced claims** only when the provider returns different claim names.

| Sambee field | Value to enter |
|---|---|
| **Username claim** | The stable, unique claim used to identify a person, commonly `preferred_username`. |
| **Name claim** | Optional claim containing the person's display name, commonly `name`. |
| **Email claim** | Optional claim containing the person's email address, commonly `email`. |
| **Groups claim** | Optional claim containing group membership, commonly `groups`. |

Sambee binds an OIDC identity using its immutable issuer and subject. It does not link an existing local account merely because the returned username matches.

### 4. Connect and Test

Select **Connect and test**, then complete provider sign-in in the same browser. This test does not change the active configuration.

Review the resulting identity before activation:

- **Username**, **Email**, and **Groups** show the claims Sambee received.
- **Admission** and **Matching admission group** show whether the identity may sign in.
- **Resulting role** shows the role the configured group mappings grant.

Activation remains unavailable unless the tested identity is admitted as an administrator. Account mapping does not override admission.

You can change **Authentication mode**, **Admission**, **Admission groups**, **Administrator groups**, or **Editor groups** while reviewing the result. Sambee reevaluates these access-policy changes without another provider login. Changing **Provider name**, **Issuer URL**, **Client ID**, **Client secret**, **Scopes**, or any claim field discards the test and requires **Connect and test** again.

### 5. Review Accounts and Activate

Review existing local accounts and select the accounts to map. Then select **Activate configuration** and confirm the displayed impact. Sambee links the tested identity to the current administrator account, summarizes the sign-in and provisioning behavior, shows the exact number of accounts that will be signed out, and identifies whether the current administrator must sign in through the provider afterward.

Activation succeeds only when the tested identity belongs to the initiating administrator, resolves to an administrator, and the active configuration has not changed since the test began.

The current test is retained for the browser tab if the page reloads. If another administrator changes account mappings, Sambee reloads the current mapping plan and requires another review. If the provider configuration changes or the test expires, Sambee discards the test and requires a new provider sign-in. Temporary network failures retain the test so its result can be loaded again. If activation is interrupted, the browser retains the exact request until Sambee returns a definitive result; reloading can recover a completed activation without repeating its changes.

While an activation result is unresolved, Sambee disables provider settings, account mappings, cancellation, remapping, and Password-only recovery. A failure to reload settings after Sambee confirms activation does not undo the activation; reload the page to display the active configuration.

Select **Cancel** to delete the test's encrypted candidate and tested identity immediately. Closing the page without selecting **Cancel** leaves the test unavailable to other administrators and lets it expire automatically.

### Review Existing Accounts

Initial activation and provider identity namespace replacement both show every existing local account except the administrator who completed the test. Select an account only when its provider username has been confirmed.

The proposed username is a hint unless it comes from a previous pending mapping. Previous pending mappings are selected by default. Last-seen provider usernames and local usernames remain unselected until an administrator confirms them. Provider usernames are matched exactly after surrounding whitespace is removed. The tested administrator and every selected account must use different provider usernames.

Inactive and expired accounts appear separately and cannot be selected. Reactivate an account before mapping it.

In **OIDC or password** mode, accounts may be omitted. An omitted account can continue using its local password when one is configured. Review passwordless omissions carefully because they cannot sign in until an administrator creates a mapping. If an omitted person signs in through OIDC first, their provider username may collide with an existing local account or Sambee may create a separate local account.

In **OIDC only** mode, activation requires a separate acknowledgement for every omitted active account. An omitted account cannot sign in after activation.

Changing the provider identity namespace is an explicit identity migration. Sambee removes obsolete identity links and pending mappings only after the complete replacement plan is reviewed. The tested administrator is linked directly to the new identity. Every selected account receives an exact pending mapping and establishes its immutable identity under the new namespace on its next admitted login. Activation stops if mappings change during review or if selected provider usernames are empty or duplicated.

### Remap All OIDC Accounts

Use **Remap all OIDC accounts** when provider subjects changed even though the issuer, client ID, and claim names stayed the same. This commonly follows an identity-provider reinstall or migration.

Remapping requires another interactive provider test and uses the same account review as initial activation. Confirmation removes current OIDC links and pending mappings, signs out affected users, and creates the reviewed replacements in one transaction. Local users and their data are preserved.

## Manage Account Mappings

Open **Settings** > **Administration** > **Users** to review how each local account authenticates. An account may show **Local password**, **OIDC linked**, or both. Established mappings show the provider name and last successful OIDC login. A pending mapping shows the exact provider username that must complete the first admitted OIDC login, who created the mapping, and when it was created.

Administrators can perform these operations:

- Map an unlinked local account to an expected provider username.
- Cancel a pending mapping.
- Change a linked account to a different provider username. This removes the existing immutable identity and creates a pending mapping.
- Use **Advanced OIDC actions** to move an established identity to another active, unlinked local account.
- Use **Advanced OIDC actions** to detach an established identity from a local account.

Changing, moving, or detaching an established identity revokes affected Sambee sessions. Detaching does not revoke access at the identity provider. Remove provider admission separately when the person must no longer sign in.

Mapping updates are atomic and revision checked. If another administrator changes mappings while the page is open, Sambee rejects the stale update; reload the users page and review the current state. In **OIDC only** mode, Sambee prevents removal of the last active OIDC administrator mapping.

Deleting a local user also removes their established identity, pending mappings targeting that user, and incomplete OIDC flows in the same transaction. Pending mappings that the deleted user created for other accounts remain active and show **Deleted user** as their creator. Deletion remains subject to the last-administrator guard.

## Switch to Password-Only Access

Select **Password only** in **Settings** > **Administration** > **Authentication**. The web activation requires at least one active, unexpired administrator with a local password. Before confirmation, Sambee shows how many active, unexpired accounts have no local password and requires explicit acknowledgement that they will lose sign-in access. It revokes all current sessions only when the configuration and displayed account count are still current. If either changed, Authentication settings reloads the current impact and requires confirmation again.

If OIDC prevents web access, run the backend CLI from the application environment:

```bash
cd backend
python -m app.oidc_admin set-mode password-only
```

For Docker Compose, run the same module inside the backend container. The command displays the number of active local-password administrators and active passwordless accounts that will lose access. Review those counts, then type `password-only` exactly to confirm. Sambee rechecks the configuration and both counts before applying the change; if they changed, rerun the command and review the new impact.

The command refuses to proceed if no active local-password administrator exists. For deliberate containment of a compromised identity provider, `set-mode password-only --force` permits the switch after an explicit warning and confirmation. This leaves no usable administrator and is not a credential-reset or login-bypass mechanism. `--force` is rejected when a usable local administrator exists.

## Export Audit Events

OIDC configuration and identity events are stored in the Sambee database. They do not contain raw subjects, provider tokens, client secrets, authorization codes, nonces, verifiers, or one-time login grants. Events are retained until the database is removed or an external retention process deletes them.

Export the complete audit stream as JSON Lines:

```bash
cd backend
python -m app.oidc_admin export-audit --output sambee-audit.jsonl
```

## Authentication Request Limits

Sambee enforces authentication limits in the application. A reverse proxy may add stricter limits but does not replace these defaults:

| Request | Default limit |
|---|---|
| Start OIDC authorization | 20 requests per source IP per 5 minutes |
| Process OIDC callback | 60 requests per source IP per 5 minutes |
| Exchange OIDC login grant | 30 requests per source IP per 5 minutes |
| Password sign-in | 10 attempts per source IP per 5 minutes and 10 attempts per submitted username per 15 minutes |

Limits refill continuously. A rejected API request returns `Retry-After`; browser-based OIDC requests return to the login page with a generic retry message. Password forms larger than 64 KiB are rejected before parsing. These responses do not expose account existence, the active sign-in mode, provider payloads, or submitted credentials.
