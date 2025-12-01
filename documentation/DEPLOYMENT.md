# Sambee Deployment Guide

## Prerequisites

- Docker and Docker Compose installed

## Quick Deployment

### 1. Clone the Repository

```bash
git clone https://github.com/helgeklein/sambee.git
cd sambee
```

Create the data directory and set ownership to user/group ID 1000, which are used by the dockerized application:

```bash
mkdir -p ./data
chown -Rfv 1000:1000 ./data
```

### 2. Configure Settings

Create configuration files from examples:

```bash
cp config.example.toml config.toml
cp docker-compose.example.yml docker-compose.yml
```

Edit `config.toml` and **change the following critical security values** (see below for instructions on how to generate each):

-  Security
   - `encryption_key`
   - `secret_key`
- Admin
   - `password`

#### Generate secret_key

The `secret_key` is used for JWT token signing (user authentication). Generate a random hex string (64 characters):

```bash
openssl rand -hex 32
```

Example output: `a1b2c3d4e5f6...` (64 characters)

#### Generate encryption_key

The `encryption_key` is used for encrypting SMB passwords in the database. It **must** be a valid Fernet key (44 characters, base64-encoded).

Generate using Python:

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Or using Docker:

```bash
docker run --rm python:3.13-slim sh -c "pip install -q --root-user-action=ignore --disable-pip-version-check cryptography && python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
```

Example output: `xAbC123...==` (44 characters)

**Important**: These keys use different formats and are **not interchangeable**. The `secret_key` is a hex string, while the `encryption_key` is a base64-encoded Fernet key.

#### Generate admin password

The admin `password` is used for the admin user account. Generate a random string of 15 characters or more:

```bash
openssl rand -hex 8
```

Example output: `a1b2c3d4e5f6...` (16+ characters)

### 3. Deploy

```bash
docker compose up -d
```

The application will be available at:
- **Frontend**: http://localhost:8000
- **Backend API**: http://localhost:8000/api
- **API Docs**: http://localhost:8000/docs

### 4. First Login

1. Navigate to http://localhost:8000
2. Login with credentials from `config.toml`:
   - Username: `admin` (or your configured value)
   - Password: `changeme` (or your configured value)

## Reverse Proxy

For production use, add a reverse proxy (nginx, Traefik, Caddy, etc.) in front of Sambee to handle HTTPS.

### Caddy

Instructions for setting up Caddy are out of scope for this document. However, you'll find detailed configuration guides in [this blog post](https://helgeklein.com/blog/automatic-https-certificates-for-services-on-internal-home-network-without-opening-firewall-port/) and [many others](https://helgeklein.com/blog/tag/caddy/) on the same site.

If you have a Docker container with Caddy running, adding Caddy as a reverse proxy is simple, as the following sample `docker-compose.yml` shows:

```yaml
services:
  sambee:
    container_name: sambee
    hostname: sambee
    build: .
    restart: unless-stopped
    networks:
      - caddy_caddynet     # frontend communications
    expose:
      - 8000:8000          # Sambee to Caddy
    volumes:
      - ./data:/app/data
      - ./config.toml:/app/config.toml:ro

networks:
  caddy_caddynet:
    external: true
```

## Configuration

### Port Configuration

Default port in `docker-compose.yml`:

```yaml
sambee:
  ports:
    - 8000:8000  # Application port
```

To run on a different port, modify the port mapping:

```yaml
sambee:
  ports:
    - 8080:8000  # Run on port 8080 instead
```

### Data Persistence

Application data is stored in `./data`:

- `data/sambee.db` - SQLite database (connections, users)

This directory is mounted as a volume and persists across container restarts.

## Management

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f sambee
```

### Stop Services

```bash
docker compose down
```

### Update to Latest Version

```bash
git pull
docker compose down
docker compose build --no-cache
docker compose up -d
```

## Troubleshooting

### Container Won't Start

Check logs for errors:

```bash
docker compose logs sambee
```

### Can't Connect to SMB Shares

1. Verify network connectivity from container:
   ```bash
   docker compose exec sambee ping your-smb-host
   ```

2. Check credentials are correct
3. Ensure SMB ports (445, 139) are accessible
4. Review logs

### Frontend Not Loading

1. Rebuild the image to ensure frontend is built:
   ```bash
   docker compose build --no-cache sambee
   docker compose up -d
   ```

2. Check that static files exist:
   ```bash
   docker compose exec sambee ls -la /app/static
   ```

## Architecture

```
┌─────────────┐
│   Client    │
│  (Browser)  │
└──────┬──────┘
       │ HTTP
       ▼
┌─────────────┐
│   Sambee    │  FastAPI Backend + React Frontend
│ (Port 8000) │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  SQLite DB  │  Stored in ./data/sambee.db
│   + Files   │
└─────────────┘
       │
       ▼
┌─────────────┐
│ SMB Shares  │  Your network file shares
└─────────────┘
```

## Support

For issues and questions:
- GitHub Issues: https://github.com/helgeklein/sambee/issues
- Documentation: See `documentation/` folder
