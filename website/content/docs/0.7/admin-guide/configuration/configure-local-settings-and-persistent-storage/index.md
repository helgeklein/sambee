+++
title = "Configure Local Settings And Persistent Storage"
description = "Configure local settings, port exposure, and persistent storage so Sambee behaves safely in your environment."
+++

The first configuration decisions for Sambee are operational, not theoretical.

You need to know:

- which settings should stay local
- which files must persist across restarts
- which port users or the reverse proxy will reach

## Local Configuration File

If you need custom settings, create a local `config.toml` from the example file:

```bash
cp config.example.toml config.toml
```

Keep this file local to the deployment and mount it read-only in production.

## Port Configuration

The default compose mapping is:

```yaml
sambee:
  ports:
    - 8000:8000
```

If you need Sambee on a different host port, adjust only the published side of the mapping, for example:

```yaml
sambee:
  ports:
    - 8080:8000
```

## Persistent Data

Sambee stores application data under `./data`, including the SQLite database:

- `data/sambee.db`

This path must survive container recreation and host restarts.

## Why Persistence Matters

The database contains critical state such as:

- connections
- users
- security keys
- encrypted passwords

Treat it as required operational data, not as disposable cache.

## Practical Guidance

- keep `docker-compose.yml` local to the deployment
- keep `config.toml` local when you use it
- persist the `data/` directory
- review mounts and published ports before first startup rather than after something fails

For the stable lookup summary of important paths and ports, see [Port And Path Reference](../../reference/port-and-path-reference/).

## Related Pages

- [Deploy Sambee With Docker](../../installation-and-deployment/deploy-sambee-with-docker/): return here for the main deployment path
- [Configuration Key Reference](../configuration-key-reference/): use this when the question becomes which config keys change behavior
- [Configuration And Data Paths](../../reference/configuration-and-data-paths/): use this when the question becomes where config and persistent data live
- [Port And Path Reference](../../reference/port-and-path-reference/): use this for the compact lookup view of service ports and deployment paths
- [Put Sambee Behind A Reverse Proxy](../../network-and-reverse-proxy/put-sambee-behind-a-reverse-proxy/): continue here when the configuration question becomes external access or HTTPS
