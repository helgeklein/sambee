+++
title = "Update Sambee Safely"
description = "Update Sambee with a released version, rebuild the deployment, and avoid risky upgrade habits."
+++

Updates should be deliberate. Do not upgrade production from the current branch tip.

## Recommended Update Flow

Fetch the available tags and move to the release you intend to deploy:

```bash
git fetch --tags
git checkout <release-tag>
docker compose down
docker compose build --pull --no-cache
docker compose up -d
```

## Why This Flow Matters

This sequence makes the deployed version explicit and avoids drifting forward to whatever changed upstream most recently.

It also gives you a clean rebuild point instead of assuming the currently cached image still matches your operational intent.

## Before You Upgrade

Before performing an update, confirm:

- you know exactly which version you are moving to
- your backup posture is acceptable
- any local deployment files such as `docker-compose.yml` and optional `config.toml` are in the state you expect

## After You Upgrade

After the new version is up:

- confirm the frontend loads
- confirm you can sign in as expected
- confirm key SMB workflows still work
- check logs for obvious startup regressions

## Verify The Upgraded Deployment

Treat upgrade verification as part of the upgrade, not as optional follow-up.

At minimum, confirm:

- you are on the intended release tag or commit
- `docker compose ps` shows the service healthy
- the frontend and sign-in path still work
- key SMB workflows still behave as expected
- the recent logs do not show an obvious startup or migration regression

If the service does not return cleanly after the update, use [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/).

## Related Pages

- [Routine Maintenance Checklist](../routine-maintenance-checklist/): use this for the compact before-and-after change checklist
- [Backup And Restore Planning](../backup-and-restore-planning/): confirm your recovery posture before risky upgrades
- [Troubleshoot Startup And Connectivity Issues](../../troubleshooting/troubleshoot-startup-and-connectivity-issues/): use this when the upgraded service does not come back cleanly
