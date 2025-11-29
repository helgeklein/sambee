# Logging & Debugging Improvements

## Overview

Comprehensive logging has been added to Sambee to make debugging easier and prevent issues like the recent auto-start failure.

## What's New

### 1. Enhanced Backend Logging

**File:** `/workspace/backend/app/main.py`

- ✅ Startup banner with timestamp, Python version, working directory
- ✅ Detailed database initialization logging
- ✅ Request/response logging middleware with timing (e.g., `→ GET /api/browse - 200 (45.2ms)`)
- ✅ Error logging with full stack traces
- ✅ Dual output: stdout + `/tmp/backend.log`

**Example output:**
```
================================================================================
Sambee Backend Starting - 2025-11-05T10:49:14.123456
Python: 3.13.0
Working Directory: /workspace/backend
================================================================================
Starting Sambee application...
Initializing database...
✅ Database initialized
Checking for admin user...
✅ Admin user exists: admin
🚀 Sambee application startup complete!
API Documentation: http://localhost:8000/docs
→ GET /api/browse/1/path/to/dir
← GET /api/browse/1/path/to/dir - 200 (45.23ms)
```

### 2. Enhanced SMB Backend Logging

**File:** `/workspace/backend/app/storage/smb.py`

- ✅ Connection attempts logged with host, port, share, username
- ✅ Success/failure logged clearly
- ✅ Disconnect logged
- ✅ All errors logged with full context

**Example output:**
```
Connecting to SMB: //fileserver:445/shared (user: bob)
✅ SMB connection established: //fileserver/shared
```

### 3. Improved Startup Scripts

**Files:** 
- `/workspace/scripts/dev-start`
- `/workspace/.devcontainer/post-start.sh`

**Features:**
- ✅ Timestamped log entries
- ✅ Process ID tracking
- ✅ Success/failure verification with timeouts
- ✅ Automatic log tail on failures
- ✅ Comprehensive status reporting
- ✅ Separate log files:
  - `/tmp/dev-start.log` - Server startup script
  - `/tmp/post-start.log` - Container post-start hook

**Example output:**
```
[2025-11-05 10:08:25] ═══════════════════════════════════════
[2025-11-05 10:08:25] 🚀 Starting Sambee development servers...
[2025-11-05 10:08:25]    Script: /workspace/scripts/dev-start
[2025-11-05 10:08:25]    PWD: /workspace
[2025-11-05 10:08:25]    User: vscode
[2025-11-05 10:08:25] ═══════════════════════════════════════
[2025-11-05 10:08:25] Starting backend server...
[2025-11-05 10:08:25]    Backend process started (PID: 680)
[2025-11-05 10:08:26] ✅ Backend started successfully (PID: 680)
[2025-11-05 10:08:26] Starting frontend server...
[2025-11-05 10:08:26]    Frontend process started (PID: 681)
[2025-11-05 10:08:28] ✅ Frontend started successfully (PID: 681)
```

### 4. Unified Log Viewer

**File:** `/workspace/scripts/logs`

**Features:**
- ✅ Shows all logs in one view
- ✅ Server status overview
- ✅ File size and modification time
- ✅ Colored output for readability
- ✅ Follow mode for real-time monitoring
- ✅ Configurable line count

**Usage:**
```bash
# View all logs (last 50 lines each)
/workspace/scripts/logs

# View last 100 lines
/workspace/scripts/logs -n 100

# Follow logs in real-time
/workspace/scripts/logs -f

# Show help
/workspace/scripts/logs -h
```

**Output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
               SAMBEE DEVELOPMENT LOGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ SERVER STATUS
✅ Backend running (PID: 680)
✅ Frontend running (PID: 681)

━━━ Container Post-Start
File: /tmp/post-start.log
Size: 2.1K | Modified: 2025-11-05 10:08:25
[log contents...]

━━━ Dev Start Script
File: /tmp/dev-start.log
Size: 1.8K | Modified: 2025-11-05 10:08:28
[log contents...]

━━━ Backend (FastAPI)
File: /tmp/backend.log
Size: 58K | Modified: 2025-11-05 10:49:14
[log contents...]

━━━ Frontend (Vite)
File: /tmp/frontend.log
Size: 218 | Modified: 2025-11-05 10:21:10
[log contents...]
```

### 5. Log Rotation Tool

**File:** `/workspace/scripts/rotate-logs`

**Features:**
- ✅ Archives large log files
- ✅ Truncates current logs (keeps file descriptors open)
- ✅ Preserves logs for historical analysis
- ✅ Shows archive location and sizes

**Usage:**
```bash
/workspace/scripts/rotate-logs
```

### 6. Comprehensive Documentation

**New Files:**
1. **`.devcontainer/STARTUP.md`**
   - Explains the three-layer auto-start system
   - Documents when each startup method runs
   - Provides troubleshooting steps

2. **`.devcontainer/TROUBLESHOOTING.md`**
   - Common issues with diagnosis commands
   - Step-by-step solutions
   - Maintenance procedures
   - Advanced debugging techniques

3. **Updated `README.md`**
   - Added "Logging & Debugging" section
   - Quick reference for log commands
   - Links to detailed docs

## Log Files Reference

| File | Purpose | When Written |
|------|---------|--------------|
| `/tmp/backend.log` | FastAPI backend logs | Server startup, requests, errors |
| `/tmp/frontend.log` | Vite frontend logs | Build output, HMR, errors |
| `/tmp/dev-start.log` | Startup script logs | When dev-start runs |
| `/tmp/post-start.log` | Container lifecycle | When post-start runs |
| `/tmp/logs-archive/` | Rotated log archives | When rotate-logs runs |

## Common Commands

```bash
# Quick status check
/workspace/scripts/logs

# Watch logs in real-time
/workspace/scripts/logs -f

# View specific log
tail -f /tmp/backend.log

# Search for errors
grep -i error /tmp/*.log

# Check server status
pgrep -f uvicorn && echo "Backend: ✅" || echo "Backend: ❌"
pgrep -f vite && echo "Frontend: ✅" || echo "Frontend: ❌"

# Rotate large logs
/workspace/scripts/rotate-logs

# Clean restart with fresh logs
/workspace/scripts/dev-stop
> /tmp/*.log
/workspace/scripts/dev-start
```

## Benefits

### Before
- ❌ No visibility into auto-start execution
- ❌ Minimal error context
- ❌ Hard to diagnose startup failures
- ❌ No request timing information
- ❌ Scattered log locations

### After
- ✅ **Full visibility** - Every step logged with timestamps
- ✅ **Rich context** - Stack traces, PIDs, timing, file paths
- ✅ **Easy diagnosis** - Unified log viewer shows everything
- ✅ **Performance insight** - Request timing in ms
- ✅ **Organized logs** - Centralized in `/tmp/` with clear names
- ✅ **Historical analysis** - Log rotation preserves history
- ✅ **Comprehensive docs** - Troubleshooting guide for common issues

## Debugging Workflow

When something goes wrong:

1. **Check status:**
   ```bash
   /workspace/scripts/logs
   ```

2. **Identify the problem:**
   - Look for ❌ marks in output
   - Check server status section
   - Read recent log entries

3. **Get more detail:**
   ```bash
   /workspace/scripts/logs -n 100
   # or
   tail -100 /tmp/backend.log
   ```

4. **Search for errors:**
   ```bash
   grep -i "error\|exception\|failed" /tmp/*.log
   ```

5. **Follow the troubleshooting guide:**
   - Open `.devcontainer/TROUBLESHOOTING.md`
   - Find your issue
   - Follow the solution steps

6. **If still stuck:**
   - Enable debug logging (see troubleshooting guide)
   - Collect diagnostics
   - Check documentation or create issue

## Testing the Logging

To verify the logging improvements work:

1. **Stop servers:**
   ```bash
   /workspace/scripts/dev-stop
   ```

2. **Clear logs:**
   ```bash
   > /tmp/backend.log
   > /tmp/frontend.log
   > /tmp/dev-start.log
   > /tmp/post-start.log
   ```

3. **Start servers:**
   ```bash
   /workspace/scripts/dev-start
   ```

4. **View logs:**
   ```bash
   /workspace/scripts/logs
   ```

You should see:
- Detailed startup sequence with timestamps
- Process IDs
- Success confirmations
- Backend startup banner
- Frontend Vite ready message

## Future Enhancements

Potential improvements for the future:
- [ ] Log aggregation for production deployments
- [ ] Prometheus metrics endpoint
- [ ] Error alerting/notifications
- [ ] Log analysis tools
- [ ] Structured JSON logging for better parsing
- [ ] Request correlation IDs for tracing
