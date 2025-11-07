# Comprehensive Test Coverage Plan for Sambee

## Current State Analysis

**Overall Coverage: 49% (464/905 statements uncovered)**

### Critical Coverage Gaps
- ❌ `websocket.py`: **16%** - Real-time notifications completely untested
- ❌ `directory_monitor.py`: **13%** - SMB monitoring logic nearly untested
- ❌ `preview.py`: **27%** - File streaming and downloads barely tested
- ⚠️ `smb.py`: **34%** - Core storage backend needs comprehensive tests
- ⚠️ `main.py`: **53%** - Application lifecycle and middleware under-tested
- ⚠️ `auth.py`: **77%** - Missing token expiration and edge cases
- ⚠️ `browser.py`: **84%** - Missing error scenarios
- ⚠️ `admin.py`: **89%** - Missing comprehensive validation tests

---

## Phase 1: Preview API (app/api/preview.py) ✅ COMPLETED

**Status**: ✅ COMPLETED  
**Current Coverage**: 95% (59 statements, 3 missed)  
**Target Coverage**: 95%  
**Priority**: High  
**Test File**: `tests/test_preview.py`  
**Tests Implemented**: 24/24 passing

### Coverage Goals
1. **File Streaming Tests**
   - Stream text files (markdown, txt, code)
   - Stream binary files (images, PDFs)
   - Stream large files (>10MB)
   - Handle chunk size variations
   - Test partial reads/connection drops

2. **Download Tests**
   - Download with correct Content-Disposition header
   - Download with proper filename escaping
   - Download binary files
   - Download empty files
   - Download files with special characters in names

3. **MIME Type Tests**
   - Correct MIME detection for common types
   - Fallback for unknown types
   - Override MIME types when necessary

4. **Error Scenarios**
   - Non-existent files (404)
   - Directories instead of files (400)
   - Invalid connection IDs (404)
   - Missing share names (400)
   - SMB connection failures (500)
   - Permission denied errors (500)
   - Corrupted/locked files

5. **Authentication & Authorization**
   - Require authentication for preview
   - Require authentication for download
   - Regular users can access files
   - Token validation

6. **Edge Cases**
   - File paths with special characters
   - Unicode filenames
   - Very long paths
   - Root-level files
   - Nested directory files

---

## Phase 2: WebSocket Tests (websocket.py: 16% → 85%+)

**Test File:** `tests/test_websocket.py`

### Coverage Goals
1. **Connection Management**
   - Successful WebSocket connection
   - Connection acceptance
   - Disconnection cleanup
   - Multiple concurrent connections
   - Connection timeout handling

2. **Subscription Management**
   - Subscribe to single directory
   - Subscribe to multiple directories
   - Unsubscribe from directory
   - Multiple clients subscribe to same directory
   - Last subscriber triggers monitoring stop

3. **Directory Monitoring Integration**
   - First subscriber starts SMB monitoring
   - Last unsubscriber stops SMB monitoring
   - Connection details retrieved from DB correctly
   - Invalid connection IDs handled gracefully
   - Missing share names rejected

4. **Change Notifications**
   - Broadcast file creation events
   - Broadcast file modification events
   - Broadcast file deletion events
   - Multiple subscribers receive notifications
   - Correct subscription filtering

5. **Error Handling**
   - Invalid JSON messages
   - Malformed subscription requests
   - Database connection failures
   - SMB monitoring startup failures
   - Client disconnection during operation

6. **Concurrency Tests**
   - Multiple clients, multiple directories
   - Race conditions on subscribe/unsubscribe
   - Thread safety of ConnectionManager

---

## Phase 3: Directory Monitor Tests (directory_monitor.py: 13% → 75%+)

**Test File:** `tests/test_directory_monitor.py`

### Coverage Goals
1. **Monitoring Lifecycle**
   - Start monitoring a directory
   - Stop monitoring a directory
   - Monitor multiple directories simultaneously
   - Check monitoring status
   - List active monitors

2. **SMB Connection Handling**
   - Establish SMB session
   - Tree connect to share
   - Open directory handle
   - Create file system watcher
   - Proper resource ordering

3. **Change Detection**
   - Detect file creation (ACTION_ADDED)
   - Detect file modification (ACTION_MODIFIED)
   - Detect file deletion (ACTION_REMOVED)
   - Detect directory changes
   - Filter out irrelevant notifications

4. **Reconnection Logic**
   - Detect connection loss
   - Automatic reconnection attempts
   - Exponential backoff
   - Max retry limits
   - Connection state tracking

5. **Resource Cleanup**
   - Close open handles on stop
   - Disconnect tree connection
   - Close SMB session
   - Cleanup on errors
   - Thread termination
   - Prevent resource leaks

6. **Error Scenarios**
   - Authentication failures
   - Network interruptions
   - Share not found
   - Permission denied
   - Invalid paths
   - Directory deletion while monitoring

7. **Callback System**
   - Callbacks invoked correctly
   - Async callback handling
   - Callback errors don't crash monitor
   - Callback receives correct data

---

## Phase 4: SMB Backend Unit Tests (smb.py: 34% → 90%+)

**Test File:** `tests/test_smb_backend.py`

### Coverage Goals
1. **Path Construction**
   - Root path handling
   - Subdirectory paths
   - Path normalization (forward/back slashes)
   - Leading slash removal
   - Special characters in paths
   - Unicode paths
   - Path traversal prevention

2. **Connection Management**
   - Successful connection
   - Connection with custom port
   - Authentication failures
   - Session registration
   - Session reuse (no deletion)
   - Connection pooling behavior

3. **Directory Listing**
   - List empty directory
   - List directory with files and folders
   - List deeply nested directories
   - Handle hidden files (dot-prefixed)
   - Handle file attributes correctly
   - Symlink handling
   - Performance with large directories (1000+ items)

4. **File Info Retrieval**
   - Get info for file
   - Get info for directory
   - MIME type detection
   - Timestamp handling
   - File size accuracy
   - Attributes (hidden, readonly)

5. **File Reading**
   - Read small files completely
   - Read large files in chunks
   - Custom chunk sizes
   - Empty files
   - Binary vs text files
   - Handle read errors mid-stream

6. **File Existence**
   - Check existing file
   - Check existing directory
   - Check non-existent path
   - Handle permission errors
   - Handle network errors

7. **Error Handling**
   - Network timeouts
   - Authentication failures
   - Share not found
   - Path not found
   - Permission denied
   - Corrupted responses
   - SMB protocol errors

---

## Phase 5: Enhanced Existing Tests

**Test Files:** `tests/test_auth.py`, `tests/test_browser.py`, `tests/test_connections.py`

### auth.py (77% → 95%+)
- Token expiration testing
- Token refresh flows
- Invalid token formats
- Expired tokens rejected
- Token blacklisting
- Password complexity validation
- Rate limiting on login attempts

### browser.py (84% → 95%+)
- Large directory pagination
- Sorting and filtering
- Path validation (traversal prevention)
- Concurrent browse requests
- Error recovery

### admin.py (89% → 98%+)
- Duplicate connection names
- Connection name validation
- Port range validation
- Batch operations
- Connection testing edge cases
- Update with partial data
- Delete with active connections

---

## Phase 6: Main Application Tests (main.py: 53% → 80%+)

**Test File:** `tests/test_main.py`

### Coverage Goals
1. **Application Lifecycle**
   - Startup event handling
   - Database initialization on startup
   - Shutdown event handling
   - Graceful shutdown
   - Resource cleanup on shutdown

2. **Middleware**
   - CORS configuration
   - CORS headers in responses
   - Request logging middleware
   - Error handling middleware
   - Performance timing

3. **Error Handlers**
   - 404 handler
   - 500 handler
   - Validation errors (422)
   - Custom exception handlers
   - Error response format

4. **API Documentation**
   - OpenAPI schema generation
   - Swagger UI accessibility
   - ReDoc accessibility
   - API metadata

---

## Phase 7: Database Layer Tests (database.py: 70% → 95%+)

**Test File:** `tests/test_database.py`

### Coverage Goals
1. **Initialization**
   - Database creation from scratch
   - Table creation
   - Schema migrations
   - Default data seeding

2. **Session Management**
   - Session creation
   - Session cleanup
   - Transaction handling
   - Connection pooling
   - Thread safety

3. **Model Validation**
   - Foreign key constraints
   - Unique constraints
   - NOT NULL constraints
   - Default values
   - Data type validation

---

## Phase 8: End-to-End Scenario Tests

**Test File:** `tests/test_e2e_scenarios.py`

### Comprehensive Workflow Tests
1. **Complete User Journey**
   - Register new user
   - Login and receive token
   - Admin creates SMB connection
   - User browses directories
   - User previews markdown file
   - Real-time notification received
   - User downloads file
   - User logs out

2. **Multi-User Collaboration**
   - Multiple users browse same share
   - Real-time updates distributed correctly
   - Concurrent file access
   - Permission isolation

3. **Error Recovery Scenarios**
   - SMB connection drops mid-browse
   - Network interruption during file stream
   - Token expires during operation
   - Database connection lost

---

## Phase 9: Performance & Load Tests

**Test File:** `tests/test_performance.py`

### Coverage Goals
1. **Scalability**
   - 100+ concurrent users
   - 1000+ file directories
   - Multiple simultaneous file streams
   - WebSocket connection limits

2. **Resource Usage**
   - Memory usage under load
   - Connection pool exhaustion
   - Thread pool limits
   - File descriptor limits

3. **Response Times**
   - Directory listing < 1s for 1000 files
   - File preview start < 500ms
   - WebSocket notification latency < 100ms
   - API endpoint benchmarks

---

## Phase 10: Security Tests

**Test File:** `tests/test_security.py`

### Coverage Goals
1. **Injection Attacks**
   - SQL injection attempts
   - Path traversal attempts (../../etc/passwd)
   - Command injection in filenames
   - XSS in file names/content

2. **Authentication Bypass**
   - Token manipulation
   - JWT algorithm confusion
   - Token replay attacks
   - Session fixation

3. **Authorization Bypass**
   - Regular user accessing admin endpoints
   - Unauthorized connection access
   - Cross-user file access

4. **Encryption Security**
   - Password encryption strength
   - Fernet key rotation
   - Encrypted data at rest
   - Secure password hashing

5. **Rate Limiting**
   - Login attempt limits
   - API rate limiting
   - DoS prevention

---

## Implementation Priority

**Week 1:** Phase 1-2 (Preview + WebSocket)
**Week 2:** Phase 3-4 (Monitor + SMB Backend)
**Week 3:** Phase 5-7 (Enhanced + Main + Database)
**Week 4:** Phase 8-10 (E2E + Performance + Security)

**Target: 85%+ overall coverage** with comprehensive validation of all critical paths.

---

## Testing Standards

All tests must follow these standards:
- ✅ **AAA Pattern**: Arrange, Act, Assert
- ✅ **Isolation**: Each test independent and repeatable
- ✅ **Fast**: Unit tests < 100ms, integration < 1s
- ✅ **Clear Names**: `test_action_condition_expectedResult`
- ✅ **Fixtures**: Reuse setup code via pytest fixtures
- ✅ **Mocking**: Mock external dependencies (SMB, database when appropriate)
- ✅ **Coverage**: Minimum 85% per module
- ✅ **Documentation**: Docstrings explain what and why
- ✅ **Assertions**: Multiple specific assertions per test
- ✅ **Error Cases**: Test both success and failure paths

---

## Progress Tracking

- [ ] Phase 1: Preview API Tests
- [ ] Phase 2: WebSocket Tests
- [ ] Phase 3: Directory Monitor Tests
- [ ] Phase 4: SMB Backend Unit Tests
- [ ] Phase 5: Enhanced Existing Tests
- [ ] Phase 6: Main Application Tests
- [ ] Phase 7: Database Layer Tests
- [ ] Phase 8: End-to-End Scenario Tests
- [ ] Phase 9: Performance & Load Tests
- [ ] Phase 10: Security Tests
