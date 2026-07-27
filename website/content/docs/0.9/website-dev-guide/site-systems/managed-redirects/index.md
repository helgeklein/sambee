+++
title = "Managed Redirects"
+++

Managed redirects provide stable `sambee.net` URLs for the product while allowing their destinations to change in a website deployment.

## When To Use A Managed Redirect

Use a managed redirect when product code, documentation, or external communication needs a durable public link whose destination may change. Product code should use a URL under `/mr/`, such as:

```text
https://sambee.net/mr/help-oidc-setup
```

Do not use a managed redirect for ordinary website navigation or a link whose destination is already a stable public contract.

## Source Path Contract

The source path is immutable after release. Treat it as a public API:

- Add a new path for each new long-lived product link.
- Do not rename, remove, or reuse a released `/mr/` path.
- Change the destination by updating its `target` value and deploying the website.

Managed redirects use HTTP `302`, not `301`. This prevents browsers and intermediaries from permanently caching an old destination after the target changes.

## Add A Redirect

Add an entry to `website/data/managed-redirects.toml`:

```toml
[[redirects]]
id = "help-oidc-setup"
source = "/mr/help-oidc-setup"
target = "https://sambee.net/docs/admin-guide/configuration/openid-connect/"
```

Each entry requires:

- A unique `id` for review and maintenance.
- A unique literal `source` that starts with `/mr/` and has no trailing slash, query, fragment, or wildcard.
- An absolute HTTPS `target` without credentials.

The source path is the immutable contract. Only `target` is expected to change after release.

## Build Behavior

`npm run redirects:generate` validates the registry and appends managed rules to the built `public/_redirects` artifact. The generator leaves `website/static/_redirects` unchanged because that file remains the source of legacy documentation redirects.

The normal website build and deployment workflow runs the generator automatically. To check the generated rules locally after a Hugo build, run:

```bash
cd website
npm run redirects:generate
```

The generator fails the build when an entry is malformed, duplicates an ID or source path, or conflicts with an existing legacy redirect rule.

