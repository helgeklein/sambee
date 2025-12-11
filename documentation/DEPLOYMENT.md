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

### 2. Create Docker Compose File

Create `docker-compose.yml` from the provided example:

```bash
cp docker-compose.example.yml docker-compose.yml
```

Change settings in `docker-compose.yml` as needed.

**Note:** Make sure to read the section **Reverse Proxy** below.

### 3. Configure Settings (Optional)

If you prefer to customize settings, create `config.toml` from the provided example:

```bash
cp config.example.toml config.toml
```

Change settings in `config.toml` as needed.

### 4. Build and Deploy

```bash
docker compose up -d
```

**Note:** The build process automatically captures the current git commit and build timestamp, which will be displayed in the application's hamburger menu and backend logs.

The application will be available at:
- **Frontend**: http://localhost:8000
- **Backend API**: http://localhost:8000/api
- **API Docs**: http://localhost:8000/docs

### 5. First Login

Get your admin password from the logs:

```bash
docker compose logs sambee | grep -A 5 "FIRST-TIME SETUP"
```

Navigate to http://localhost:8000

Login with:

   - **Username:** `admin` (or your configured value from `config.toml`).
   - **Password:** The randomly generated password from the previous step.

## Reverse Proxy

For production use, add a reverse proxy (Caddy, nginx, Traefik, etc.) in front of Sambee to handle HTTPS.

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
      # Optional: Mount config.toml if you want to customize settings by uncommenting the line below
      # - ./config.toml:/app/config.toml:ro

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

- `data/sambee.db` - SQLite database (connections, users, security keys)

This directory is mounted as a volume and persists across container restarts.

**Important**: The database contains all security keys and encrypted passwords. Back up this file regularly and keep backups secure.

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

### Forgot Admin Password

If you've lost the admin password, you can reset it by deleting the admin user from the database:

```bash
# Stop the container
docker compose stop

# Delete only the admin user (preserves all connections and settings)
python3 -c "import sqlite3; conn = sqlite3.connect('./data/sambee.db'); conn.execute(\"DELETE FROM user WHERE username='admin'\"); conn.commit(); conn.close()"

# Start the container - a new admin password will be generated
docker compose start
# Delete only the admin user (preserves all connections and settings)
docker compose exec sambee sqlite3 /app/data/sambee.db "DELETE FROM users WHERE username='admin';"

# Restart the container - a new admin password will be generated
docker compose restart sambee

# View the new admin password
docker compose logs sambee | grep -A 5 "FIRST-TIME SETUP"
```

This will regenerate a new admin password while preserving all your SMB connections and settings.

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
