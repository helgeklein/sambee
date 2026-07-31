+++
title = "Manage Your Account"
+++

Open **Settings** > **Account** to review the identity Sambee uses for your current sign-in, including your username, optional name and email, and assigned role.

## Sign Out

Select **Sign out** to end the current browser's Sambee session and return to the sign-in page. This does not sign you out of your identity provider.

## Change a Local Password

The **Password** section appears when local password sign-in is available and your account has a local password. Enter your current password, then enter and confirm a new password. Sambee signs out the current browser after a successful change; sign in again with the new password.

When your organization uses **OIDC only**, the Password section is unavailable because local passwords cannot be used to sign in.

## Manage OIDC Browser Sessions

The **Browser sessions** section appears for OIDC sign-ins. It identifies the current browser and shows when each active session was created and last active.

- Select **Sign out** next to the current browser to revoke its OIDC browser session.
- Select **Revoke** to end another browser session.
- Select **Revoke all other sessions** to end every other active OIDC browser session.

Revoking a browser session immediately invalidates its Sambee API tokens. It does not sign the user out of the identity provider itself.

