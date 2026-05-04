+++
title = "Backup And Restore Planning"
description = "Plan backups around the Sambee data that actually matters and make sure you can restore the deployment state you depend on."
+++

Backup planning for Sambee is mainly about preserving the deployment state that the service cannot recreate on its own.

## What Must Be Protected

At minimum, protect:

- `data/sambee.db`
- your local `docker-compose.yml`
- your local `config.toml`, if you use one

The database is the most important part because it contains users, connections, security keys, and encrypted passwords.

## Why The Database Matters So Much

`data/sambee.db` is not just a convenience file. It is the operational state of the deployment.

If it is lost, you lose the service-side configuration and security state that makes the deployment usable.

If you back up only the image or the repository checkout and not the database, you do not have a usable backup.

## Simple Backup Pattern

The simplest safe backup is a cold backup:

1. Stop the Sambee service.
2. Copy `data/`, `docker-compose.yml`, and `config.toml` if you use it.
3. Store the backup on different storage from the Sambee host.

Example:

```bash
docker compose stop sambee
cp -a data docker-compose.yml /path/to/backup/
# If you use config.toml, back it up too.
# cp -a config.toml /path/to/backup/
docker compose up -d sambee
```

If you do not use `config.toml`, skip that copy step.

## Minimum Restore Readiness

Even if you do not yet have a full restore runbook, you should be able to answer these questions clearly:

- where is the authoritative copy of the Sambee data directory
- how would you restore it onto a replacement host
- how would you restore the compose and optional config files used by the deployment
- how would you verify that the restored service actually came back cleanly

## How To Verify Restore Readiness

The backup plan is not ready until you know how you would prove the restore worked.

At minimum, define how you would verify:

- the restored `data/` directory is the correct one
- the deployment files on the replacement host match what the service expects
- Sambee starts without an obvious database or startup fault
- administrator sign-in works after restore
- the key SMB workflows users depend on still work

## Basic Restore Flow

At minimum, a restore should look like this:

1. Recreate the deployment directory on the replacement host.
2. Restore `data/`, `docker-compose.yml`, and `config.toml` if you use it.
3. Restore ownership on `data/` if needed so the container can write to it.
4. Start Sambee with `docker compose up -d`.
5. Confirm sign-in, logs, and a basic SMB workflow.

## Operational Recommendation

Treat backup planning as part of deployment completion, not as an optional follow-up after users are already relying on the service.

For the key path summary, see [Port And Path Reference](../../reference/port-and-path-reference/).

## Related Pages

- [Routine Maintenance Checklist](../routine-maintenance-checklist/): use this when restore posture is part of a broader recurring operations review
- [Port And Path Reference](../../reference/port-and-path-reference/): review the core deployment files and persistent paths that must be preserved
- [Update Sambee Safely](../update-sambee-safely/): use this when backup posture is part of an upgrade decision
