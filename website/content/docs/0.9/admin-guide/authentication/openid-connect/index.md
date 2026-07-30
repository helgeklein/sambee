+++
title = "OpenID Connect Authentication"
+++

OpenID Connect (OIDC) is Sambee's preferred authentication method.

## Preparation

### Copy OIDC Callback URI

Open **Settings** > **Administration** > **Authentication** and (temporarily) select an OIDC authentication mode. Sambee displays the OIDC callback URI. Copy it; you need it when configuring the OIDC IdP in the next step.

```text
https://files.example.com/api/auth/oidc/callback
```

## Configure the OpenID Connect Identity Provider (IdP)

In your identity provider, create a new OpenID Connect IdP with the following properties:

- Confidential web client
- Authorization code flow
- PKCE with `S256`
- `client_secret_basic` token endpoint authentication
- `RS256`-signed ID tokens
- Sambee's callback URI (see above)
- The scopes `openid`, `profile`, and `email`
   - Add `groups` only when using group admission or group-based role mappings

### Verify the Username Claim

Sambee needs to match OIDC provider usernames to its own usernames. Many OIDC providers return a username in the field `preferred_username` when the `profile` scope is enabled. To ensure that username claim is suitable, verify the following with your OIDC provider:

- How to enable returning the username claim (typically through the `profile` scope).
- The field name of the username claim (typically `preferred_username`).
- The username claim is present for every person who can sign in, stable for that person, and unique across all provider users.

### Authelia Example

The relevant Authelia client entry can look like this:

```yaml
identity_providers:
  oidc:
    clients:
      - client_id: sambee
        client_name: Sambee
        client_secret: '$pbkdf2-sha512$replace-with-a-hashed-random-secret'
        redirect_uris:
          - https://files.example.com/api/auth/oidc/callback
        scopes:
          - openid
          - profile
          - email
          # Add groups when using group admission or group-based role mappings.
          - groups
```

Notes:

- See Authelia's instructions for generating a [hashed client secret](https://www.authelia.com/integration/openid-connect/frequently-asked-questions/#how-do-i-generate-a-client-identifier-or-client-secret).
- Use your own values for the following fields: `redirect_uris`.
- The `profile` scope makes Authelia's `preferred_username` claim available from the username used to sign in, which is exactly what Sambee expects in its default OIDC settings (see below).
- See the [Authelia documentation](https://www.authelia.com/configuration/identity-providers/openid-connect/clients/) more details and default values.

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
| **Client secret** | The matching client secret as plain text (unhashed).<br />On later changes, leave this blank to retain the stored secret. <br />The visibility button only reveals the value currently typed in the browser; Sambee never returns the stored secret. |
| **Scopes** | A comma-separated list. Include `openid` and every scope required to return the claims configured below, such as `profile` and `email`. Add `groups` when using group admission or group-based role mappings. |

### 3. Configure Access

Complete these fields in the **Access** section:

| Sambee field | Value to enter |
|---|---|
| **Admission** | **All authenticated users** is the default. Select **Only selected groups** to require membership in named groups before Sambee evaluates the person's role. |
| **Admission groups** | When **Admission** is **Only selected groups**, enter the exact identity-provider groups that may sign in, separated by commas. |

### 4. Configure Role Assignment

Choose how Sambee assigns roles after an identity passes the admission policy:

| Role assignment | Behavior |
|---|---|
| **All users are assigned to the same role** | Select **Administrator**, **Editor** (default), or **Viewer**. Every admitted user receives that role unless they have an individual assignment. This is the simplest choice for smaller environments. |
| **Group-based** | Enter exact identity-provider groups for **Administrator**, **Editor**, and **Viewer**. A person without an individual assignment must match a configured group; otherwise Sambee denies access. |

In group-based mode, a group can appear in only one role mapping. When a person matches multiple mappings, Sambee grants the highest role: Administrator, then Editor, then Viewer.

During activation (see below), Sambee gives the administrator completing the test an individual **Administrator** assignment. Individual assignments for linked or pending accounts always take precedence over the configured role assignment.

### 5. Advanced Claims

The default claim names work with most OpenID Connect providers. Expand **Advanced claims** only when the provider returns different claim names.

#### Claims

| Sambee field | Value to enter |
|---|---|
| **Username claim** | The stable, unique claim used to identify a person, commonly `preferred_username`. |
| **Name claim** | Optional claim containing the person's display name, commonly `name`. |
| **Email claim** | Optional claim containing the person's email address, commonly `email`. |
| **Groups claim** | Optional claim containing group membership, commonly `groups`. Required only for selected-group admission or group-based role assignment. |

Sambee binds an OIDC identity using its immutable issuer and subject. It does not link an existing local account merely because the returned username matches.

### 6. Connect and Test

Select **Connect and test**. This verifies that:

- Signing in via the specified OIDC configuration succeeds.
- Sambee can read and evaluate the resulting OIDC user identity.
- The tested identity passes the selected admission rule, so the current administrator can keep administrator access after activation.

Review the resulting identity before activation:

- **Username**, **Email**, and **Groups** show the claims Sambee received.
- **Admission** and **Matching admission group** show whether the tested identity passes the admission rule.

OIDC activation remains unavailable unless the tested OIDC identity passes the admission rule to prevent the local admin making the changes from locking themselves out.

### 7. Review Account Mappings and Activate

On first activation, or when you replace the provider's identity namespace, Sambee asks you to review existing local accounts and map them to the correct OIDC provider usernames. If this mapping isn't correct, those people may not be able to sign in.

For each local account:

1. Enter their exact provider username.
   - Verify the name with the OIDC identity provider.
   - Suggested names are only hints unless they come from an existing pending mapping.
1. Leave accounts unselected when you cannot confirm the username.

Each selected username must be unique. Inactive and expired accounts cannot be selected.

In **OIDC or password** mode, unselected accounts can continue using a local password. An unselected passwordless account cannot sign in until it is mapped. In **OIDC only** mode, confirm each unselected active account because it will not be able to sign in after activation otherwise.

Select **Activate configuration** when the review is complete, then confirm the impact shown by Sambee. The administrator who started the setup is linked to the tested provider identity automatically.

Use **Remap all OIDC accounts** when provider subjects change but the issuer, client ID, and claim names stay the same, for example after rebuilding the identity provider. Sambee repeats this review, replaces the existing OIDC links, and signs out affected users. Local accounts and their data remain unchanged.

## Manage Account Mappings

Open **Settings** > **Administration** > **Users** to review how each local account authenticates. An account may show **Local password**, **OIDC linked**, or both. Established mappings show the provider name and last successful OIDC login. A pending mapping shows the exact provider username that must complete the first admitted OIDC login, who created the mapping, and when it was created.

For a linked or pending account, set **OIDC role assignment** to **Administrator**, **Editor**, or **Viewer** to give that person an individual override. Select **Use configured role assignment** to apply the provider's uniform or group-based policy instead. Individual assignments take precedence over the configured policy and work without a groups claim unless selected-group admission requires one.

Administrators can perform these operations:

- Map an unlinked local account to an expected provider username.
- Cancel a pending mapping.
- Change a linked account to a different provider username. This removes the existing immutable identity and creates a pending mapping.
- Use **Advanced OIDC actions** to move an established identity to another active, unlinked local account.
- Use **Advanced OIDC actions** to detach an established identity from a local account.

Changing, moving, or detaching an established identity revokes affected Sambee sessions. Detaching does not revoke access at the identity provider. Remove provider admission separately when the person must no longer sign in.

Mapping updates are atomic and revision checked. If another administrator changes mappings while the page is open, Sambee rejects the stale update; reload the users page and review the current state. In **OIDC only** mode, Sambee prevents removal of the last active OIDC administrator mapping.

Deleting a local user also removes their established identity, pending mappings targeting that user, and incomplete OIDC flows in the same transaction. Pending mappings that the deleted user created for other accounts remain active and show **Deleted user** as their creator. Deletion remains subject to the last-administrator guard.

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
