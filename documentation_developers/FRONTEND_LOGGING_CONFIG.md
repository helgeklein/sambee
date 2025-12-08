# Frontend Logging Configuration

## Overview

Frontend logging is configured via `config.toml` with support for username regex filtering. Logging is **disabled by default** to minimize server load and only enabled when explicitly configured by administrators.

## Architecture

### Backend Components

1. **Configuration** (`app/core/config.py`)
   - `frontend_logging_enabled: bool` - Enable/disable logging globally (default: False)
   - `frontend_log_retention_hours: int` - Log file retention period (default: 1 hour)
   - `frontend_log_level: str` - Minimum severity level to capture (default: "ERROR")
   - `frontend_log_components: str` - Log components to capture (default: "" = all components)
   - `frontend_logging_username_regex: str` - Regex pattern to match usernames (default: "" = all users when enabled)

2. **API Endpoints** (`app/api/logs.py`)
   - `GET /api/logs/config` - Get logging configuration for current user (checks username against regex)

3. **Log Manager** (`app/services/log_manager.py`)
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
enabled = false

# Delete frontend logs older than this many hours (default: 1)
log_retention_hours = 1

# Minimum log level (case-insensitive)
# Options: debug (logs everything), info, warn, error (logs errors only)
# Each level includes all higher severity levels
log_level = "error"

# Log components (comma-separated, empty = all components)
# Examples: ImageViewer, ImageLoader, Swiper
log_components = ""

# Username regex filter - only log for users matching this regex (default: empty = all users)
# Examples:
#   username_regex = "^admin$"              # Only admin user
#   username_regex = "^(admin|developer)$"  # admin or developer
#   username_regex = "^test"                # Any username starting with "test"
#   username_regex = ""                     # All users (when enabled = true)
username_regex = ""
```

### Username Filtering

The `username_regex` setting allows administrators to enable logging only for specific users:

```toml
# Enable logging only for admin users
[frontend_logging]
enabled = true
username_regex = "^admin$"

# Enable logging for test users
[frontend_logging]
enabled = true
username_regex = "^test"

# Enable logging for admin or developers
[frontend_logging]
enabled = true
username_regex = "^(admin|developer)$"
```

When `username_regex` is empty and `enabled = true`, logging is enabled for all users.

### API Usage

Check logging configuration for current user:

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:8000/api/logs/config
```

Response indicates whether logging is enabled for that specific user based on the regex match.

### Configuration Options

**Minimum Log Level** (case-insensitive):
The `log_level` setting specifies the minimum severity to capture. Each level includes all higher severity levels:
- `DEBUG` - Logs everything (DEBUG, INFO, WARNING, ERROR)
- `INFO` - Logs informational messages and above (INFO, WARNING, ERROR)
- `WARNING` - Logs warnings and errors (WARNING, ERROR)
- `ERROR` - Logs errors only (ERROR)

Invalid levels default to `ERROR` as a fail-safe.

**Components**: Any string identifier used in logging calls. Common components:
- `ImageViewer`
- `ImageLoader`
- `Swiper`
- Leave empty string to log all components

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
1. Checks if logging is enabled for the current user
2. Checks if the log level meets the minimum threshold (e.g., `ERROR` logs only errors, `WARNING` logs warnings and errors)
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

## Default Behavior

- **Logging Disabled**: By default, no frontend logs are sent to reduce server load
- **Config-Based**: All settings are configured in `config.toml`, no database storage
- **Username Filtering**: Regex-based username matching allows selective logging for specific users
- **Automatic Cleanup**: Logs older than configured retention period are automatically deleted
- **Fallback**: If config fetch fails, logging is disabled (fail-safe)

## Debugging

To enable logging for troubleshooting:

1. Edit `config.toml` to enable logging and optionally set username regex filter
2. Restart the backend server
3. Refresh the frontend page
4. Configuration is cached for 5 minutes
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
