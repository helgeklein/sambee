# End-User Docs Plan

This file plans the structure and scope of end-user documentation.

End-user docs should help people complete tasks, understand limits, and recover from problems. They should not try to sell the product.

## Documentation Principles

- Organize by user task, not by internal subsystem
- Put prerequisites and limitations near the steps they affect
- Prefer precise behavior over promotional wording
- Link to dedicated reference pages when a topic becomes too detailed
- Separate end-user guidance from admin or deployment guidance

## Primary Audiences

- Regular users browsing SMB shares
- Users opening and editing files
- Users accessing Local Drives through Companion
- Power users relying on keyboard shortcuts and dual-pane workflows
- Administrators helping users with setup and troubleshooting

## Recommended Top-Level Structure

### 1. Getting Started

Purpose:
Help new users understand what Sambee can access and what they need before first use.

Suggested pages:

- What Sambee does
- Supported access methods
  - SMB shares
  - Local Drives via Companion
- First login
- Basic interface tour

### 2. Accessing Files

Suggested pages:

- Connect to an SMB share
- Access Local Drives
- Understand when the Companion is required
- Connection permissions and common access errors

### 3. Browsing and Navigation

Suggested pages:

- Browse directories
- Use single-pane and dual-pane layouts
- Search and jump to directories
- Keyboard navigation and shortcuts
- Mobile navigation behavior

### 4. Viewing Files

Suggested pages:

- View images
- View PDFs
- View Markdown
- Download unsupported files
- Supported file formats reference

Notes:

- Keep the exact format matrix in a dedicated reference page
- Explain fallback behavior when a file cannot be previewed in-browser

### 5. Editing Files

Suggested pages:

- Edit Markdown in the browser
- Open files in desktop apps with Companion
- Save changes back to the server
- Edit locking and conflict handling
- Recover unfinished edits after a crash

### 6. Managing Files

Suggested pages:

- Copy files
- Move files
- Rename files and folders
- Delete files and folders
- Create folders
- Upload and download files

### 7. Personalization

Suggested pages:

- Change theme
- Language and localization settings
- Browser and viewing preferences

### 8. Sambee Companion

Suggested pages:

- Install Sambee Companion
- Pair your browser
- Choose desktop apps for file types
- Preferences
- Startup behavior
- Notifications
- Temporary file cleanup

This section should link to the deeper companion guide in [documentation/COMPANION_APP.md](documentation/COMPANION_APP.md).

### 9. Troubleshooting

Suggested pages:

- Cannot connect to SMB shares
- Companion not opening
- Local Drives not available
- File preview not working
- Upload or save-back failed
- Conflict detected while editing
- Unsupported file type behavior

### 10. FAQ

Possible questions:

- Do I need the Companion app?
- Can I use Sambee on mobile?
- Which file types can Sambee preview?
- What happens if two people edit the same file?
- Can I work with local files and SMB files together?

## Content Gaps To Cover

These topics appear important and should not be lost during the split:

- Dual-pane workflows
- Keyboard shortcuts
- Mobile behavior
- Companion pairing and trust model
- Conflict resolution choices
- Recovery after crashes or interrupted edits
- Theme and localization settings
- Supported viewer formats
- Clear fallback behavior for unsupported content

## What Should Stay Outside End-User Docs

- Docker deployment details
- Reverse proxy configuration
- Backend architecture
- Logging internals
- Image conversion implementation details
- Developer-focused extension points

Those topics belong in admin, deployment, or developer documentation.

## Cross-Link Strategy

The future docs should cross-link to these existing materials:

- Viewer support reference: [documentation/VIEWER_SUPPORT.md](documentation/VIEWER_SUPPORT.md)
- Companion guide: [documentation/COMPANION_APP.md](documentation/COMPANION_APP.md)
- Deployment guide for admins: [documentation/DEPLOYMENT.md](documentation/DEPLOYMENT.md)

## Open Questions

- Should admin tasks live in the same docs area as end-user help, or separately?
- Do Local Drives deserve their own top-level guide?
- Should keyboard shortcuts be embedded in task pages or maintained as a dedicated reference page?
- Which troubleshooting issues are common enough to prioritize first?
