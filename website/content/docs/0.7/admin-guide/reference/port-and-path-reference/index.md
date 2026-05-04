+++
title = "Port And Path Reference"
description = "Reference summary of important Sambee service ports, URLs, and deployment paths."
+++

This is the main lookup page for Sambee service ports, deployment files, persistent paths, and container-side paths.

## Service Ports And URLs

| Item | Default value | Notes |
|---|---|---|
| Sambee application port | `8000` | Default application port in the sample deployment |
| Frontend URL | `http://localhost:8000` | Default direct-access frontend URL |
| Backend API | `http://localhost:8000/api` | Default API path |
| API docs | `http://localhost:8000/docs` | Default API documentation path |

## Deployment Files And Paths

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Local deployment definition |
| `config.toml` | Optional local configuration file |
| `data/` | Persistent application data directory that must be backed up |
| `data/sambee.db` | SQLite database containing users, connections, security keys, and encrypted passwords |
| `data/directory_cache/` | Default location for Sambee's saved directory index when the relative cache setting is used |

## Container-Side Paths

| Path | Purpose |
|---|---|
| `/app/data` | Container-side mount point for persistent data |
| `/app/data/sambee.db` | Container-side database path |
| `/app/config.toml` | Container-side path for the optional mounted config file |
| `/app/data/directory_cache/` | Default container-side location for the saved directory index |

## Host-To-Container Mapping

- host-side `./data` becomes `/app/data` in the container
- host-side `./config.toml` can be mounted read-only as `/app/config.toml`
- deleting or replacing files under `data/` changes persistent deployment state, not just temporary cache files

## How To Use This Page

Use this page first when the question is about a port, URL, deployment file, persistent path, or container-side path.

If you need companion log paths, preference locations, or platform-specific companion runtime details, use [Companion Support Reference](../companion-support-reference/).

If you need to debug a mount assumption or translate a host-side path into the exact container path Sambee sees, use [Container Paths And Mount Mapping](../configuration-and-data-paths/).

## Related Pages

- [Configure Local Settings And Persistent Storage](../../configuration/configure-local-settings-and-persistent-storage/): use this when the question is about how these paths are used operationally
- [Container Paths And Mount Mapping](../configuration-and-data-paths/): use this when the mount relationship itself is the question
- [Companion Support Reference](../companion-support-reference/): use this for companion-specific support lookup material
