# Clean Error Handling Plan

## Problem
When configuration errors occur (like `config.toml` being a directory), Python's default behavior shows:
1. The custom error message (good)
2. Full stack trace with dozens of lines (bad - confusing for users)

## Goal
User-facing errors should show:
- Clear, concise error message
- NO stack traces (production AND development)
- Debug details logged separately when needed

## Current State Analysis
The codebase currently uses:
- ✅ **Exception handling** for application logic (correct)
- ❌ **Return code checking** for subprocess operations with `check=False`
- ❌ Generic `RuntimeError` instead of specific exceptions
- ❌ No central error handling - stack traces everywhere

## Solution Strategy

### 1. Custom Exception Classes
Create application-specific exception hierarchy:
- `SambeeError` - Base exception for all app errors
- `ConfigurationError` - Configuration issues (startup-time)
- `StorageError` - SMB/file system issues (runtime)
- `ValidationError` - User input validation (runtime)
- `PreprocessorError` - Already exists, keep using it

### 2. Subprocess Error Handling
Replace return code checking with exception-based approach:
- Change `check=False` to `check=True` in `subprocess.run()`
- Let subprocess raise `CalledProcessError` on failure
- Catch and convert to appropriate `SambeeError` subclass
- Clean error messages without subprocess details

### 2. Exception Handler at Application Level
Add FastAPI exception handler that:
- Catches `SambeeError` and subclasses
- Logs error message cleanly (no stack trace)
- Returns appropriate HTTP response for API calls
- Shows clean error in logs

### 3. Startup Error Handler
Wrap application startup in try/except:
- Catch configuration errors before FastAPI starts
- Log clean error message
- Exit with clear error code
- NO stack trace in production

### 4. Logging Configuration Enhancement
Modify logging setup:
- Always use `exc_info=False` for all user-facing errors
- Never show stack traces in console output
- Log exception details to separate debug log file if needed
- Create helper: `log_error(msg)` - clean error only

### 5. Clean Error Display
```python
# Always clean, regardless of environment
try:
    # operation
except SomeError as e:
    logger.error(f"Config error: {e}")
    sys.exit(1)
```

## Implementation Steps

### Step 1: Create Exception Classes
File: `backend/app/core/exceptions.py`
- Define exception hierarchy
- Each exception has clear, concise message
- No technical jargon in user-facing messages

### Step 2: Create Clean Logging Helpers
File: `backend/app/core/logging.py` (extend existing)
- `log_error(msg)` - clean error, no stack trace ever
- Optional: Write stack traces to separate debug file for developers

### Step 3: Wrap Application Startup
File: `backend/app/main.py`
- Wrap lifespan() initialization
- Catch `ConfigurationError` and other startup errors
- Log cleanly and exit gracefully

### Step 4: Add FastAPI Exception Handlers
File: `backend/app/main.py`
- Register exception handler for `SambeeError`
- Return clean JSON responses
- Log without stack traces

### Step 5: Convert Return Code Checking to Exceptions
Files: `backend/app/services/preprocessor.py`
- Change `check=False` to `check=True` in subprocess.run()
- Remove manual `if result.returncode != 0` checks
- Wrap in try/except to catch `CalledProcessError`
- Convert to clean `PreprocessorError` messages

### Step 6: Convert Existing RuntimeErrors
Files: Various (config.py, security.py, etc.)
- Replace generic `RuntimeError` with specific exceptions
- Use new exception classes
- Ensure messages are user-friendly

## Benefits
✅ Clean error messages always
✅ No confusing stack traces in any environment
✅ Consistent: All errors handled the same way
✅ User-friendly: Clear, actionable messages
✅ Maintainable: Central error handling logic

## Example Output

### Before (BAD - Return Code Checking):
```python
result = subprocess.run(cmd, check=False)
if result.returncode != 0:
    error_msg = result.stderr.decode("utf-8", errors="replace")
    raise PreprocessorError(f"GraphicsMagick conversion failed: {error_msg}")
```

### After (GOOD - Exception Based):
```python
try:
    subprocess.run(cmd, check=True)
except CalledProcessError as e:
    raise PreprocessorError(f"Image conversion failed: {e.stderr.decode()}") from None
```

### Before (BAD - Stack Trace):
```
RuntimeError: 'config.toml' is a directory...
Traceback (most recent call last):
  File "/usr/local/bin/uvicorn", line 7, in <module>
    sys.exit(main())
  [50 more lines of unhelpful stack trace]
```

### After (GOOD - Clean Error):
```
ERROR: Configuration error - 'config.toml' is a directory. Remove it and don't mount config.toml.
Application startup failed. Exiting.
```

## Testing Plan
1. Test configuration errors (missing files, wrong permissions)
2. Test SMB connection errors
3. Test validation errors
4. Verify NO stack traces appear in any mode
5. Verify clean, actionable error messages
