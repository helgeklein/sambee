# Frontend Logging Architecture

## Overview

The frontend logging system provides two independent mechanisms for debugging and monitoring:

1. **Console Logging**: Browser console output for local development and debugging
2. **Backend Tracing**: Server-side log collection for production monitoring and mobile debugging

Both mechanisms share the same log messages (single source of truth) but are controlled independently through backend configuration.

## Quick Start

### Basic Usage

```typescript
import { logger } from '../services/logger';

// Simple logging (automatically forwards to backend tracing if enabled)
logger.debug("Processing started", { itemId: 123 });
logger.info("File loaded successfully", { filename: "image.jpg" });
logger.warn("Cache nearly full", { usage: 0.9 });
logger.error("Failed to fetch data", { url: "/api/data" }, undefined, error);

// With component tag for backend tracing filtering
logger.debug("Cache updated", { count: 5 }, "image-cache");
logger.info("Image loaded", { index: 3 }, "viewer");
```

### Convenience Functions

```typescript
import { debug, info, warn, error } from '../services/logger';

debug("Quick debug message", { data: "value" });
info("Quick info message");
warn("Quick warning");
error("Quick error", { code: 500 });
```

### Initialization

```typescript
// In your app startup (e.g., FileBrowser.tsx, Login.tsx)
await logger.initializeBackendTracing();
```

This fetches configuration from the backend and:
- Sets console logging level based on backend config
- Enables backend tracing if configured
- Should be called after user authentication

## Architecture

### Two Independent Systems

#### 1. Console Logging
- **Purpose**: Browser console output for developers
- **Control**: `logging_enabled` and `logging_level` in backend config
- **Behavior**:
  - Development: Defaults to DEBUG level
  - Production: Defaults to WARN level
  - Backend config overrides defaults when loaded
- **Output**: Formatted console messages with timestamps and context

#### 2. Backend Tracing
- **Purpose**: Server-side log collection for production monitoring
- **Control**: `tracing_enabled`, `tracing_level`, and `tracing_components` in backend config
- **Behavior**:
  - Buffers logs in memory (default: 50 logs or 30 seconds)
  - Sends batches to backend via `/api/logs/mobile` endpoint
  - Includes device info and session tracking
- **Use Case**: Essential for debugging on mobile devices where console access is unavailable

### Single Source of Truth

All logging methods (`debug()`, `info()`, `warn()`, `error()`) automatically:
1. Write to browser console (if level enabled for console logging)
2. Forward to backend trace buffer (if tracing enabled and level/component match)

No need to choose between logging and tracing - one call does both.

## Configuration

### Backend Configuration File

Location: `backend/config.toml`

```toml
[frontend_logging]
# Browser console logging
logging_enabled = true
log_level = "DEBUG"  # DEBUG, INFO, WARNING, ERROR

# Backend tracing (server-side collection)
tracing_enabled = true
tracing_level = "DEBUG"  # DEBUG, INFO, WARNING, ERROR
tracing_components = []  # Empty = all components, or specific list: ["browser", "api", "viewer"]
tracing_retention_hours = 24
tracing_username_regex = ""  # Empty = all users, or regex pattern to filter users
```

### Configuration API

The backend exposes configuration via `/api/logs/config`:

```typescript
interface LoggingConfig {
  // Console logging
  logging_enabled: boolean;
  logging_level: string;  // "DEBUG" | "INFO" | "WARNING" | "ERROR"

  // Backend tracing
  tracing_enabled: boolean;
  tracing_level: string;  // "DEBUG" | "INFO" | "WARNING" | "ERROR"
  tracing_components: string[];  // Component filter list
}
```

### Configuration Caching

- Configuration is cached in `localStorage` for 5 minutes
- Prevents excessive API calls
- Automatically refreshed when cache expires

## Log Levels

Log levels follow standard severity hierarchy:

| Level | Value | Use Case |
|-------|-------|----------|
| DEBUG | 0 | Detailed diagnostic information |
| INFO | 1 | General informational messages |
| WARN | 2 | Warning messages (potential issues) |
| ERROR | 3 | Error messages (actual failures) |

**Level Filtering**: Setting level to `WARNING` will show WARNING and ERROR, but suppress DEBUG and INFO.

## API Reference

### Logger Class

#### Methods

##### `logger.debug(message, context?, component?)`
Log a debug message. Useful for detailed diagnostic information.

**Parameters**:
- `message: string` - Log message
- `context?: LogContext` - Additional context data (object with any key-value pairs)
- `component?: string` - Component name for backend tracing filtering

**Example**:
```typescript
logger.debug("Preloading image", { index: 5, path: "/images/photo.jpg" }, "image-cache");
```

##### `logger.info(message, context?, component?)`
Log an informational message. Useful for general status updates.

**Parameters**: Same as `debug()`

**Example**:
```typescript
logger.info("Navigation completed", { from: 1, to: 5 });
```

##### `logger.warn(message, context?, component?)`
Log a warning message. Useful for potential issues that don't prevent operation.

**Parameters**: Same as `debug()`

**Example**:
```typescript
logger.warn("Cache approaching limit", { current: 18, max: 20 });
```

##### `logger.error(message, context?, component?, error?)`
Log an error message. Useful for actual failures.

**Parameters**:
- `message: string` - Error message
- `context?: LogContext` - Additional context data
- `component?: string` - Component name for backend tracing filtering
- `error?: Error` - Optional Error object (will extract message, stack, name)

**Example**:
```typescript
try {
  await fetchData();
} catch (err) {
  logger.error("Failed to fetch data", { url: "/api/data" }, "api", err);
}
```

##### `logger.initializeBackendTracing()`
Initialize logging system with backend configuration. Fetches config from `/api/logs/config` and applies settings.

**Returns**: `Promise<void>`

**Example**:
```typescript
await logger.initializeBackendTracing();
```

##### `logger.enableBackendTracing(maxLogs?, flushIntervalMs?)`
Manually enable backend tracing (usually called automatically by `initializeBackendTracing()`).

**Parameters**:
- `maxLogs?: number` - Maximum logs to buffer before auto-flush (default: 50)
- `flushIntervalMs?: number` - Auto-flush interval in milliseconds (default: 30000)

##### `logger.disableBackendTracing()`
Disable backend tracing. Flushes remaining logs before disabling.

##### `logger.flushBackendTraces()`
Manually flush all buffered logs to backend immediately.

**Returns**: `Promise<void>`

##### `logger.setLevel(level)`
Set minimum console logging level.

**Parameters**:
- `level: LogLevel` - Minimum level (LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR)

### LogContext Interface

```typescript
interface LogContext {
  [key: string]: unknown;
}
```

Any object with string keys and values of any type. Common patterns:

```typescript
// Simple data
{ count: 5, enabled: true }

// IDs and references
{ userId: "123", sessionId: "abc-def" }

// Nested objects
{ config: { width: 1920, height: 1080 } }

// Arrays
{ items: [1, 2, 3] }
```

## Backend Tracing Details

### Log Buffer

**Location**: `frontend/src/services/logBuffer.ts`

**Features**:
- In-memory buffer stores logs until flush threshold
- Automatic flush on buffer full or time interval
- Includes device information in each batch
- Generates unique session ID per viewer session

**Buffer Behavior**:
- Default: Flushes after 50 logs OR 30 seconds
- Configurable via `enableBackendTracing()` parameters
- Automatic flush on browser unload/visibility change

### Log Transport

**Location**: `frontend/src/services/logTransport.ts`

**Features**:
- Sends batches to `/api/logs/mobile` endpoint
- Uses fetch API directly (avoids circular dependencies)
- Includes JWT authentication token
- Handles network errors gracefully

### Log Batch Format

```typescript
interface LogBatch {
  session_id: string;
  device_info: {
    userAgent: string;
    screenWidth: number;
    screenHeight: number;
    devicePixelRatio: number;
    platform: string;
    isTouchDevice: boolean;
  };
  logs: LogEntry[];
}

interface LogEntry {
  timestamp: number;  // Unix timestamp in milliseconds
  level: string;      // "DEBUG" | "INFO" | "WARN" | "ERROR"
  message: string;
  context?: Record<string, unknown>;
  component?: string;
}
```

### Backend Storage

**Location**: `backend/data/mobile_logs/`

**Format**: JSON files named `{username}_{timestamp}_{session_id}.json`

**Retention**: Automatically cleaned up after configured hours (default: 24)

**API Endpoints**:
- `POST /api/logs/mobile` - Submit log batch
- `GET /api/logs/config` - Fetch configuration
- `GET /api/logs/list` - List stored log files
- `GET /api/logs/{filename}` - Download specific log file

## Component Filtering

Backend tracing supports component-based filtering to reduce noise:

### Configuration

```toml
[frontend_logging]
tracing_components = ["browser", "api", "image-cache"]
```

Empty array = all components enabled.

### Usage

```typescript
// This will only be sent to backend if "image-cache" is in tracing_components
logger.debug("Cache updated", { count: 5 }, "image-cache");

// This will always be sent to backend (no component filter)
logger.debug("Cache updated", { count: 5 });
```

### Available Component Names

- `api` - API calls, authentication, HTTP requests/responses
- `app` - Application-level errors (ErrorBoundary)
- `auth` - Authentication configuration and login flows
- `browser` - File browser navigation, connections, directory loading
- `browser-perf` - Performance profiling metrics
- `config` - Configuration loading and management
- `image-cache` - Image caching, preloading, and gallery optimization
- `viewer` - File viewing and viewer component loading
- `websocket` - WebSocket connections and real-time updates

## Console Output Format

Console messages include:
- Timestamp (ISO 8601 format)
- Log level with color coding
- Message text
- Context object (if provided)
- Request ID (if available in context)

**Example**:
```
2025-12-11T14:30:45.123Z DEBUG Fetching image for carousel {index: 5, path: "/photos/img.jpg"}
2025-12-11T14:30:45.456Z INFO [abc-123] Image loaded successfully {size: 1024000}
```

## Error Handling

### Error Context

Errors logged with an Error object get enhanced context:

```typescript
try {
  throw new Error("Network timeout");
} catch (err) {
  logger.error("Request failed", { url: "/api/data" }, undefined, err);
}

// Results in console:
// {
//   url: "/api/data",
//   error: {
//     message: "Network timeout",
//     stack: "Error: Network timeout\n  at ...",
//     name: "Error"
//   }
// }
```

## Testing Considerations

### Test Environment Detection

The logger automatically detects test environments and:
- Suppresses console output during tests
- Disables backend tracing
- Prevents localStorage access errors

**Detection Methods**:
1. `import.meta.env.VITEST === true`
2. `process.env.VITEST === "true"`
3. Global test functions (`describe`, `it`, `test`)

### Mocking in Tests

```typescript
import { vi } from 'vitest';
import { logger } from '../services/logger';

// Mock logger methods
vi.spyOn(logger, 'debug').mockImplementation(() => {});
vi.spyOn(logger, 'info').mockImplementation(() => {});
```

## Best Practices

### 1. Use Appropriate Log Levels

```typescript
// ✅ Good
logger.debug("Starting expensive operation", { itemCount: 1000 });  // Diagnostic detail
logger.info("User logged in", { username: "alice" });               // Important events
logger.warn("Cache is 90% full", { usage: 0.9 });                   // Potential issues
logger.error("Failed to save", { id: 123 }, undefined, error);      // Actual failures

// ❌ Bad
logger.debug("User logged in");  // Too important for DEBUG
logger.error("Cache is full");   // Not an error, should be WARN
```

### 2. Include Relevant Context

```typescript
// ✅ Good - specific, actionable context
logger.error("Image fetch failed", {
  index: 5,
  path: "/images/photo.jpg",
  status: 404,
  duration: 1523
}, "image-cache", error);

// ❌ Bad - vague, missing details
logger.error("Fetch failed");
```

### 3. Use Component Tags for Production Debugging

```typescript
// ✅ Good - enables targeted debugging in production
logger.debug("Cache miss", { index: 7 }, "image-cache");
logger.info("Preload started", { range: [5, 10] }, "image-cache");

// ⚠️ Acceptable - but harder to filter in production
logger.debug("Cache miss", { index: 7 });
```

### 4. Avoid Logging Sensitive Data

```typescript
// ❌ Bad - exposes sensitive information
logger.info("User authenticated", { password: "secret123" });
logger.debug("API response", { creditCard: "1234-5678-..." });

// ✅ Good - sanitized or omitted
logger.info("User authenticated", { username: "alice" });
logger.debug("API response", { status: 200, recordCount: 5 });
```

### 5. Don't Log in Tight Loops

```typescript
// ❌ Bad - floods logs
for (let i = 0; i < 1000; i++) {
  logger.debug("Processing item", { index: i });
  processItem(i);
}

// ✅ Good - summary logging
logger.debug("Processing batch", { count: 1000 });
for (let i = 0; i < 1000; i++) {
  processItem(i);
}
logger.info("Batch complete", { processed: 1000 });
```

### 6. Log Lifecycle Events

```typescript
// Component mount/unmount
useEffect(() => {
  logger.info("Component mounted", {}, "MyComponent");

  return () => {
    logger.info("Component unmounting", {}, "MyComponent");
  };
}, []);
```

## Troubleshooting

### Logs Not Appearing in Console (Production)

**Symptoms**: No console output in production build

**Possible Causes**:
1. Console logging disabled in backend config
2. Log level set too high (e.g., ERROR when you need DEBUG)
3. `initializeBackendTracing()` not called

**Solutions**:
```toml
# backend/config.toml
[frontend_logging]
logging_enabled = true
log_level = "DEBUG"  # Lower the threshold
```

```typescript
// Ensure initialization is called
await logger.initializeBackendTracing();
```

### Backend Tracing Not Working

**Symptoms**: Logs not appearing in backend files

**Possible Causes**:
1. Tracing disabled in backend config
2. Component filter excluding your logs
3. Network errors preventing batch submission
4. Log level threshold too high

**Solutions**:
```toml
# backend/config.toml
[frontend_logging]
tracing_enabled = true
tracing_level = "DEBUG"
tracing_components = []  # Empty = all components
```

**Debug**: Check browser Network tab for failed POST to `/api/logs/mobile`

### Excessive Log Volume

**Symptoms**: Too many logs, hard to find relevant information

**Solutions**:
1. Increase log level threshold
2. Use component filtering
3. Reduce logging in hot code paths

```toml
[frontend_logging]
tracing_level = "INFO"  # Suppress DEBUG
tracing_components = ["image-cache", "api"]  # Only specific components
```

### Logs Missing Context

**Symptoms**: Log messages appear but context is undefined

**Common Mistake**:
```typescript
// ❌ Wrong parameter order
logger.debug("Message", "ComponentName", { data: "value" });
```

**Fix**:
```typescript
// ✅ Correct parameter order: (message, context, component)
logger.debug("Message", { data: "value" }, "ComponentName");
```

## Performance Considerations

### Console Logging Overhead

- Minimal in production when level filtering suppresses output
- In development, large context objects may impact performance
- Consider using `logger.setLevel(LogLevel.WARN)` for performance testing

### Backend Tracing Overhead

- Logs buffered in memory (minimal overhead)
- Network requests batched (default: 50 logs or 30 seconds)
- Async/non-blocking operations
- Typical overhead: < 1ms per log call

### Memory Usage

- Console logs: No memory impact (handled by browser)
- Backend trace buffer: ~50 logs × ~500 bytes = ~25KB typical
- Stored errors: Max 50 × ~1KB = ~50KB in localStorage

## Migration Guide

### From Old Trace Functions

The deprecated `debugTrace()`, `infoTrace()`, `warnTrace()`, `errorTrace()` methods have been removed.

**Before**:
```typescript
logger.debugTrace("Message", { data: "value" }, "Component");
logger.infoTrace("Message", { data: "value" }, "Component");
```

**After**:
```typescript
logger.debug("Message", { data: "value" }, "Component");
logger.info("Message", { data: "value" }, "Component");
```

The new methods automatically forward to backend tracing when enabled - no need for separate function calls.

## Related Documentation

- **Backend Logging**: See backend Python logging documentation
- **API Contract**: See `API_CONTRACT_TESTING.md` for endpoint specifications
- **Mobile Log Management**: See backend `app/services/log_manager.py` implementation
- **Quick Reference**: See `LOGGING-QUICK-REF.md` for common patterns
