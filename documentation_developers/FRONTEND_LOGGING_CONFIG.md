# Frontend Logging Configuration

## Overview

Frontend logging is now fully configurable per user with granular control over log levels and components. Logging is **disabled by default** to minimize server load and only enabled when explicitly configured.

## Architecture

### Backend Components

1. **User Model** (`app/models/user.py`)
   - `enable_frontend_logging: bool` - Per-user logging enable/disable
   - `frontend_log_levels: str` - Comma-separated list of enabled levels (debug, info, warn, error)
   - `frontend_log_components: str` - Comma-separated list of enabled components (empty = all)

2. **Configuration** (`app/core/config.py`)
   - `frontend_logging_enabled: bool` - Global default (default: False)
   - `frontend_log_retention_hours: int` - Log file retention period (default: 1 hour)
   - `frontend_default_log_levels: str` - System-wide default log levels (default: "error,warn,info,debug")
   - `frontend_default_log_components: str` - System-wide default log components (default: "" = all components)

3. **API Endpoints** (`app/api/logs.py`)
   - `GET /api/logs/config` - Get current user's logging configuration
   - `PUT /api/logs/config` - Update current user's logging configuration

4. **Log Manager** (`app/services/log_manager.py`)
   - Uses configurable retention period for cleanup
   - Called automatically when logs are received

### Frontend Components

1. **Logging Config Manager** (`src/services/loggingConfig.ts`)
   - Fetches configuration from backend
   - Caches config in memory and localStorage
   - 5-minute cache duration
   - Provides methods to check if levels/components are enabled

2. **Logger** (`src/services/logger.ts`)
   - `initializeMobileLogging()` - Fetches config and enables logging if configured
   - Checks configuration before sending each log entry
   - Filters by both level and component

3. **Initialization**
   - Login page: Initializes after successful login
   - Browser page: Initializes on page load (handles refresh with existing token)
   - No-auth mode: Initializes when auth_method is "none"

## Configuration

### Backend Configuration (`config.toml`)

```toml
[frontend_logging]
# Enable frontend logging globally (default: false)
# Individual users can override this in their profile
enabled = false

# Delete frontend logs older than this many hours (default: 1)
log_retention_hours = 1

# Default log levels for all users (comma-separated, case-insensitive)
# Options: debug, info, warn, error
default_log_levels = "error,warn,info,debug"

# Default log components for all users (comma-separated, empty = all components)
# Examples: ImageViewer, ImageLoader, Swiper
default_log_components = ""
```

Users inherit these system-wide defaults unless they override them via the API. This allows administrators to set baseline logging behavior for all users.

### Per-User Configuration

Users can configure their logging preferences via the API:

```bash
# Get current configuration
curl -H "Authorization: Bearer <token>" \
  http://localhost:8000/api/logs/config

# Update configuration
curl -X PUT \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "levels": ["error", "warn"],
    "components": ["Swiper", "ImageLoader"]
  }' \
  http://localhost:8000/api/logs/config
```

### Configuration Options

**Levels** (case-insensitive):
- `debug` - Detailed debugging information
- `info` - General informational messages
- `warn` - Warning messages
- `error` - Error messages

**Components**: Any string identifier used in logging calls. Common components:
- `ImageViewer`
- `ImageLoader`
- `Swiper`
- Leave empty array `[]` to log all components

## Usage

### Frontend Code

```typescript
// In components that use mobile logging
import { logger } from '../services/logger';

// Log with component identifier
logger.debugMobile("Image loaded", { index: 0 }, "ImageLoader");
logger.infoMobile("Navigation started", { from: 1, to: 2 }, "Swiper");
logger.warnMobile("Slow operation detected", { duration: 500 }, "ImageViewer");
logger.errorMobile("Failed to load", { error: err }, "ImageLoader");
```

The logger automatically:
1. Checks if logging is enabled
2. Filters by configured log levels
3. Filters by configured components
4. Sends to backend if all checks pass

### Backend Logging

The backend automatically:
1. Receives log batches from authenticated users
2. Writes logs to JSONL files with metadata
3. Cleans up old logs based on `frontend_log_retention_hours`

Log files are stored in `data/mobile_logs/` with format:
```
mobile_logs_YYYYMMDD_HHMMSS_<session_id>.jsonl
```

## Database Migration

The system uses SQLModel with `create_all()`, so new columns are automatically added on first run. No manual migration needed.

If you need to add the columns to an existing database:

```sql
ALTER TABLE user ADD COLUMN enable_frontend_logging BOOLEAN DEFAULT FALSE;
ALTER TABLE user ADD COLUMN frontend_log_levels TEXT DEFAULT 'error,warn,info,debug';
ALTER TABLE user ADD COLUMN frontend_log_components TEXT DEFAULT '';
```

## Default Behavior

- **Logging Disabled**: By default, no frontend logs are sent to reduce server load
- **System-Wide Defaults**: Administrators can configure default log levels and components in `config.toml`
- **User Overrides**: Individual users can override system defaults via the API
- **Admin Control**: System administrators can enable logging per user for debugging
- **Automatic Cleanup**: Logs older than configured retention period are automatically deleted
- **Fallback**: If config fetch fails, logging is disabled (fail-safe)

## Debugging

To enable logging for troubleshooting:

1. Update user configuration via API (see above)
2. Refresh the frontend page
3. Configuration is cached for 5 minutes
4. Check `data/mobile_logs/` for log files
5. Download logs via `GET /api/logs/download/{filename}`

## Performance Considerations

- Configuration is cached in localStorage and memory
- Only one config fetch per 5 minutes per user
- Async checks don't block main thread
- Failed config checks return quickly (no retries)
- Log filtering happens client-side (no unnecessary network requests)

## Security

- Logging configuration requires authentication
- Users can only access/modify their own config
- Admins can access all logs via API
- No sensitive data should be logged (sanitize before logging)
