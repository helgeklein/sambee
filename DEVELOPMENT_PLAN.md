# Sambee Development Plan

## Project Status Overview

**Current State:**
- ✅ Core functionality: SMB browsing, authentication, connection management
- ✅ Basic file preview (Markdown)
- ✅ WebSocket-based directory change notifications
- ✅ Excellent keyboard navigation
- ✅ Strong test coverage (Backend: 89%, Frontend: meets thresholds)
- ✅ Modern tech stack with proper tooling (Ruff, Biome, pytest, vitest)

**Test Coverage Gaps:**
- `app/services/directory_monitor.py`: 74% (needs more edge case testing)
- `app/storage/base.py`: 73% (abstract class, low priority)
- `app/main.py`: 80% (lifecycle/middleware code, acceptable)

---

## Phase 1: Enhanced File Preview & Viewing (High Priority)

### 1.1 Rich Preview Support
**Goal:** Support multiple file types beyond Markdown

**Tasks:**
- [ ] **Image Preview Component**
  - Support: PNG, JPEG, GIF, WebP, SVG
  - Features: zoom, pan, rotation, metadata display
  - Lazy loading for large images
  
- [ ] **Code/Text Preview Component**
  - Syntax highlighting (via Prism.js or Monaco Editor)
  - Line numbers, search within file
  - Support: Python, JS/TS, JSON, XML, YAML, Shell, SQL, etc.
  
- [ ] **PDF Viewer**
  - Use react-pdf or PDF.js
  - Page navigation, zoom, search
  
- [ ] **Media Preview**
  - Audio: MP3, WAV, FLAC (use HTML5 audio)
  - Video: MP4, WebM, MKV (use HTML5 video with HLS.js for streaming)
  
- [ ] **Office Document Preview**
  - Research: Microsoft Office Online viewer or LibreOffice conversion
  - Priority: DOCX, XLSX, PPTX
  - Alternative: Download-only for complex formats

**Technical Considerations:**
- Create abstract `PreviewComponent` interface
- Implement preview component registry based on MIME type
- Add size limits to prevent loading huge files
- Stream large files in chunks for preview
- Add "Download" button for unsupported formats

---

## Phase 2: UI/UX Enhancements (Medium Priority)

### 2.1 Advanced Browser Features
- [ ] **Multi-select & Batch Operations**
  - Shift+Click for range selection
  - Ctrl/Cmd+Click for individual items
  - Bulk download (as ZIP)
  
- [ ] **File Operations**
  - Download single files
  - Download folders (as ZIP)
  - Backend: implement archive creation endpoint
  
- [ ] **Enhanced Search**
  - Server-side search (for large directories)
  - Fuzzy search option
  - Search within subdirectories (recursive)
  - Filter by type, date, size
  
- [ ] **View Modes**
  - Grid view (thumbnails for images)
  - List view (current)
  - Detail view (with extended metadata)
  - User preference persistence

### 2.2 Navigation & Layout
- [ ] **Breadcrumb Improvements**
  - Dropdown for intermediate paths (like VS Code)
  - Copy path functionality
  
- [ ] **Split View / Dual Pane**
  - Browse two directories side-by-side
  - Useful for comparing directories
  
- [ ] **Recent Files / Favorites**
  - Track recently accessed files
  - Bookmark frequently used paths
  - Persist per user in database

### 2.3 Visual Polish
- [ ] **File Icons**
  - Better file type icons (use icon library like react-icons)
  - Thumbnail previews for images in list view
  
- [ ] **Dark Mode**
  - Implement theme toggle
  - Use MUI's theme system
  - Persist user preference
  
- [ ] **Animations & Transitions**
  - Smooth loading states
  - Skeleton loaders for file lists
  - Toast notifications for operations

---

## Phase 3: Performance & Scalability (Medium Priority)

### 3.1 Frontend Optimizations
- [ ] **Code Splitting**
  - Lazy load preview components
  - Route-based splitting
  - Reduce initial bundle size
  
- [ ] **Service Worker / PWA**
  - Offline support for UI
  - Cache static assets
  - Install as desktop app

### 3.2 Monitoring & Observability
- [ ] **Metrics & Analytics**
  - Prometheus metrics endpoint
  - Track: API latency, error rates, active connections
  
- [ ] **Structured Logging**
  - JSON log format for production
  - Log aggregation (ELK stack compatible)
  - Request tracing IDs (already implemented ✅)
  
- [ ] **Health Checks**
  - Deep health endpoint (check DB, SMB connectivity)
  - Readiness/liveness probes for K8s

---

## Phase 4: Security & Compliance (High Priority)

### 4.1 Authentication & Authorization
- [ ] **LDAP/Active Directory Integration**
  - Authenticate against AD
  - Map AD groups to admin roles
  
- [ ] **SAML/OAuth2 SSO**
  - Enterprise SSO support
  - SAML 2.0 or OAuth2/OIDC
  
- [ ] **API Keys**
  - Generate API keys for programmatic access
  - Scoped permissions per key
  
- [ ] **Audit Logging**
  - Log all file access, downloads
  - Admin actions (user/connection CRUD)
  - Tamper-proof audit trail

### 4.2 Security Hardening
- [ ] **Rate Limiting**
  - Per-user, per-IP limits
  - Use slowapi or custom middleware
  
- [ ] **CSRF Protection**
  - Token-based CSRF for state-changing operations
  
- [ ] **Content Security Policy**
  - Strict CSP headers
  - Prevent XSS attacks
  
- [ ] **Secret Management**
  - Support external secret stores (HashiCorp Vault, AWS Secrets Manager)
  - Rotate encryption keys
  
- [ ] **Security Scanning**
  - SAST: Bandit for Python, Semgrep
  - Dependency scanning: Dependabot, Safety
  - Container scanning: Trivy, Snyk

---

## Phase 5: Multi-Protocol Support (Low-Medium Priority)

### 5.1 Protocol Abstraction
- [ ] **Refactor Storage Layer**
  - Make `StorageBackend` truly pluggable
  - Clean interface for all protocols
  
- [ ] **Additional Protocols**
  - **FTP/SFTP**: Common in legacy systems
  - **WebDAV**: Nextcloud, ownCloud support
  - **S3-compatible**: MinIO, AWS S3, R2
  - **Google Drive / Dropbox**: OAuth-based cloud storage
  
- [ ] **Connection Type Detection**
  - Auto-detect protocol from URL
  - Smart defaults for ports, paths

---

## Phase 6: Collaboration & Sharing (Low Priority)

### 6.1 Sharing Features
- [ ] **Share Links**
  - Generate time-limited, password-protected links
  - Share files/folders with non-users
  - Track link usage
  
- [ ] **Permissions System**
  - Read-only vs read-write users
  - Per-connection permissions
  - Share-level ACLs

### 6.2 Comments & Annotations
- [ ] **File Comments**
  - Add notes to files/folders
  - Collaborative annotations
  - Activity feed

---

## Phase 7: Administration & Operations (Medium Priority)

### 7.1 Admin Dashboard
- [ ] **User Management UI**
  - CRUD users via web interface
  - Role assignment (admin/regular)
  - Password reset
  
- [ ] **Connection Management Improvements**
  - Test connection before saving
  - Connection health monitoring
  - Auto-reconnect on failure
  
- [ ] **System Settings**
  - Configure: log level, cache TTL, max file size
  - Feature flags for new features
  - Email/notification settings

### 7.2 Deployment & Operations
- [ ] **Database Migrations**
  - Alembic for schema migrations
  - Version tracking
  - Rollback support
  
- [ ] **Backup & Restore**
  - Automated DB backups
  - Configuration export/import
  - Disaster recovery docs
  
- [ ] **High Availability**
  - Multi-instance support (stateless backend)
  - Load balancer configuration
  - Sticky sessions for WebSockets

---

## Technical Debt & Code Quality

### Immediate Actions
1. **Improve directory_monitor.py coverage** (currently 74%)
   - Add tests for edge cases: rapid changes, network failures
   - Mock SMB connection failures
   
2. **Type Safety**
   - Continue using mypy strict mode ✅
   - Add type hints to remaining untyped code
   
3. **Error Handling**
   - Standardize error responses (use Problem Details RFC 7807)
   - Better error messages for users
   - Graceful degradation (e.g., preview fallback)

### Best Practices to Maintain
1. **Testing**
   - Keep coverage >80% for all new code
   - Integration tests for all new API endpoints
   - Frontend: test keyboard interactions, error states
   
2. **Documentation**
   - API documentation (OpenAPI/Swagger - FastAPI does this ✅)
   - User guide for keyboard shortcuts, features
   - Developer setup guide (already good ✅)
   
3. **Code Review Standards**
   - All code passes lint (Ruff/Biome) ✅
   - Tests included with PRs
   - Performance considerations documented

---

## Prioritized Roadmap

### Q1 2026: Core Completeness
- ✅ Image preview
- ✅ Code/text preview with syntax highlighting
- ✅ File download (single files)
- ✅ Dark mode
- ✅ Improve test coverage to 90%+

### Q2 2026: Enterprise Features
- ✅ LDAP/AD authentication
- ✅ Audit logging
- ✅ Rate limiting & security hardening
- ✅ Admin dashboard improvements
- ✅ Multi-select & bulk operations

### Q3 2026: Scale & Performance
- ✅ Redis caching
- ✅ Background jobs (Celery)
- ✅ Monitoring & metrics
- ✅ PDF viewer
- ✅ Media preview (audio/video)

### Q4 2026: Advanced Features
- ✅ Additional protocol support (FTP, S3)
- ✅ Sharing & collaboration
- ✅ Split view / dual pane
- ✅ PWA support

---

## Elegant Architecture Principles

### 1. **Separation of Concerns**
   - Keep preview components independent and composable
   - Protocol implementations strictly adhere to `StorageBackend` interface
   - Clear boundaries: API → Service → Storage

### 2. **Progressive Enhancement**
   - Basic functionality works without JS (server-rendered fallback)
   - Preview degrades gracefully for unsupported types
   - Mobile-first, responsive design

### 3. **Performance by Default**
   - Lazy load everything possible
   - Stream large files, never load fully into memory
   - Database indexes on frequent queries
   - CDN-ready static assets

### 4. **Security by Design**
   - Principle of least privilege
   - Encrypted credentials at rest ✅
   - Secure defaults (HTTPS, SameSite cookies)
   - Regular dependency updates

### 5. **Developer Experience**
   - Consistent code style (enforced by tools) ✅
   - Clear error messages with actionable advice
   - Fast feedback loop (hot reload, quick tests) ✅
   - Documentation as code

---

## Success Metrics

- **Performance**: <100ms API response time (p95)
- **Reliability**: 99.9% uptime in production
- **Coverage**: >85% test coverage (backend & frontend)
- **Security**: Zero critical vulnerabilities
- **UX**: <3 clicks to any major feature
- **Adoption**: Used by 100+ users in production

---

## Getting Started

**Next Steps:**
1. Create GitHub issues for Phase 1 tasks
2. Set up project board (Kanban)
3. Prioritize based on user feedback
4. Start with Image Preview (highest user value)

**Questions to Answer:**
- What are the most common file types users need to preview?
- Is multi-protocol support a real requirement?
- Should we support file uploads (write operations)?
- What's the target deployment scale (users, files, connections)?
