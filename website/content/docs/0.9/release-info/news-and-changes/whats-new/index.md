+++
title = "What's New"
+++

## OpenID Connect (OIDC) Authentication and Single Sign-On (SSO)

Single sign-on was on my list of essential features from the very beginning. Having one source of truth for authentication and authorization is of great benefit even in the smallest networks with single-digit user counts.

Sambee sports a secure and comprehensive implementation of OpenID Connect to authenticate against IAM servers such as Authelia or Keycloak. If OIDC is configured as the only authentication method, SSO happens behind the scenes, fully transpartent to the user if they're already logged in to the IAM server. Otherwise, a user trying to access Sambee is redirected to the IAM server to authenticate. Once that has happened, they're redirected back to Sambee.

Sambee's [OIDC implementation](../../../admin-guide/authentication/openid-connect-authentication-setup/) comes with auto-provisioning, which creates Sambee user accounts automatically after successful OIDC authentication. This can (and often should) be gated by group membership so that only members of a specific group are allowed access to Sambee. Similarly, Sambee's user roles are assigned depending on group membership. This makes it possible to centrally manage access to Sambee's user roles (e.g., admin) in your IAM system.

### Authentication Configuration Change

Authentication mode is selected only in **Settings** > **Administration** > **Authentication** and defaults to **Password only** for a new installation. The configuration file can only disable enforcement temporarily with `[auth] disable_enforcement = true`; the stored UI mode remains unchanged.

This is a breaking configuration change. `auth_method` is rejected in both `[auth]` and `[security]`, and existing installations are not migrated automatically. Remove the retired key before upgrading.

## Settings & Dialogs Overhaul

The settings got a good UX overhaul that should make them consistent, accessible and, hopefully, much nicer to look at. They're fully responsive, of course, adapting flexibly to phone and desktop screen dimensions. They're also very optimized for efficient keyboard usage while offering touch-friendly sizing on mobile devices.

### New Settings

The settings also gained several new category pages:

- New personal **Account** settings page
- New admin **About** settings page
- New admin **Authentication** settings page
- New admin **Network** settings page
- New admin **SMB** settings page

The about page comes with a feature that way come in handy: creating a **support report** with redacted diagnostic info safe for posting online.

### User Management Page: Visibility Update

The user management page in settings was reimplemented to provide significantly better visibility through search, filtering, sorting, summary shortcuts, and a more compact presentation.

### Dialog Look & Feel

The refreshed and improved look and feel from settings was applied to the various dialogs that are shown when you copy, move, create, or delete files and/or directories. These dialogs now convey more information in a better way than before.

## Dark Theme Polishing

The dark theme got a good new coat of paint. The colors of all elements, including backgrounds, texts, menus, and dialogs were tweaked to ensure visual clarity and eye-soothing contrasts.

## Markdown Editor Improvements

- Lists are normalized (formatted) when saved, using `-` for unordered lists and `1.` for every ordered-list item.
- The editor updates to display the normalized Markdown written to disk after a successful save.
- Unsaved edits are stored in the browser's local storage so they're not lost when re-authenticating, for example.

## SMB Hardening

Taking a client session isolation bug as cue, SMB connection handling has been thoroughly hardened. New settings let administrators require Kerberos authentication and SMB 3+ transport encryption. SMBv1 remains disabled and SMB signing is required for every connection.

## Miscellaneous

- **Deleting multiple files** works correctly.
- The keyboard **shortcuts help** dialog is searchable and resizable.

## Under the Hood

- Security: updated all **dependencies** with known vulnerabilities to fixed versions
- Docker container **logging**: severity reclassification

## Internals

### Release Workflow v2: Docker & Companion Version Lockstep

Sambee has a sophisticated build and release system (see for yourself, the [docs](../../../developer-guide/release-and-versioning/release-overview/) are public). Previously, releases and version numbers of the Docker image and the Companion app were (deliberately) independent. However, it turned out that it's more efficient and natural to increment the versions of both components in sync.

This led to quite the architecture change that started with a redefinition of the version number ([details](../../..//developer-guide/release-and-versioning/product-versioning/)), followed by a second step where the release processes were reworked so that they follow a straightforward pattern:

 1. Increment the version number.
 1. Create a build with that version (Docker image and/or Companion app).
 1. Promote that build to the `test` channel and test.
 1. Promote the build to the `beta` and/or `stable` channels.

 Crucially, in this new model a build is created only once. Releases happen through promoting existing builds. This guarantees that the version that was tested is exactly what is released later on.

### Docker Dev/Prod Images: Shared Runtime Base Architecture

The development (devcontainer) and production Docker images are built off a common shared runtime base. This facilitates maintenance and ensures that the shipped image is identical to the environment the developer tested in.
