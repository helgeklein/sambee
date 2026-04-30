+++
title = "Port And Path Reference"
description = "Reference summary of important Sambee service ports, URLs, and deployment paths."
+++

This page collects stable lookup material for administrators.

## Service Ports And URLs

| Item | Default value | Notes |
|---|---|---|
| Sambee application port | `8000` | Default container and host-facing application port in the sample deployment |
| Frontend URL | `http://localhost:8000` | Default direct-access frontend URL |
| Backend API | `http://localhost:8000/api` | Default API path |
| API docs | `http://localhost:8000/docs` | Default API documentation path |

## Deployment Files And Paths

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Local deployment definition |
| `config.toml` | Optional local configuration file |
| `data/` | Persistent application data directory |
| `data/sambee.db` | SQLite database containing users, connections, security keys, and encrypted passwords |

## How To Use This Page

Use this page as a lookup aid while working through the operational and support pages elsewhere in the Admin Guide.

If you need companion log paths, preference locations, or platform-specific companion runtime details, use [Companion Support Reference](../companion-support-reference/).

If you are still trying to deploy or recover the service, go back to the task pages instead of treating this reference page as the main instructions source.

## Related Pages

- [Configure Local Settings And Persistent Storage](../../configuration/configure-local-settings-and-persistent-storage/): use this when the question is about how these paths are used operationally
- [Configuration And Data Paths](../configuration-and-data-paths/): use this for the fuller host-side and container-side path map
- [Companion Support Reference](../companion-support-reference/): use this for companion-specific support lookup material
