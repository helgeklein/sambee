+++
title = "What's New"
+++

## OpenID Connect (OIDC) Authentication and Single Sign-On (SSO)

Single sign-on was on my list of essential features from the very beginning. Having one source of truth for authentication and authorization is of great benefit even in the smallest networks with single-digit user counts.

Sambee now sports a secure and comprehensive implementation of OpenID Connect to authenticate against IAM servers such as Authelia or Keycloak. If OIDC is configured as the only authentication method, SSO happens behind the scenes, fully transpartent to the user if they're already logged in to the IAM server. Otherwise, a user trying to access Sambee is redirected to the IAM server to authenticate. Once that has happened, they're redirected back to Sambee.

Sambee's [OIDC implementation](../../../admin-guide/authentication/openid-connect-authentication-setup/) comes with auto-provisioning, which creates Sambee user accounts automatically after successful OIDC authentication. This can (and often should) be gated by group membership so that only members of a specific group are allowed access to Sambee. Similarly, Sambee's user roles are assigned depending on group membership. This makes it possible to centrally manage access to Sambee's user roles (e.g., admin) in your IAM system.

## Markdown Editor

- Lists are normalized (formatted) when saved, using `-` for unordered lists and `1.` for every ordered-list item.
- The editor now updates to display the normalized Markdown written to disk after a successful save.

## Under the Hood

- Security: updated all dependencies with known vulnerabilities to fixed versions
- Docker container logging: severity reclassification

## Internals

### Release Workflow v2: Docker & Companion Version Lockstep

Sambee has a sophisticated build and release system (see for yourself, the [docs](../../../developer-guide/release-and-versioning/release-overview/) are public). Previously, releases and version numbers of the Docker image and the Companion app were (deliberately) independent. However, it turned out that it's more efficient and natural to increment the versions of both components in sync.

This led to quite the architecture change that started with a redefinition of the version number ([details](../../..//developer-guide/release-and-versioning/product-versioning/)), followed by a second step where the release processes were reworked so that they now follow a straightforward pattern:

 1. Increment the version number.
 1. Create a build with that version (Docker image and/or Companion app).
 1. Promote that build to the `test` channel and test.
 1. Promote the build to the `beta` and/or `stable` channels.

 Crucially, in this new model a build is created only once. Releases happen through promoting existing builds. This guarantees that the version that was tested is exactly what is released later on.
