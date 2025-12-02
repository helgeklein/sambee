# Password Auto-Generation Implementation Plan

## Overview
Simplify deployment by auto-generating all security-sensitive values, eliminating manual key generation steps.

## Design Decision: Store ALL Secrets in Database

**What we're storing:**
- `secret_key` - JWT signing key for API authentication
- `encryption_key` - Fernet key for encrypting SMB passwords
- `admin_password` - Initial admin password (hash stored in User table)

**Storage location:** Database table `app_secrets`

**Why database storage:**
- ✅ JWT key is NOT needed before DB exists (only for API token signing/verification)
- ✅ Encryption key is only used after DB exists (encrypts SMB passwords in database)
- ✅ All secrets in one place (single source of truth)
- ✅ Automatic generation on first DB init (no file permissions needed)
- ✅ Simpler backup strategy (just backup the database)
- ✅ No config.toml required for secrets
- ✅ Works with read-only container filesystems
- ✅ Consistent storage pattern (all sensitive data in database)

## Architecture

### Generation Flow

```
Startup
  ↓
Initialize Database (create tables)
  ↓
app_secrets table empty?
  ├─ YES → Generate secret_key + encryption_key + Insert into DB
  └─ NO → Load existing secrets from DB
  ↓
Load secrets into application config
  ↓
Admin user exists?
  ├─ NO → Generate password + Create user + Log credentials (production only)
  └─ YES → Continue (don't log password)
  ↓
Application Ready
```

### Database Schema

```sql
CREATE TABLE app_secrets (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- Singleton table (only one row)
    secret_key TEXT NOT NULL,               -- JWT signing key (64-char hex)
    encryption_key TEXT NOT NULL,           -- Fernet key (44-char base64)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Components to Implement

### 1. New Model: `app/models/app_secret.py`

Create SQLModel for storing application secrets:

```python
from datetime import datetime
from sqlmodel import Field, SQLModel
from typing import Optional

class AppSecret(SQLModel, table=True):
    """
    Application secrets (singleton table - only one row).

    Stores JWT signing key and encryption key for the application.
    """
    __tablename__ = "app_secrets"

    id: int = Field(default=1, primary_key=True)  # Always 1 (singleton)
    secret_key: str = Field(index=False)  # JWT signing key
    encryption_key: str = Field(index=False)  # Fernet encryption key
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
```

### 2. New Module: `app/core/secrets.py`

Create utility functions for generating and loading secrets:

```python
import secrets
import string
from cryptography.fernet import Fernet
from sqlmodel import Session, select
from app.models.app_secret import AppSecret

def generate_secret_key() -> str:
    """Generate 64-character hex string for JWT signing."""
    return secrets.token_hex(32)  # 32 bytes = 64 hex chars

def generate_encryption_key() -> str:
    """Generate 44-character base64 Fernet key."""
    return Fernet.generate_key().decode()

def generate_admin_password(is_production: bool) -> str:
    """
    Generate admin password based on environment.

    - Development: "admin" (easy to remember)
    - Production: 20-character random string (high entropy)
    """
    if not is_production:
        return "admin"

    # Generate secure 20-char password with mixed case, digits, punctuation
    alphabet = string.ascii_letters + string.digits + string.punctuation
    # Ensure at least one of each type
    password = [
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.digits),
        secrets.choice(string.punctuation),
    ]
    # Fill remaining with random choices
    password += [secrets.choice(alphabet) for _ in range(16)]
    # Shuffle to randomize positions
    secrets.SystemRandom().shuffle(password)
    return ''.join(password)

def get_or_create_app_secrets(session: Session) -> AppSecret:
    """
    Get existing app secrets or generate new ones.

    Returns the singleton AppSecret row, creating it if it doesn't exist.
    """
    # Try to get existing secrets
    statement = select(AppSecret).where(AppSecret.id == 1)
    app_secret = session.exec(statement).first()

    if app_secret is None:
        # Generate new secrets
        app_secret = AppSecret(
            id=1,
            secret_key=generate_secret_key(),
            encryption_key=generate_encryption_key(),
        )
        session.add(app_secret)
        session.commit()
        session.refresh(app_secret)
        logger.info("✅ Generated new application secrets")

    return app_secret
```

### 3. Update: `app/core/config.py`

**Current behavior:** Loads secrets from `config.toml`

**New behavior:**
- Remove `secret_key` and `encryption_key` from config file
- Remove `admin_password` from config (stored in database only)
- Secrets are loaded from database after DB initialization

**Key changes:**

```python
class UserSettings(BaseModel):
    """Application configuration settings"""

    # App settings
    debug: bool = False
    log_level: str = "INFO"

    # Token expiration
    access_token_expire_minutes: int = 60 * 24  # 24 hours

    # Admin setup
    admin_username: str = "admin"

    # NOTE: Removed from config (now in database):
    # - secret_key (JWT signing)
    # - encryption_key (Fernet)
    # - admin_password

def load_settings() -> UserSettings:
    """Load settings from config.toml (no secrets)."""
    config_file = Path("config.toml")
    toml_config = load_toml_config(config_file) if config_file.exists() else {}
    return UserSettings(**toml_config)
```

### 4. Update: `app/db/database.py`

**New behavior:** Load secrets from database after tables are created

**Key changes:**

```python
from app.models.app_secret import AppSecret
from app.core.secrets import get_or_create_app_secrets

def init_db() -> None:
    """Initialize database and load application secrets."""
    # Create all tables
    SQLModel.metadata.create_all(engine)

    # Load or generate app secrets
    with Session(engine) as session:
        app_secret = get_or_create_app_secrets(session)

        # Store secrets in settings for application use
        # (These will be accessed by security.py and other modules)
        settings.secret_key = app_secret.secret_key
        settings.encryption_key = app_secret.encryption_key
```

### 5. Update: `app/main.py` Startup

**Current behavior:** Creates admin user with password from config

**New behavior:**
- Load secrets from database first
- Generate admin password at runtime (not from config)
- Store password hash in database
- Display credentials prominently in production logs

**Key changes:**

```python
from app.core.environment import IS_PRODUCTION, IS_DEVELOPMENT
from app.core.secrets import generate_admin_password, get_or_create_app_secrets

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize application on startup"""

    try:
        logger.info("Starting Sambee application...")

        # Initialize database (creates tables)
        logger.info("Initializing database...")
        init_db()
        logger.info("✅ Database initialized")

        # Load application secrets from database
        with Session(engine) as session:
            app_secret = get_or_create_app_secrets(session)
            # Make secrets available to the application
            settings.secret_key = app_secret.secret_key
            settings.encryption_key = app_secret.encryption_key

        # Create default admin user if doesn't exist
        logger.info("Checking for admin user...")
        with Session(engine) as session:
            statement = select(User).where(User.username == settings.admin_username)
            admin = session.exec(statement).first()

            if not admin:
                # Generate password based on environment
                admin_password = generate_admin_password(IS_PRODUCTION)

                admin = User(
                    username=settings.admin_username,
                    password_hash=get_password_hash(admin_password),
                    is_admin=True,
                )
                session.add(admin)
                session.commit()

                # Display credentials prominently in production
                if IS_PRODUCTION:
                    logger.warning("=" * 80)
                    logger.warning("🔑 FIRST-TIME SETUP - SAVE THESE CREDENTIALS")
                    logger.warning(f"   Username: {settings.admin_username}")
                    logger.warning(f"   Password: {admin_password}")
                    logger.warning("   ⚠️  Change password immediately after first login!")
                    logger.warning("   Credentials will not be displayed again.")
                    logger.warning("=" * 80)
                else:
                    logger.info(f"✅ Created admin user: {settings.admin_username} / {admin_password}")
            else:
                logger.info(f"✅ Admin user exists: {settings.admin_username}")

        logger.info("🚀 Sambee application startup complete!")

    except Exception as e:
        logger.error(f"❌ Startup failed: {e}", exc_info=True)
        raise

    yield

    # Shutdown...
```### 4. Update: `config.example.toml`

Simplify to show that secrets are auto-generated:

```toml
# Sambee Configuration File
# Copy this file to config.toml
#
# For Docker deployments, mount this file as read-only:
#   volumes:
#     - ./config.toml:/app/config.toml:ro

[app]
# Enable debug mode (more verbose logging)
debug = false

# Logging level: DEBUG, INFO, WARNING, ERROR, CRITICAL
log_level = "INFO"

[security]
# Auto-generated on first startup if not present
# You can provide your own values, or leave empty for automatic generation
#
# secret_key = ""          # JWT signing key (64-char hex)
# encryption_key = ""      # Fernet key for encrypting SMB passwords (44-char base64)

# JWT token expiration time in minutes (default: 24 hours)
access_token_expire_minutes = 1440

[admin]
# Initial admin account username
username = "admin"

# NOTE: Admin password is NOT stored in config file
# - In development: defaults to "admin"
# - In production: randomly generated on first run and displayed in logs
# - Change password after first login through the web interface
```

### 7. Update: `documentation/DEPLOYMENT.md`

**Remove entire manual key generation section**, replace with:

```markdown
### 2. Deploy (Zero Configuration Required)

```bash
docker compose up -d
```

That's it! On first startup:
- Security keys are automatically generated and stored in the database
- Admin user is created with auto-generated credentials

### 3. First Login

**Production deployments:** Watch the logs for the generated admin password:

```bash
docker compose logs sambee | grep "FIRST-TIME SETUP"
```

You'll see output like:
```
🔑 FIRST-TIME SETUP - SAVE THESE CREDENTIALS
   Username: admin
   Password: aB3$xY9#mK2!pQ7&
   ⚠️  Change password immediately after first login!
   Credentials will not be displayed again.
```

**Development mode:** Default credentials are:
- Username: `admin`
- Password: `admin`

Navigate to http://localhost:8000 and login with these credentials.

**⚠️ IMPORTANT:** Change the admin password immediately after first login!

### 4. Optional: Custom Configuration

For advanced users who want to customize application behavior:

```bash
cp config.example.toml config.toml
# Edit config.toml to customize log levels, token expiration, etc.
```

**Note:** Security secrets are NOT stored in config.toml - they're auto-generated and stored securely in the database.
```

## Implementation Order

1. ✅ Create `app/models/app_secret.py` - Database model for storing secrets
2. ✅ Create `app/core/secrets.py` - Generation and retrieval functions
3. ✅ Update `app/core/config.py`:
   - Remove `secret_key` and `encryption_key` fields
   - Remove `admin_password` field
   - Keep only non-secret settings
4. ✅ Update `app/db/database.py`:
   - Import AppSecret model
   - Call `get_or_create_app_secrets()` in `init_db()`
   - Load secrets into settings object
5. ✅ Update `app/main.py`:
   - Load secrets from database in lifespan
   - Generate admin password at runtime
   - Display credentials in production logs
6. ✅ Update `config.example.toml` - Remove all secret fields
7. ✅ Update `DEPLOYMENT.md` - Simplify to zero-config deployment
8. ✅ Test in both dev and prod modes
9. ✅ Test database persistence across restarts

## Security Considerations

### ✅ Advantages

1. **No weak defaults in production** - Random 20-char passwords with high entropy
2. **Reduced deployment friction** - No manual key generation steps
3. **Keys persist across restarts** - Stored in `config.toml` on disk
4. **Clear visibility** - Production credentials prominently displayed on first run
5. **Database-only password storage** - Consistent with security best practices
6. **Separation of concerns** - Config for app secrets, database for user credentials

### ⚠️ Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Credentials in container logs | Only displayed once on first run; logs rotate |
| Auto-generated config needs write access | Document proper volume mount permissions |
| Config.toml accidentally committed | Ensure in `.gitignore`, document in README |
| Read-only config mount prevents generation | Detect and fail with clear error message |
| User forgets to save password | Prominent warning, password reset procedure documented |

## Edge Cases to Handle

### 1. Existing database with secrets
**Behavior:** Respect existing values, don't regenerate
```python
# get_or_create_app_secrets() automatically handles this
app_secret = session.exec(select(AppSecret).where(AppSecret.id == 1)).first()
if app_secret is None:
    # Generate new secrets
else:
    # Use existing secrets
```

### 2. Read-only filesystem
**Behavior:** Works perfectly - database is the only write location
```python
# No file writes needed, everything in database
```

### 3. Admin user already exists
**Behavior:** Don't generate or log password again
```python
if not admin:
    # Generate and log password
else:
    logger.info("Admin user exists")  # No password logged
```

### 4. Dev → Prod migration
**Behavior:** Document that dev "admin" password should be changed
- Add warning in deployment docs
- Consider startup check: if IS_PRODUCTION and password verifies against "admin", log warning

### 5. Password reset needed
**Behavior:** Document manual database password reset procedure
```bash
# Reset admin password to "newpassword"
docker compose exec sambee python -c "
from app.core.security import get_password_hash
from app.db.database import engine
from app.models.user import User
from sqlmodel import Session, select

with Session(engine) as session:
    admin = session.exec(select(User).where(User.username == 'admin')).first()
    if admin:
        admin.password_hash = get_password_hash('newpassword')
        session.add(admin)
        session.commit()
        print('Password reset to: newpassword')
```

### 6. Database backup/restore
**Behavior:** Secrets are included automatically
```bash
# Backup includes all secrets
cp data/sambee.db sambee-backup.db

# Restore includes all secrets
cp sambee-backup.db data/sambee.db
```

## Frontend Changes

### Update Auto-Login Password

**File:** `frontend/src/hooks/useAutoLogin.ts`

**Current behavior:** Auto-login uses password "changeme" for development

**New behavior:** Change to "admin" to match backend default

**Change:**
```typescript
// Line 38 - Update hardcoded password
const response = await login("admin", "admin");  // Changed from "changeme"
```

This ensures frontend auto-login matches the backend's development default password.

## Testing Checklist

- [ ] Fresh install (empty database) - generates all secrets in DB
- [ ] Fresh install (no config.toml) - works without any config file
- [ ] Restart with existing database - reuses existing secrets from DB
- [ ] Development mode - uses "admin" password
- [ ] Production mode - generates random password and displays it
- [ ] Admin user already exists - doesn't log password again
- [ ] Read-only filesystem - works (database is only write location)
- [ ] Password change through web UI works normally
- [ ] Database persists after container restart
- [ ] Secrets persist after container restart (in database)
- [ ] Database backup includes secrets
- [ ] Database restore includes secrets
- [ ] Frontend auto-login works with "admin" password in development

## Success Criteria

1. ✅ Zero-config deployment works out of the box (no config.toml needed)
2. ✅ Production gets secure random credentials automatically
3. ✅ Development keeps simple "admin/admin" defaults
4. ✅ Credentials clearly visible on first production run
5. ✅ Database persists secrets for subsequent restarts
6. ✅ No secrets in config.example.toml (committed to git)
7. ✅ No secrets in config.toml (if it exists)
8. ✅ Documentation is simple and accurate
9. ✅ Works with read-only container filesystems
10. ✅ Single backup location (database includes everything)
11. ✅ All edge cases handled gracefully
