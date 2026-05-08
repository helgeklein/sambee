+++
title = "Container Paths and Mount Mapping"
+++

Use [Port and Path Reference](../port-and-path-reference/) first for the main list of ports, deployment files, and persistent paths.

Use this page only when you need to translate a host-side path into the container path Sambee sees, or when a mount assumption looks wrong.

## Container-Side Paths

| Path | Purpose |
|---|---|
| `/app/data` | Container-side mount point for persistent data |
| `/app/data/sambee.db` | Container-side database path |
| `/app/config.toml` | Container-side path for the optional mounted config file |
| `/app/data/directory_cache/` | Default container-side location for the saved directory index when the relative cache setting is used |

## Default Host-to-Container Mapping

These mappings are the ones administrators usually need when comparing a deployment file on the host with what Sambee sees inside the container:

- Host-side `./data` becomes `/app/data` in the container.
- Host-side `./config.toml` can be mounted read-only as `/app/config.toml`.
- Host-side `./data/sambee.db` appears in the container as `/app/data/sambee.db`.
- Host-side `./data/directory_cache/` appears in the container as `/app/data/directory_cache/` when the default relative cache location is used.

## Use This Page When

Use this page when the question is primarily:

- Which container-side path to use in a `docker compose exec` or `docker compose run` command.
- How a host-side path maps into the container.
- Whether a mount or path assumption is wrong in the current deployment.

## Related Pages

- [Port and Path Reference](../port-and-path-reference/): start here for the main lookup page for ports, deployment files, and persistent paths
- [Configure Local Settings and Persistent Storage](../../configuration/configure-local-settings-and-persistent-storage/): use this when the question is how to set these paths up safely
- [Configuration Key Reference](../../configuration/configuration-key-reference/): use this when the question is which config key changes behavior rather than where the files live
