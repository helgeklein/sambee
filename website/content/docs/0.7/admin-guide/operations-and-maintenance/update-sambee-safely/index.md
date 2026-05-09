+++
title = "Update Sambee Safely"
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

- You know exactly which version you are moving to.
- Your backup posture is acceptable.
- Any local deployment files such as `docker-compose.yml` and optional `config.toml` are in the state you expect.

## After You Upgrade

After the new version is up:

- Confirm that the frontend loads.
- Confirm that you can sign in as expected.
- Confirm that key SMB workflows still work.
- Check logs for obvious startup regressions.

## Verify the Upgraded Deployment

Treat upgrade verification as part of the upgrade, not as optional follow-up.

At minimum, confirm:

- You are on the intended release tag or commit.
- The `docker compose ps` output shows the service healthy.
- The frontend and sign-in path still work.
- Key SMB workflows still behave as expected.
- The recent logs do not show an obvious startup or migration regression.

If the service does not return cleanly after the update, stop changing versions and inspect the deployment state, recent logs, proxy path, and persistent data assumptions before proceeding.
