# Admin Docs Plan

This file plans the structure and scope of administrator documentation.

Admin docs should help administrators deploy, configure, operate, maintain, and troubleshoot Sambee. They should not try to sell the product, and they should not duplicate task-oriented end-user guidance unless an administrator needs it for support or rollout work.

Within the future site structure, admin docs are one branch under Docs. They should stay distinct from end-user docs and developer docs.

The admin docs should still inherit the homepage's current product framing where it affects deployment and operations:

- Sambee is self-hosted
- Sambee is designed to fit into existing infrastructure
- SMB access happens through the Sambee service
- The companion app is optional for browser-only SMB workflows, but relevant to administrators who support local drive access or desktop-app editing

## Documentation Principles

- Organize by administrator job, not by internal code module
- Put prerequisites, risk notes, and operational impact near the steps they affect
- Prefer concrete deployment and operations guidance over architecture-heavy explanation
- Keep user-task help in end-user docs unless the admin is performing setup or support work
- Do not link to files in the `documentation` folder from this plan; carry relevant material into the future admin docs structure instead

## Primary Audiences

- Self-hosters deploying Sambee for themselves
- Home lab users operating Sambee alongside existing NAS or SMB infrastructure
- IT administrators deploying Sambee for teams
- Administrators supporting users who rely on the companion app
- Operators responsible for upgrades, backups, and service troubleshooting

## Recommended Top-Level Structure

### 1. Overview And Planning

Purpose:
Help administrators understand what Sambee requires, where it fits, and which docs branch they need next.

Suggested pages:

- What Sambee requires to run
- Deployment model overview
- Storage, network, and trust boundaries
- Choose the right docs path

Notes:

- This section should orient administrators quickly without becoming a marketing page
- It should explain the split between admin docs, end-user docs, and developer docs

### 2. Installation And Deployment

Suggested pages:

- Quick start with Docker
- Prepare persistent storage
- Create and review `docker-compose.yml`
- Optional `config.toml` customization
- First startup
- First admin login

Notes:

- This section should absorb the current deployment quick-start material
- Put production-minded warnings close to the relevant steps, especially around reviewed versions, mounts, and secrets

### 3. Network And Reverse Proxy

Suggested pages:

- Port configuration
- Reverse proxy overview
- Concise Caddy example configuration
- HTTPS and external access
- DNS and hostnames

Notes:

- Keep reverse-proxy guidance practical and product-scoped
- Include a concise Caddy example because it is the preferred product-docs example
- Avoid turning this section into generic vendor documentation for multiple reverse proxies

### 4. Configuration

Suggested pages:

- Configuration overview
- Application ports
- Data directory and persistence
- Local configuration file usage
- Security-sensitive settings

Notes:

- Make the operational impact of each configuration area clear
- Highlight what must be backed up and what should remain local or read-only in production

### 5. Operations And Maintenance

Suggested pages:

- View logs
- Stop and restart services
- Update to a new version
- Backup and restore planning
- Routine maintenance checklist

Notes:

- This section should focus on normal service ownership tasks
- Updates, backups, and log access should be easy to find from the main admin docs navigation
- Keep backup and restore under operations and maintenance instead of making it a separate top-level section

### 6. User And Access Support

Suggested pages:

- First admin account and password recovery
- SMB connectivity troubleshooting for administrators
- Support companion-app users
- When to send users to end-user docs

Notes:

- This section should cover admin actions taken on behalf of users or during escalation
- It should not reproduce full end-user workflows unless the administrator is expected to guide or unblock those flows

### 7. Troubleshooting

Suggested pages:

- Container will not start
- Frontend not loading
- Cannot connect to SMB shares
- First login or admin password issues
- Reverse proxy misconfiguration
- Companion-app escalation paths
- Companion diagnostics and log locations
- Preference and app-data locations
- Platform-specific companion support notes

Notes:

- Organize troubleshooting by operational symptom
- Start with fast checks and observable failure modes before deeper diagnostics
- Keep companion-app support as a troubleshooting subsection instead of a standalone admin section
- Keep user-facing companion setup and everyday usage in end-user docs

## Suggested Entry Pages

These pages should likely exist near the top of the admin docs tree:

- Deploy Sambee with Docker
- Configure ports, storage, and local settings
- Put Sambee behind a reverse proxy
- Update and maintain Sambee
- Troubleshoot deployment and connectivity issues
- Support companion-app issues

## Source Material To Carry Forward

The current development-era docs already contain important admin-oriented material that should be migrated into the future admin docs structure.

Primary source material:

- Existing deployment material should become the foundation of installation, configuration, operations, and troubleshooting pages
- Existing companion-app material should contribute support and diagnostics content for the troubleshooting section

Likely migration from current deployment source material:

- prerequisites
- Docker deployment steps
- reviewed-version guidance
- compose-file setup
- optional configuration-file setup
- first login and admin password retrieval
- reverse proxy guidance, with a concise Caddy example
- port configuration
- data persistence and backup importance
- logs, stop/restart, and update workflows
- admin password reset
- container startup troubleshooting
- SMB connectivity troubleshooting
- frontend troubleshooting where it is operational rather than end-user-facing

Likely migration from current companion source material:

- log file locations
- preference file locations
- runtime-data notes relevant to support
- platform-specific diagnostic instructions

## What Should Stay Outside Admin Docs

- Homepage-style positioning and product messaging
- Step-by-step end-user browsing, previewing, and editing workflows
- Developer-facing architecture deep dives
- Internal implementation details that are only useful to contributors

Those topics belong in the homepage, end-user docs, or developer docs respectively.

## Cross-Link Strategy

The future admin docs should cross-link within the new docs structure, not to development-era files.

Suggested cross-link rules:

- Admin pages should link to end-user docs when the next action belongs to the user
- Admin pages should link to developer docs only for implementation details, extension points, or contributor-focused troubleshooting
- End-user docs may link to admin docs when escalation is required for deployment, configuration, or support diagnostics

## Resolved Planning Decisions

- Keep backup and restore under operations and maintenance instead of creating a separate top-level section
- Include a concise Caddy example for reverse-proxy guidance and avoid broad multi-proxy reference material in product docs
- Keep companion-app support as a troubleshooting subsection instead of a standalone admin section
- Do not plan separate quick-reference pages at this stage
