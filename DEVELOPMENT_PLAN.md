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

## Enhanced File Preview & Viewing

### Rich Preview Support

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

## UI/UX Enhancements

### Professional Mobile UI

  - [x] **File List**
    - Principles:
      - Maximize screen space for the actual list
      - Follow layout best practices from established file management apps.
    - Sections from top to bottom:
      - Top bar with:
        - Name of the current directory or view
        - Icon for moving one directory level up
        - Hamburger menu
      - Search bar
      - File list with:
        - Sorting options at the top
    - Reloading via pull down gesture
    - Hamburger menu contents:
      - App logo
      - Root (of the current share)
      - Settings

### Advanced Browser Features

  - [ ] **Multi-select & Batch Operations**
  - Shift+Click for range selection
  - Ctrl/Cmd+Click for individual items
  - Bulk download (as ZIP)
  
- [ ] **File Operations**
  - Download single files
  - Download folders (as ZIP)
  - Backend: implement archive creation endpoint
  
- [ ] **Enhanced Search**
  - Server-side search (for large directories) (?)
  - Fuzzy search option
  - Search within subdirectories (recursive)
  - Filter by type, date, size
  
- [ ] **View Modes**
  - Grid view (thumbnails for images)
  - List view (current)
  - Detail view (with extended metadata)
  - User preference persistence

### Navigation & Layout

- [ ] **Breadcrumb Improvements**
  - Dropdown for intermediate paths (like VS Code) (?)
  - Copy path functionality
  
- [ ] **Split View / Dual Pane** (?)
  - Browse two directories side-by-side
  - Useful for comparing directories
  
- [ ] **Recent Files / Favorites**
  - Track recently accessed files
  - Bookmark frequently used paths
  - Persist per user in database

### Visual Polish

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

- [ ] **Theming Systems**
  - UI theming (colors, font sizes)
  - Switch between different themes
  - Additional themes to be added by users

---

## Performance & Scalability

### Frontend Optimizations

- [ ] **Code Splitting**
  - Lazy load preview components
  - Route-based splitting
  - Reduce initial bundle size
  
- [ ] **Service Worker / PWA**
  - Offline support for UI
  - Cache static assets
  - Install as desktop app

### Monitoring & Observability

- [ ] **Metrics & Analytics**
  - Prometheus metrics endpoint
  - Track: API latency, error rates, active connections
  
- [ ] **Structured Logging**
  - JSON log format for production
  - Log aggregation (ELK stack compatible)
  - ✅ Request tracing IDs
  
- [ ] **Health Checks**
  - Deep health endpoint (check DB, SMB connectivity)
  - Readiness/liveness probes for K8s

---

## Security & Compliance

### Authentication & Authorization

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

### Security Hardening

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

## Multi-Protocol Support

### Protocol Abstraction

- [ ] **Refactor Storage Layer**
  - Make `StorageBackend` truly pluggable
  - Clean interface for all protocols
  
- [ ] **Additional Protocols**
  - **FTP/SFTP**: Common in legacy systems
  - **WebDAV**: Nextcloud, ownCloud support (?)
  - **S3-compatible**: MinIO, AWS S3, R2
  - **Google Drive / Dropbox**: OAuth-based cloud storage
  
- [ ] **Connection Type Detection**
  - Auto-detect protocol from URL
  - Smart defaults for ports, paths

---

## Collaboration & Sharing (?)

### Sharing Features

- [ ] **Share Links**
  - Generate time-limited, password-protected links
  - Share files/folders with non-users
  - Track link usage
  
- [ ] **Permissions System**
  - Read-only vs read-write users
  - Per-connection permissions
  - Share-level ACLs

### Comments & Annotations

- [ ] **File Comments**
  - Add notes to files/folders
  - Collaborative annotations
  - Activity feed

---

## Administration & Operations

### Admin Dashboard

- [ ] **User Management UI**
  - CRUD users via web interface
  - Role assignment (admin/regular)
  - Password reset
  
- [ ] **Connection Management Improvements**
  - Connection health monitoring
  - Auto-reconnect on failure
  
- [ ] **System Settings**
  - Configure: log level, cache TTL, max file size
  - Feature flags for new features
  - Email/notification settings

### Deployment & Operations

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

1. **Improve directory_monitor.py coverage**
   - Add tests for edge cases: rapid changes, network failures
   - Mock SMB connection failures
   
2. **Type Safety**
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
   - ✅ API documentation (OpenAPI/Swagger - FastAPI does this)
   - User guide for keyboard shortcuts, features
   - ✅ Developer setup guide
   
3. **Code Review Standards**
   - ✅ All code passes lint (Ruff/Biome)
   - ✅ Tests included with PRs
   - Performance considerations documented

---

## Elegant Architecture Principles

### **Separation of Concerns**

   - Keep preview components independent and composable
   - Protocol implementations strictly adhere to `StorageBackend` interface
   - Clear boundaries: API → Service → Storage

### **Progressive Enhancement**
   - Basic functionality works without JS (server-rendered fallback)
   - Preview degrades gracefully for unsupported types
   - Mobile-first, responsive design

### **Performance by Default**
   - Lazy load everything possible
   - Stream large files, never load fully into memory
   - Database indexes on frequent queries
   - CDN-ready static assets

### **Security by Design**
   - Principle of least privilege
   - ✅ Encrypted credentials at rest
   - Secure defaults (HTTPS, SameSite cookies)
   - Regular dependency updates

### 5. **Developer Experience**
   - ✅ Consistent code style (enforced by tools)
   - Clear error messages with actionable advice
   - ✅ Fast feedback loop (hot reload, quick tests)
   - Documentation as code

---

## Success Metrics

- **Performance**: <100ms API response time (p95)
- **Coverage**: >85% test coverage (backend & frontend)
- **Security**: Zero critical vulnerabilities
- **UX**: <3 clicks to any major feature
