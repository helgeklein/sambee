+++
title = "Backup and Restore Planning"
+++

Backup planning for Sambee is mainly about preserving the deployment state that the service cannot recreate on its own.

## What Must Be Protected

At minimum, protect:

- `data/sambee.db`
- your local `docker-compose.yml`
- your local `config.toml`, if you use one

The database is the most important part because it contains users, connections, security keys, and encrypted passwords.

## Simple Backup Pattern

The simplest safe backup is a cold backup:

1. Stop the Sambee service.
2. Copy `data/`, `docker-compose.yml`, and `config.toml` if you use it.
3. Store the backup on different storage from the Sambee host.

Example:

```bash
docker compose stop sambee
cp -a data docker-compose.yml /path/to/backup/
# If You Use Config.toml, Back It up Too.
# Cp -a Config.toml /Path/to/backup/
docker compose up -d sambee
```

If you do not use `config.toml`, skip that copy step.

## Basic Restore Flow

At minimum, a restore should look like this:

1. Recreate the deployment directory on the replacement host.
2. Restore `data/`, `docker-compose.yml`, and `config.toml` if you use it.
3. Restore ownership on `data/` if needed so the container can write to it.
4. Start Sambee with `docker compose up -d`.
5. Confirm sign-in, logs, and a basic SMB workflow.
