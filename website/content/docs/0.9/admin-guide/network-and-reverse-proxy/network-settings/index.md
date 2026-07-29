+++
title = "Network Settings"
+++

Open **Settings** > **Administration** > **Network** to configure the settings Sambee uses for external URLs and reverse-proxy client addresses.

## Public URL

Set **Public URL** to Sambee's externally reachable HTTPS origin, for example:

```text
https://files.example.com
```

Do not include a path. Changing the public URL cancels incomplete OIDC sign-ins and tests.

## Trusted Reverse Proxy CIDRs

Configure **Trusted reverse proxy CIDRs** only when all of the following is true:

- A reverse proxy sits in front of Sambee.
- The proxy forwards the original visitor IP address.
- You want Sambee to use that address for authentication request limits.

Enter the IP addresses or network ranges of the proxies that connect directly to Sambee. Do not enter end-user networks or arbitrary private ranges.

### Example

If Nginx at `10.20.30.15` is the only server that can reach Sambee and it forwards `X-Forwarded-For`, enter `10.20.30.15/32`.

