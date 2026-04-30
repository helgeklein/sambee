+++
title = "Configuration Key Reference"
description = "Use the example config as the source of truth and map the high-value keys to the operational behavior they change."
+++

This page is a compact operator-oriented map of the optional `config.toml` file.

Use `config.example.toml` as the source of truth for the currently supported keys. This page exists to help administrators understand which sections matter operationally before changing them.

## How To Use This Reference

- copy only the keys you actually need into the local `config.toml`
- keep the file local to the deployment and mount it read-only in production
- treat commented defaults in `config.example.toml` as the baseline behavior unless you override them intentionally

## High-Value Sections And Keys

| Section | Key | Operational effect |
|---|---|---|
| `[app]` | `log_level` | Sets backend log verbosity |
| `[security]` | `auth_method` | Chooses between built-in password auth and proxy-managed auth |
| `[security]` | `access_token_expire_minutes` | Changes session-token lifetime |
| `[admin]` | `username` | Sets the initial administrator username |
| `[image_viewer]` | `conv_size_thresh` | Controls when large images are always converted for viewing |
| `[frontend_logging]` | `logging_enabled`, `log_level` | Controls browser-console logging behavior |
| `[frontend_logging]` | `tracing_enabled`, `tracing_level`, `tracing_retention_hours` | Controls backend trace collection for frontend logging |
| `[frontend_logging]` | `tracing_components`, `tracing_username_regex` | Restricts tracing by component or user scope |
| `[directory_cache]` | `location`, `coalesce_interval_seconds`, `max_staleness_minutes` | Changes where directory-cache data lives and how aggressively it is written or reused |
| `[smb]` | `read_chunk_size_bytes` | Changes SMB read chunk size |
| `[preprocessors.imagemagick]` | `max_file_size_bytes`, `timeout_seconds` | Sets conversion limits for ImageMagick preprocessing |
| `[companion_downloads]` | `metadata_feed_url` | Changes where Sambee resolves Companion download metadata |
| `[companion_downloads.pin]` | `version`, `published_at`, `notes`, asset URLs | Pins Companion download links to a specific published release instead of following the promoted feed |

## Keys That Deserve Extra Care

These areas have the highest operational impact:

- `auth_method`: can change who is responsible for authentication at the deployment boundary
- frontend logging and tracing keys: can change both local debugging visibility and backend trace collection volume
- `directory_cache.location`: changes where persistent cache data lives on disk
- companion download keys: change what download links Sambee presents to users

## What This Page Deliberately Does Not Do

This page is a stable map, not a replacement for the deployment or configuration task pages.

- use the configuration task page when the job is setting up files and persistence
- use the reference pages when the job is locating actual deployment paths

## Related Pages

- [Configure Local Settings And Persistent Storage](../configure-local-settings-and-persistent-storage/): use this for the normal config-file and persistence workflow
- [Configuration And Data Paths](../../reference/configuration-and-data-paths/): look up the host-side and container-side paths that the config file interacts with
