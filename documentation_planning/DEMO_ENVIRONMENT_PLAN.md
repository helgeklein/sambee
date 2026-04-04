# Public Demo Environment Plan

## Purpose

This document defines the long-term plan for a public Sambee demo environment that:

- works fully in the browser without requiring the companion
- supports the companion as an optional enhancement
- uses realistic, attractive demo data
- can serve multiple concurrent users safely
- is resilient against abuse and denial-of-service pressure
- evolves through clean, testable, security-conscious architecture

The goal is not to solve everything in one iteration. The goal is to provide a phased plan so work can proceed issue-by-issue without creating architectural debt.

## Design Principles

### Clean architecture

- Keep demo-specific policy separate from core file browsing logic.
- Prefer explicit domain concepts over configuration hacks.
- Enforce policy at well-defined boundaries: edge, app, and storage.
- Make demo-specific components removable if the feature is ever retired.

### Security

- Treat the public demo as an adversarial surface.
- Assume signup, auth, and file access endpoints will be probed and abused.

### Efficiency

- Use read-only data wherever possible.
- Prefer deterministic data generation and inexpensive hosting.
- Avoid per-user infrastructure unless it meaningfully improves safety or UX.
- Optimize for low ongoing operator effort.

## Current State

### What Sambee already supports well

- Browser-based browsing and previewing is the core experience.
- The companion is optional for desktop-app workflows.
- Shared connections already exist.
- A Docker-based deployment path already exists.
- The viewer stack already showcases images, PDFs, and Markdown well.

### Important gaps for a public demo

- There is no first-class read-only connection or read-only user model yet.
- Shared visibility is not the same as read-only authorization.
- `auth_method = "none"` is not suitable for a public demo because requests resolve as the admin user.
- A single shared demo account would cause server-side user-settings collisions and poor attribution.
- There is no generic invitation flow, expiring-user capability, or public admission flow yet.
- There is no demo-data generation pipeline yet.

## Recommended End State

### Product posture

The public demo should be browser-first and read-only by default.

The companion should remain optional:

- the demo must be fully useful without it
- the demo should never depend on companion installation for core evaluation

### Infrastructure posture

The demo should run behind a CDN/WAF layer with origin shielding and strict edge controls.

Recommended baseline deployment:

- Cloudflare in front of the public hostname
- one small VM running Docker Compose
- Caddy reverse proxy with TLS
- Sambee application container
- second container with Samba or equivalent SMB endpoint for the demo share
- persistent volume for Sambee application state
- read-only mounted demo asset volume for the SMB share

This architecture keeps cost low and adds storage-level read-only as a second line of defense behind Sambee's own read-only authorization model.

### Data posture

The first public demo should use one canonical shared data set that all users browse concurrently.

From the first implementation:

- keep the scope to one global dataset rather than multiple themed datasets
- enforce read-only in Sambee via read-only connections and/or read-only users
- enforce read-only at the storage/share layer as defense in depth
- do not allow file mutation in the shared demo environment

## Threat Model

### Main threats

- Layer 7 floods against the main app or registration endpoints
- automated signup or access-code farming
- credential sharing and uncontrolled session growth
- scraping of demo data or metadata at very high rate
- abuse of expensive viewer endpoints, especially conversion-heavy image formats
- origin exposure bypassing CDN/WAF protections
- operational instability due to one noisy visitor or bot cohort

### Non-goals

- Hiding that a demo exists
- Preventing all copying of visible demo content
- Providing anonymous unlimited access from day one

## Access Strategy

## Recommendation

Do not make the demo openly anonymous.

Use a lightweight registration and approval flow that issues a real Sambee invitation. Email-based access is a good fit if it is implemented as a narrow, abuse-resistant admission layer on top of a generic invitation and expiring-user capability.

The initial launch should be fully automatic rather than manually moderated, but operators should be notified when access is granted so activity remains visible.

Recommended initial model:

1. Visitor requests demo access with email address and minimal metadata.
2. Edge challenge runs before the request reaches the app.
3. App applies local rate limits and reputation checks.
4. If accepted, the app creates or issues a short-lived invitation for a constrained Sambee user.
5. The visitor redeems the invitation via emailed link or code.
6. Redemption creates the real Sambee user only after email verification has completed.
7. The invited user receives limited capabilities and a short expiry.

This provides a friction step that reduces abuse, gives observability, avoids shared-account collisions, and keeps the service from being trivially burned by bots.

## Why email-based access is reasonable

- It is understandable to real users.
- It gives a concrete abuse-control point.
- It can be rate-limited independently from core browsing.
- It supports operator notifications and future escalation paths without changing the main UX model.

## Recommended access-control layers

### Layer 1: edge protection

Use Cloudflare or equivalent for:

- CDN/proxying
- WAF
- bot mitigation
- rate limiting
- origin IP shielding
- caching of static frontend assets

Recommended edge rules:

- protect the public invitation-request endpoint with Turnstile or equivalent
- apply strict rate limits to signup, login, and code redemption endpoints
- apply moderate rate limits to expensive viewer paths
- challenge or block obviously automated traffic patterns
- block direct origin access at the firewall so only the proxy can reach it

### Layer 2: application admission control

Keep the public demo landing page and abuse checks separate from the generic invitation system.

Suggested domain concepts:

- `Invitation`
- `InvitationPolicy`
- `InvitationRedemption`
- `AbuseSignal`
- `AdmissionDecision`

Responsibilities:

- accept public invitation requests
- run reputation, cooldown, and allowlist checks
- issue invitation links or codes
- create constrained users on redemption
- enforce invitation and account expiry
- cap concurrent sessions per email and per IP range
- support revocation and temporary blocking
- emit metrics and audit logs
- notify operators when invitations are issued or redeemed

### Layer 3: session scoping

Invited demo users should be real product users with narrower-than-normal sessions.

Recommended constraints:

- short-lived sessions
- limited refresh lifetime
- invitation-assigned role, capability set, or policy profile
- no access to admin surfaces
- no write operations in the demo environment
- fast account expiry for public-demo users
- optional maximum concurrent sessions per identity

### Layer 4: authorization and storage enforcement

Even if app policy fails, the demo content should remain read-only.

Primary recommendation:

- add first-class read-only connections and/or read-only users in Sambee
- reject write endpoints before they reach backend storage operations
- expose precise read-only state in the UI

Defense-in-depth recommendation:

- export the SMB demo share as read-only
- mount demo source files read-only into the Samba container

## Access-flow model

### Self-service email code

Pros:

- lowest friction that still gives abuse control
- easiest to explain
- good telemetry

Cons:

- requires transactional email infrastructure
- disposable email abuse still needs mitigation

Recommendation:

- best initial public-demo model
- fully automatic at launch, with admin notifications on successful access issuance

## Anti-abuse Controls

### Signup and email flow controls

- challenge request forms with Turnstile or equivalent
- rate-limit by IP, IP range, and email address
- rate-limit by destination domain for disposable-domain bursts
- enforce resend cooldowns
- require invitation-link or code expiry windows that are short and explicit
- store hashed invitation secrets, not plaintext values
- record risk flags for repeated failure patterns
- send operator notifications for successful invitation issuance and redemption events

### Session controls

- session TTL shorter than normal product accounts
- optional idle timeout
- per-account and per-IP concurrent-session caps
- invited-user account expiry enforced at auth time
- revoke all sessions when abuse score crosses threshold

### Browsing controls

- request rate limits on listing and viewer endpoints
- stricter rate limits on conversion-heavy image previews
- circuit breakers for unusually expensive conversion bursts
- response caching for immutable demo assets where feasible

### Infrastructure controls

- keep origin behind reverse proxy only
- firewall origin to Cloudflare ranges or equivalent
- separate public hostname from internal service addressing
- monitor CPU, memory, request rate, and conversion latency
- prepare a degraded mode that temporarily disables expensive conversions under pressure

## Proposed Product Architecture Changes

## New backend concepts

Introduce a generic invitation and expiring-user module, with a thin demo-specific admission layer that uses it.

Suggested package layout:

```text
backend/app/
  invitations/
    models.py
    policy.py
    service.py
    rate_limits.py
    email.py
    tokens.py
  admission/
    demo.py
  api/
    invitations.py
    public_demo.py
```

Suggested model boundaries:

- `Invitation`: invitation record, target email, scope, secret hash, issuer, and expiry
- `InvitationPolicy`: central source of truth for invitation limits and default scopes
- `InvitationRedemption`: redemption event and audit metadata
- `AdmissionDecision`: result of public demo checks before invitation issuance
- user expiry fields and services: account lifetime, expiration reason, and cleanup behavior

Recommended default behavior:

- invitations should create users only at redemption time after email verification succeeds
- invited users should default to a short-lived, constrained profile suitable for the public demo

Keep invitation and user-lifecycle concerns generic. Keep demo-specific screening and rate-limiting policy out of the core auth model where possible.

## New authorization concept

Add explicit capabilities or policies for demo use.

Example direction:

- `VIEW_DEMO`
- `USE_COMPANION_DEMO`
- `WRITE_DEMO` should not exist for public demo users

Core implementation direction:

- support read-only connections in core authorization logic
- support invited users with constrained roles, capabilities, or policy profiles
- support expiring users or expiring access grants as a first-class concept
- treat SMB-level read-only as supporting infrastructure, not as the primary policy mechanism

## Frontend changes

- add a public landing page for demo access
- add a public invitation-request flow
- add invitation redemption or magic-link completion flow
- display demo environment notices clearly
- suppress or disable write actions when the current connection/session is read-only
- keep companion affordances visible but never required

## Invitation and expiry model

Invitation and expiry should be generic Sambee capabilities, not demo-only features.

Required properties:

- an invitation can target a real Sambee user account or create one at redemption time
- invitations carry a constrained access profile suitable for the target use case
- invitations expire quickly and cannot be redeemed twice (they must "survive" inspection by email security products, though)
- invited accounts or access grants can expire automatically and be rejected during authentication
- operators can revoke invitations and invited-user access cleanly

Preferred public-demo behavior:

- create users at redemption time so accounts are only created after email verification succeeds
- do not pre-create expiring demo users before invitation redemption

The public demo should use this generic machinery with tighter defaults than ordinary invited access.

## Read-only model

Read-only must be a first-class Sambee capability from the start of implementation.

Required properties:

- a connection can be marked read-only, or a user/session can be constrained to read-only access, or both
- write endpoints are rejected in Sambee before any backend storage operation starts
- the UI shows clear read-only state and suppresses write affordances
- demo SMB shares are also exported read-only as defense in depth

This layered model improves UX, correctness, and security.

## Demo Data Strategy
## Objectives

The demo data should:

- look realistic and attractive
- exercise the best parts of Sambee’s viewer stack
- be safe to publish
- be reproducible from source code and manifests
- avoid copyright ambiguity
- prefer real public-domain assets wherever practical
- remain small enough for inexpensive hosting and fast resets

## Recommended content mix

The first dataset should be intentionally curated around Sambee’s current strengths.

### Directory design

The demo tree should intentionally showcase directory search, not just file previews.

Requirements:

- most content should live in a two-level folder hierarchy
- folder names should be descriptive and somewhat long so search results are meaningful
- sibling folders should use realistic business naming patterns rather than terse labels

Use a plausible organization with descriptive department and project folders, for example:

- `Marketing Campaign Assets/Product Launch Spring Collection/`
- `Product Planning/Roadmap and Release Coordination/`
- `Sales Enablement/Regional Account Presentation Library/`
- `Customer Support/Knowledge Base Drafts and Escalations/`
- `Operations/Vendor Contracts and Renewal Tracking/`
- `Brand Management/Visual Identity and Usage Guidelines/`
- `Photo Library/Team Events and Workspace Photography/`
- `Engineering/Architecture Notes and Implementation Specs/`

This makes browsing feel real and gives directory search something worth showing off.

### File-type mix

Prioritize:

- polished Markdown files
- well-formatted PDFs
- visually strong images in browser-native formats
- a smaller set of conversion-heavy image formats to showcase server-side conversion

Examples:

- Markdown project briefs, release notes, architecture notes, onboarding docs
- PDFs for invoices, brochures, specs, reports, org charts, one-pagers
- PNG/JPEG/WebP product imagery, brand assets, diagrams, screenshots
- TIFF/PSD/AI/EPS examples for advanced-preview demonstrations

## How to generate realistic data

### Core approach

Use a deterministic seeded generator with a manifest.

Recommended toolchain:

- `Faker` for names, addresses, companies, dates, product names, tickets, and narrative fragments
- `ReportLab` for clean multi-page PDFs with tables, headers, charts, and branded layouts
- `Pillow` for branded diagrams, simple mockups, thumbnails, and image post-processing where needed
- curated imports of real public-domain images and documents wherever possible
- existing ImageMagick-based conversion techniques for special-format assets where needed

### Deterministic generation requirements

- fixed seed
- manifest-driven outputs
- stable directory structure
- source templates stored in repo
- generated artifacts either excluded from git or committed intentionally in a dedicated demo-data location depending on final size

### Data model for generation

Use structured scenario packs instead of pure random noise.

Suggested scenario domains:

- fictitious company profile
- teams and employees
- customers and leads
- projects and releases
- support incidents
- product catalog
- brand system

Example scenario output:

- one product launch brief in Markdown
- one design-spec PDF
- one product brochure PDF
- one folder of curated event or workplace photos
- one PSD or TIFF source asset for the same campaign

This creates cross-file coherence, which matters more than randomness.

The first dataset should be partly curated from real public-domain assets wherever possible and only generated where necessary.

## Making the data look good

### Documents

- use a consistent fictitious brand identity
- define a small color system and typography pairing for generated PDFs
- include cover pages, simple charts, pull quotes, and tables
- vary document tone by department

### Markdown

- use headings, lists, code fences, tables, links, blockquotes, and images
- include a few longer polished docs, not just lorem ipsum stubs
- keep content plausible for the fictional company domain

### Images

Prefer curated real photography over fully synthetic imagery.

Use a mix of:

- curated public-domain photographs and other public-domain visual assets wherever possible
- generated supporting graphics such as charts, posters, diagrams, labels, and social-media creatives
- light post-processing or resizing of imported images where needed

Preferred licensing posture:

- prefer assets that are clearly in the public domain
- use non-public-domain assets only when their license clearly permits free use and modification in apps and websites
- avoid standalone redistribution of source imagery outside the demo dataset context
- avoid images with recognizable brands, logos, or implied endorsement risk
- preserve source URL, creator, platform, download date, and any usage notes in a manifest

Public-domain repositories should be preferred when the available quality is good enough. Pexels and Pixabay can still be useful fallback sources because both allow free use, modification, and no-attribution-required workflows, but both also prohibit misleading endorsement and standalone resale or redistribution of unmodified assets. The manifest should track provenance so the team can review each imported asset later.

## Demo-data generator architecture

Suggested layout:

```text
tools/demo_data/
  generator.py
  manifest.schema.json
  imported_assets_manifest.json
  scenarios/
    company.toml
    marketing.toml
    support.toml
  templates/
    markdown/
    pdf/
    image/
  assets/
    fonts/
    icons/
  output/
```

Suggested outputs:

- generated file tree for the SMB demo share
- manifest with provenance and regeneration metadata
- screenshots or thumbnails for QA review
- imported-asset provenance ledger for every curated public-domain or permissively licensed asset

## Quality gates for demo data

- visually review a sample set before publishing
- verify that the directory tree is rich enough to make directory search impressive
- validate that every generated file opens correctly in Sambee
- validate PDF rendering quality
- validate Markdown formatting quality
- validate advanced image formats exercise conversion paths successfully
- record provenance and license review notes for every imported asset

## Hosting Strategy

## Recommended first hosting target

Use a small VM with Docker Compose.

Reasons:

- simplest way to host Sambee plus a private SMB service
- lowest operational complexity
- easiest place to enforce read-only mounts
- predictable costs
- easy to move later if needed

## Why not start with platform PaaS?

Render, Railway, and Fly.io can host a single-instance stateful demo, but the public demo needs an internal SMB dependency and a simple, inspectable read-only data path. A VM is the cleanest first implementation.

PaaS can still be revisited later if the architecture changes to remove the internal SMB dependency.

## Observability and Operations

## Metrics to collect from day one

- request volume by endpoint
- signup attempts and success rate
- challenge failure rate
- email send rate and delivery failures
- invitation redemption rate
- active invited demo users
- operator notification delivery success and failures
- per-endpoint latency
- expensive conversion counts and timings
- origin CPU, memory, disk, and network

## Alert conditions

- sustained spike in signup attempts
- high code resend volume
- sudden increase in viewer conversion latency
- high 429 or WAF challenge rate
- elevated origin CPU or memory
- email delivery degradation
- operator notification delivery degradation

## Operational controls

- ability to disable new registrations temporarily
- ability to revoke a specific invitation or invited user
- ability to place the demo in browse-only degraded mode
- ability to disable expensive conversions during incident response

## Phased Execution Plan

## Phase 0: decisions and scaffolding

Goal:

- lock down architecture and ownership before coding demo-specific behavior

Work:

- confirm hosting target
- confirm edge provider
- confirm email provider
- define invitation and expiry domain model
- define read-only policy strategy
- define demo-data scope and fictional brand concept
- confirm operator-notification channel for access grants

Exit criteria:

- architecture decision record captured
- issue breakdown created
- success metrics agreed

## Phase 1: read-only core architecture

Goal:

- make read-only a first-class Sambee capability before public rollout

Work:

- introduce read-only connections and/or read-only users
- reject write endpoints before they reach the backend storage layer
- add explicit UI messaging and suppress write affordances
- add tests for blocked write paths and read-only UX behavior

Exit criteria:

- demo read-only is explicit in the application model
- write requests are rejected consistently before storage operations
- the UI makes read-only state obvious

## Phase 2: infrastructure baseline

Goal:

- make the service safely reachable on the public internet with storage-level defense in depth

Work:

- deploy reverse proxy and TLS
- put CDN/WAF in front
- firewall origin to proxy traffic only
- stand up internal read-only SMB demo share
- deploy Sambee with persistent application storage

Exit criteria:

- public hostname works
- origin is not directly exposed
- demo share is read-only at the storage layer too

## Phase 3: access-control MVP

Goal:

- prevent the demo from being trivially abused

Work:

- implement public invitation-request endpoint
- add Turnstile or equivalent challenge
- add generic invitation issuance and redemption
- add expiring invited-user support
- add rate limits and cooldowns
- add constrained invited-user creation or activation
- add operator notifications for successful invitation issuance and redemption
- add admin/operator controls for revocation and pause

Exit criteria:

- self-service invitation flow works
- signup abuse is rate-limited
- invited users are narrow in scope and time-bounded

## Phase 4: demo-data generator MVP

Goal:

- generate a polished, reproducible, legally safe demo dataset

Work:

- implement deterministic generator
- build scenario manifests and templates
- generate Markdown, PDFs, PNG/JPEG/WebP, and a few advanced image formats
- add provenance manifest
- add QA validation pass

Exit criteria:

- one complete dataset can be regenerated from source
- all generated files are viewable in Sambee
- dataset is attractive enough for external use

## Phase 5: polish and scaling safeguards

Goal:

- improve resilience and presentation quality

Work:

- cache immutable responses where appropriate
- add degraded-mode switches
- tune rate limits from observed traffic
- refine signup UX and emails
- add dashboards and alerts

Exit criteria:

- service is stable under normal public usage
- operators can react quickly to abuse or resource spikes

## Implementation Order by Issue

Recommended issue sequence:

1. Define the public-demo architecture and deployment topology.
2. Design and implement read-only connections and/or read-only users in Sambee.
3. Add frontend read-only affordances and blocked-write-path tests.
4. Stand up a read-only demo SMB share behind a private network.
5. Put the public hostname behind CDN/WAF and lock down the origin.
6. Add a generic invitation backend module with request, issuance, and redemption models.
7. Add expiring invited-user support in authentication and user lifecycle management.
8. Implement the challenge-protected public invitation-request flow for the demo landing page.
9. Add transactional email delivery for invitation links or codes.
10. Add operator notifications for successful invitation issuance and redemption.
11. Build the deterministic demo-data generator with public-domain-first asset curation.
12. Add automated QA validation for generated assets.
13. Add dashboards, alerts, and degraded-mode operational controls.

## Suggested GitHub Issue Groups

### Group A: platform and deployment

- public demo deployment topology
- reverse proxy and TLS
- Cloudflare integration
- origin firewalling
- internal Samba service

### Group B: invitations and admission

- domain models and DB schema
- invitation issuance API
- invitation redemption API
- expiring-user lifecycle
- public admission checks and rate limiting
- email delivery service
- operator notifications
- abuse tracking and revocation

### Group C: read-only product capability ✅

- read-only connection design
- read-only user or session design
- backend enforcement
- frontend affordance suppression
- tests

### Group D: demo data

- scenario design
- Markdown generation
- PDF generation
- public-domain asset curation and import
- image generation where necessary
- provenance manifest
- validation pipeline

### Group E: operations

- metrics
- dashboards
- alerting
- degraded mode
- runbooks

## Acceptance Criteria for the Public Demo

The public demo is ready when all of the following are true:

- a visitor can browse and preview the product entirely in-browser
- the companion is optional and never required for core evaluation
- new visitors cannot access the demo without passing through an abuse-resistant gate
- the service remains functional under normal bot pressure
- origin infrastructure is not directly reachable from the public internet
- demo data is attractive, coherent, and legally safe
- demo data can be regenerated deterministically
- the dataset remains one shared global dataset for all demo users
- writes are blocked by policy and by storage design
- operators can pause access issuance without taking the demo offline

## Resolved Decisions

- Demo access will be fully automatic at launch, with operator notifications for successful invitation issuance and redemption.
- Invitations will create users at redemption time so accounts are only created after email verification succeeds.
- The first dataset will use real public-domain assets wherever practical and generate assets only where necessary.
- The public demo will use one single shared global dataset.

## Recommended Immediate Next Steps

1. Create an architecture decision record for the public demo stack.
2. Open and prioritize the issue series for read-only connections and/or read-only users in Sambee.
3. Implement the public demo deployment on a VM with SMB-level read-only enabled as defense in depth.
4. Open a dedicated issue series for invitations, expiring users, and demo admission checks.
5. Prototype the deterministic demo-data generator with one fictional company scenario and public-domain-first asset curation.
