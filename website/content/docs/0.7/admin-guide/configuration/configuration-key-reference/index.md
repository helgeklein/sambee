+++
title = "Configuration Key Reference"
+++

This page is a compact map of the optional `config.toml` file.

Use `config.example.toml` as the source of truth for supported keys. This page explains the sections that matter most in day-to-day administration.

## How to Use This Reference

- Copy only the keys you actually need into the local `config.toml`.
- Keep the file local to the deployment and mount it read-only in production.
- Treat commented defaults in `config.example.toml` as the baseline behavior unless you override them intentionally.
- Expect most basic deployments to use only a small subset of these keys.

## High-Value Sections and Keys

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
| `[directory_cache]` | `location`, `coalesce_interval_seconds`, `max_staleness_minutes` | Controls the saved directory index Sambee keeps to make browsing and search recover faster after restarts |
| `[smb]` | `read_chunk_size_bytes` | Changes SMB read chunk size |
| `[preprocessors.imagemagick]` | `max_file_size_bytes`, `timeout_seconds` | Sets conversion limits for ImageMagick preprocessing |
| `[companion_downloads]` | `metadata_feed_url` | Changes where Sambee resolves Companion download metadata |
| `[companion_downloads.pin]` | `version`, `published_at`, `notes`, asset URLs | Pins Companion download links to a specific published release instead of following the promoted feed |

## Keys That Deserve Extra Care

These areas have the highest operational impact:

- `auth_method`: Can change who is responsible for authentication at the deployment boundary.
- Frontend logging and tracing keys: Can change both local debugging visibility and backend trace collection volume.
- `directory_cache.location`: Changes where the saved SMB directory index lives on disk.
- Companion download keys: Change what download links Sambee presents to users.

## Related Pages

- [Configure Local Settings and Persistent Storage](../configure-local-settings-and-persistent-storage/): use this for the normal config-file and persistence workflow
- [Container Paths and Mount Mapping](../../reference/configuration-and-data-paths/): look up the container-side paths and mount relationships that the config file interacts with
