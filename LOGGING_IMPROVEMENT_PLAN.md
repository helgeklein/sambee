# 📋 Logging Improvement Plan for Sambee

## Current State Analysis

**✅ What's Working Well:**
- Backend has basic structured logging with timestamps
- Request/response middleware logs all HTTP requests with timing
- Logs are written to both stdout and `/tmp/backend.log`
- Comprehensive startup/shutdown logging
- Good logging infrastructure scripts (`logs.sh`, `rotate-logs.sh`)
- Extensive documentation (`.devcontainer/LOGGING.md`)

**❌ Current Gaps:**

1. **Missing Request Correlation**
   - No request IDs to track a single request across multiple log entries
   - Can't trace a user action from frontend → backend → SMB operations
   
2. **Inconsistent Error Context**
   - Some error handlers log, others don't (e.g., `preview.py` lines 76, 143)
   - Missing contextual information (user, connection details, path)
   - Frontend errors only go to `console.error`, not persisted
   
3. **No Structured Logging**
   - Logs are plain text, not JSON
   - Hard to parse programmatically
   - Missing standardized fields (user_id, connection_id, operation, etc.)
   
4. **Frontend Logging Gap**
   - Only basic `console.log/error` statements
   - No centralized logging service
   - No log persistence or forwarding to backend
   - Debugging production issues is difficult
   
5. **Missing Observability**
   - No log levels for SMB operations (all are INFO/ERROR)
   - Missing performance metrics (cache hits, SMB latency)
   - No user action tracking
   - WebSocket connection lifecycle not fully logged

---

## 🎯 Recommended Improvements

### **Phase 1: Request Correlation & Context (High Priority)** ⭐ IN PROGRESS

**Backend Changes:**

1. **Add Request ID Middleware**
   - Generate unique request ID for each HTTP request
   - Add to response headers and all log entries
   - Store in context variable for access in nested functions

2. **Enhanced Error Logging**
   - Add request ID to all error logs
   - Include user context (username, is_admin)
   - Include operation context (connection_id, path, action)
   - Ensure all exception handlers log before raising HTTPException

3. **Consistent Logging in API Endpoints**
   - Add entry/exit logs with context to all endpoints
   - Log business operations (e.g., "Creating connection", "Testing SMB connection")
   - Include timing for expensive operations

**Example Log Format:**
```
2025-11-09 10:15:23 - request_id=abc123 - user=admin - INFO - → GET /api/browse/uuid-123/list?path=documents
2025-11-09 10:15:23 - request_id=abc123 - user=admin - INFO - SMB: Connecting to //server:445/share
2025-11-09 10:15:23 - request_id=abc123 - user=admin - INFO - SMB: Listing directory: documents (23 items)
2025-11-09 10:15:23 - request_id=abc123 - user=admin - INFO - ← GET /api/browse/uuid-123/list - 200 (45.23ms)
```

---

### **Phase 2: Frontend Logging Infrastructure (High Priority)**

**Frontend Changes:**

1. **Create Centralized Logger Service** (`src/services/logger.ts`)
   - Log levels: DEBUG, INFO, WARN, ERROR
   - Structured logging with context
   - Console output in development
   - Optional backend forwarding in production

2. **Add Error Boundary with Logging**
   - Catch React errors
   - Log with component stack trace
   - Display user-friendly error message

3. **Enhanced API Error Handling**
   - Log all API errors with request details
   - Include response status, headers, body
   - Track failed requests for retry logic

4. **User Action Tracking**
   - Log navigation events
   - Log file operations (preview, download)
   - Log WebSocket subscription/unsubscription

**Example Implementation:**
```typescript
// Frontend logger usage
logger.info('Loading directory', {
  connectionId,
  path,
  cached: !!cachedData
});

logger.error('Failed to load directory', {
  connectionId,
  path,
  error: err.message,
  status: err.response?.status
});
```

---

### **Phase 3: Structured Logging (Medium Priority)**

**Backend Changes:**

1. **Add `python-json-logger` Package**
   - Install: `python-json-logger`
   - Configure JSON formatter for file output
   - Keep human-readable format for console

2. **Structured Log Fields**
   - `timestamp`: ISO 8601
   - `level`: DEBUG/INFO/WARNING/ERROR/CRITICAL
   - `request_id`: UUID
   - `user`: username
   - `module`: Python module name
   - `operation`: High-level operation (list_directory, create_connection)
   - `connection_id`: SMB connection UUID
   - `path`: File/directory path
   - `duration_ms`: Operation duration
   - `error`: Error message if applicable
   - `error_type`: Exception class name
   - `trace_id`: For distributed tracing (future)

3. **Benefits:**
   - Easy parsing with `jq` or log aggregators
   - Queryable logs (e.g., "show all errors for user=bob")
   - Better integration with monitoring tools

---

### **Phase 4: Enhanced Diagnostics (Medium Priority)**

**Backend Changes:**

1. **SMB Operation Logging**
   - Log every SMB operation with timing
   - Track connection pool usage
   - Log retry attempts
   - Monitor slow operations (threshold: 1000ms)

2. **Directory Monitor Logging**
   - Log subscription/unsubscription events
   - Track active monitors count
   - Log change notifications with details
   - Monitor memory/resource usage

3. **Database Query Logging** (Optional)
   - Log slow queries (threshold: 100ms)
   - Track connection pool stats

**Frontend Changes:**

1. **Performance Monitoring**
   - Log render times for large directories
   - Track cache hit/miss rates
   - Monitor WebSocket reconnection attempts

2. **Network Request Logging**
   - Log all API calls with timing
   - Track retry attempts
   - Monitor request queue depth

---

### **Phase 5: Production-Ready Features (Low Priority)**

1. **Log Forwarding**
   - Frontend: Send critical errors to backend endpoint
   - Backend: Forward to centralized logging (Loki, ELK, etc.)

2. **Log Sampling**
   - Sample DEBUG logs in production (e.g., 10%)
   - Always log WARN/ERROR

3. **Sensitive Data Filtering**
   - Redact passwords from logs
   - Mask tokens (show first/last 4 chars)
   - Filter PII if applicable

4. **Health Check Enhancements**
   - Add `/api/health/detailed` endpoint
   - Include component health (DB, SMB connections)
   - Recent error summary

5. **Admin Dashboard**
   - Recent errors view
   - Active connections/monitors
   - Log search/filter interface

---

## 📝 Implementation Priority

**Must Have (Week 1-2):**
1. ✅ Request ID middleware
2. ✅ Consistent error logging in all API endpoints
3. Frontend logger service
4. Enhanced API error handling in frontend

**Should Have (Week 3-4):**
5. Structured JSON logging (backend)
6. SMB operation timing logs
7. WebSocket lifecycle logging
8. Error boundary (frontend)

**Nice to Have (Future):**
9. Log forwarding to backend
10. Performance monitoring
11. Admin dashboard for logs
12. Log sampling

---

## 🔧 Technical Details

### Backend Files to Modify:
- `backend/app/main.py` - Add request ID middleware
- `backend/app/api/*.py` - Enhance error logging
- `backend/app/storage/smb.py` - Add operation timing
- `backend/app/services/directory_monitor.py` - Enhanced lifecycle logging
- `backend/requirements.txt` - Add `python-json-logger` (Phase 3)

### Frontend Files to Create/Modify:
- `frontend/src/services/logger.ts` - **NEW** Centralized logger
- `frontend/src/services/api.ts` - Enhanced error logging
- `frontend/src/pages/Browser.tsx` - Add logging hooks
- `frontend/src/components/ErrorBoundary.tsx` - **NEW** Error boundary
- `frontend/package.json` - Add dev logging dependencies

### Configuration Files:
- `backend/app/core/config.py` - Add log level settings
- `.env` - Add `LOG_LEVEL=INFO` option

---

## 📊 Success Criteria

When a problem occurs, logs should contain:

**✅ Backend:**
- Request ID linking all operations
- Username who made the request
- Connection details (host, share, path)
- Full error message with stack trace
- Operation timing
- SMB-specific context

**✅ Frontend:**
- User action that triggered the error
- API request details (URL, method, payload)
- Response details (status, error message)
- Component/page where error occurred
- Browser console has same request ID as backend

**✅ Debugging Workflow:**
1. User reports: "Can't access /documents folder"
2. Check frontend logs: See request ID `abc123`
3. Check backend logs: `grep abc123 /tmp/backend.log`
4. See full trace: User → API → SMB connection → Error
5. Root cause identified in < 2 minutes

---

## 📅 Implementation Status

- **Phase 1**: ✅ **COMPLETED** (November 9, 2025)
  - ✅ Request ID middleware with context propagation
  - ✅ Context-aware logging adapter
  - ✅ Enhanced error logging in all API endpoints
  - ✅ User context tracking
  - ✅ X-Request-ID header in responses
  - ✅ Comprehensive logging with connection details
- **Phase 2**: ⏸️ Planned
- **Phase 3**: ⏸️ Planned
- **Phase 4**: ⏸️ Planned
- **Phase 5**: ⏸️ Planned
