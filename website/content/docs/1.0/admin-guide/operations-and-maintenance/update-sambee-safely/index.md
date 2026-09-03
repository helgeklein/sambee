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

## Archive V2 Cutover

The Archive V2 release does not retain interrupted Archive V1 work. Complete this one-time procedure before starting the new image when the preflight reports legacy archive operations.

1. Stop Sambee and make a cold backup of `data/`, `docker-compose.yml`, and `config.toml` if you use one.
1. Run the V2 preflight against the deployment's mounted database:

   ```bash
   docker compose run --rm --entrypoint /app/scripts/preflight-archive-v2-cutover sambee
   ```

1. If the preflight lists legacy operations, review the output. Those operations cannot be resumed after the cutover.
1. Explicitly discard only the listed legacy archive operations:

   ```bash
   docker compose run --rm --entrypoint /app/scripts/reset-archive-v2-cutover-state sambee \
     --confirm-discard-legacy-archive-state
   ```

1. Run the preflight again. Continue only when it reports `"ready": true`.
1. Start the new image with `docker compose up -d`. Startup runs the preflight again before applying database migrations.

Do not run the reset command while an older Sambee backend can still create archive operations. The command affects only legacy archive-operation state; it does not reset users, connections, or other application data.

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