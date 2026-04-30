+++
title = "Configuration And Data Paths"
description = "Look up the host-side and container-side paths that matter for config, persistence, and deployment recovery."
+++

This page is a stable lookup reference for the paths administrators most often need when checking config mounts, persistence, or restore assumptions.

## Host-Side Deployment Paths

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Local deployment definition |
| `config.toml` | Optional local configuration override file |
| `data/` | Persistent application data directory |
| `data/sambee.db` | SQLite database containing users, connections, security keys, and encrypted passwords |
| `data/directory_cache/` | Default directory-cache location when `directory_cache.location` uses the example relative setting |

## Container-Side Paths

| Path | Purpose |
|---|---|
| `/app/data` | Container-side mount point for persistent data |
| `/app/data/sambee.db` | Container-side database path |
| `/app/config.toml` | Container-side path for the optional mounted config file |

## Path Relationships That Matter Operationally

These relationships are the ones administrators usually need to reason about:

- host-side `./data` becomes `/app/data` in the container
- host-side `./config.toml` can be mounted read-only as `/app/config.toml`
- deleting or replacing files under `data/` changes persistent deployment state, not disposable cache only

## Use This Page When

Use this page when the question is primarily:

- where a deployment file or data file lives
- which path must be preserved for restore and migration work
- whether a mount or path assumption is wrong in the current deployment

## Related Pages

- [Configure Local Settings And Persistent Storage](../../configuration/configure-local-settings-and-persistent-storage/): use this when the question is how to set these paths up safely
- [Port And Path Reference](../port-and-path-reference/): use this for the shorter combined lookup view of service ports and key deployment files
- [Configuration Key Reference](../../configuration/configuration-key-reference/): use this when the question is which config key changes behavior rather than where the files live
