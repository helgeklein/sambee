# End-User Docs Plan

This file plans the structure and scope of end-user documentation.

End-user docs should help people complete tasks, understand limits, and recover from problems. They should not try to sell the product.

Within the future site structure, end-user docs are one branch under Docs. They should stay distinct from admin docs and developer docs.

The end-user docs should still inherit the homepage's current product framing so users see consistent terminology and capability boundaries:

- Sambee provides browser-based access to SMB shares and local drives
- SMB shares work directly in the browser
- Local drives and native desktop-app editing require the companion app
- Sambee supports browsing, previewing, managing files, and selected editing workflows
- Viewer support and companion app behavior should be described with the same scope as the homepage and dedicated product docs

## Product Framing To Carry Over From Homepage Work

Use the homepage wording as the source of truth for how the product is described, then convert it into task-oriented documentation language.

Core framing to preserve:

- Browser-based access to SMB shares and local drives
- The companion app extends Sambee to the local desktop
- The companion app is optional for browser-only SMB workflows
- The companion app is required for local drives and native desktop-app editing
- Rich previews include images, PDFs, and Markdown
- Sambee works on desktop and mobile, but some workflows differ by device

Terms to use consistently:

- "browser-based access" instead of vague phrases such as "browse files"
- "SMB shares" as the default network-storage term
- "local drives" for the companion-app-backed feature, except where normal sentence or title capitalization applies
- "desktop apps" or "installed desktop apps" for external editors
- Naming of the companion app:
  - Use either "Companion" (as a name, without "the") or "the companion app"
  - Only use "Companion" (as a name without article) when the meaning is already clear

Terms to avoid in end-user docs unless context demands them:

- marketing language about being a better fit than cloud tools
- vague nouns such as "platform" or "interface"
- unclear phrasing such as "native apps" when desktop apps are meant

## Documentation Principles

- Organize by user task, not by internal subsystem
- Put prerequisites and limitations near the steps they affect
- Prefer precise behavior over promotional wording
- Link to dedicated reference pages when a topic becomes too detailed
- Separate end-user guidance from admin or deployment guidance
- Do not link to files in the `documentation` folder from this plan; carry relevant material into the future docs structure instead

## Primary Audiences

- Regular users browsing SMB shares
- Users opening and editing files
- Users accessing local drives through the companion app
- Power users relying on dual-pane workflows and keyboard-driven navigation
- Administrators helping users with setup and troubleshooting

## Recommended Top-Level Structure

### 1. Getting Started

Purpose:
Help new users understand what Sambee can access, what the companion app changes, and what to expect before first use.

Suggested pages:

- What Sambee can access
- Choose the right access method
- SMB shares in the browser
- Local drives via the companion app
- When you need the companion app and when you do not
- First login
- Basic interface tour

Notes:

- The opening page should reuse the homepage's core description of Sambee, but without CTA language
- State early that SMB access works in the browser, while local drives and desktop-app editing require the companion app
- Include a short capability matrix on this page so users can immediately understand which workflows are browser-only and which depend on the companion app
- Keep the capability matrix in getting started as the single canonical version; other pages should link back to it instead of duplicating it
- Keep local drives integrated into the main getting-started, access, and companion flows unless future scope proves a separate top-level guide is necessary

### 2. Accessing Files

Suggested pages:

- Connect to an SMB share
- Access local drives
- Understand when the companion app is required
- Pair your browser with the companion app
- Connection permissions and common access errors

Notes:

- This section should absorb the homepage's "Access and navigate" feature framing and turn it into setup and workflow guidance
- Distinguish clearly between share access problems, local drive availability problems, and companion app trust or pairing problems

### 3. Browsing and Navigation

Suggested pages:

- Browse directories
- Use single-pane and dual-pane layouts
- Search and jump to directories
- Open the in-app keyboard shortcut help
- Mobile navigation behavior

Notes:

- Carry over the homepage emphasis on fast navigation, search, and keyboard-driven use
- Explain which navigation features are optimized for desktop and what changes on mobile
- Do not maintain a separate shortcut reference in the docs; explain how to open the in-app help screen instead

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
- Align the introduction of this section with the homepage claim of rich previews for images, PDFs, and Markdown
- Describe unsupported previews in operational terms: what the user sees, whether download is available, and what the companion app can and cannot help with

### 5. Editing Files

Suggested pages:

- Edit Markdown in the browser
- Open files in desktop apps with the companion app
- Save changes back to the server
- Edit locking and conflict handling
- Recover unfinished edits after a crash

Notes:

- Use the homepage's "Continue work in desktop apps" framing, but turn it into concrete task flows
- Separate browser editing from desktop-app editing so users know which path they are in
- Clarify whether save-back, locking, and crash recovery apply only to companion-app-backed editing flows

### 6. Managing Files

Suggested pages:

- Copy files
- Move files
- Rename files and folders
- Delete files and folders
- Create folders
- Upload and download files

Notes:

- Reuse the homepage's "Manage files" capability list as the checklist for coverage here
- Put limitations, permission errors, overwrite behavior, and long-running operation expectations directly on each task page

### 7. Personalization

Suggested pages:

- Change theme
- Language and localization settings
- Browser and viewing preferences

### 8. Sambee Companion

Suggested pages:

- Companion overview
- Install Sambee Companion
- First use and browser permission
- Pair your browser
- Open files in desktop apps
- Save changes back to the server
- Understand trusted browsers and origins
- Choose desktop apps for file types
- Preferences
- System tray or menu bar basics
- Startup behavior
- Notifications
- Upload conflict resolution
- Large file behavior
- Temporary file cleanup
- Updates
- Recovery after interrupted editing
- Uninstall Sambee Companion

This section should eventually link to the future end-user companion documentation, with admin-only setup or operations material routed to admin docs instead.

Notes:

- This section should inherit the homepage wording that the companion app extends Sambee to the local desktop
- Keep the optional nature of the companion app visible throughout the section
- Explain the trust model in user terms: which browser origins are allowed, what re-pairing means, and when users need to intervene
- The current `documentation/COMPANION_APP.md` file should be treated as source material for this section, not migrated as a single large page
- Split the current companion source material into smaller task pages so users can find installation, first use, editing, preferences, recovery, and troubleshooting separately

#### Migration map for current companion source material

Carry these topics from the current companion source doc into future end-user docs pages:

- Companion overview:
  - what the companion app is
  - what it unlocks
  - when it is required versus optional
- Install Sambee Companion:
  - Windows, macOS, and Linux installation steps
- First use and browser permission:
  - `sambee://` deep-link permission flow
  - first-time application selection
  - remembering the selected application
- Open files in desktop apps:
  - the "Open in App" action
  - how the file is downloaded and opened
- Save changes back to the server:
  - the "Done Editing" window
  - upload and discard actions
- Preferences:
  - trusted browsers and origins
  - startup behavior
  - desktop notifications
  - temporary file cleanup
  - upload conflict resolution settings
- Recovery after interrupted editing:
  - crash recovery choices
  - how unfinished edits reappear on next launch
- Local drive workflows:
  - the requirement that the companion app be running
  - local drive access prerequisites
- Large file behavior:
  - the confirmation step for large downloads
- Troubleshooting:
  - "Open in App" does nothing
  - file does not upload after editing
  - application picker does not show the expected editor
- Uninstall Sambee Companion:
  - user-facing uninstall steps by OS

Route these topics out of end-user docs and into future admin docs or support material:

- preference file locations
- log file locations
- Windows WebView2 runtime-data note
- platform-specific diagnostic instructions such as Event Viewer, Console.app, or terminal log inspection

Do not preserve the current companion source doc as a one-to-one page in the future docs tree:

- it mixes onboarding, task help, settings reference, troubleshooting, and support diagnostics in one place
- the future docs should separate those jobs into task-oriented end-user pages and admin-facing support content

### 9. Troubleshooting

Suggested pages:

- Cannot connect to SMB shares
- The companion app not opening
- Local drives not available
- File preview not working
- Upload or save-back failed
- Conflict detected while editing
- Unsupported file type behavior
- "Open in App" does nothing
- Application picker does not show the expected editor

Notes:

- Organize troubleshooting by symptom, not subsystem
- Reuse the capability split from the homepage and getting-started docs so users can tell whether the problem is in-browser SMB access, local drives, preview support, or companion app editing
- Keep support-heavy diagnostics such as log paths and platform-specific crash investigation out of end-user troubleshooting unless a lighter user-facing step is insufficient

### 10. FAQ

Possible questions:

- Do I need the companion app?
- Can I use Sambee on mobile?
- Which file types can Sambee preview?
- What happens if two people edit the same file?
- Can I work with local files and SMB files together?

## Suggested Entry Pages

These pages should likely exist near the top of the docs tree because they mirror the main capability areas users will infer from the homepage:

- What Sambee can do
- SMB shares in the browser
- Local drives with the companion app
- Preview files in the browser
- Edit files in desktop apps
- Viewer support reference
- Install and use Sambee Companion

## Capability Matrix To Document Early

The homepage now makes a sharper distinction between browser-only and companion-app-backed workflows. The docs should make that explicit in one early table or matrix.

Placement rule:

- Keep the matrix on the getting-started page as the single canonical version
- Do not duplicate it across multiple pages
- Other pages can summarize the relevant distinction in prose, but should link back to the getting-started matrix for the full picture

Minimum distinctions to capture:

- SMB shares: browser-based access
- Local drives: companion app required
- Image, PDF, and Markdown preview: browser-based when supported by Sambee
- Markdown editing in browser: browser workflow
- Open in desktop apps: companion app required
- Save back from desktop apps: companion app workflow
- Mobile usage: available, but desktop-app workflows are not the primary path

## Content Gaps To Cover

These topics appear important and should not be lost during the split:

- Dual-pane workflows
- How to open the in-app keyboard shortcut help
- Mobile behavior
- Companion app pairing and trust model
- Conflict resolution choices
- Recovery after crashes or interrupted edits
- Theme and localization settings
- Supported viewer formats
- Clear fallback behavior for unsupported content
- Clear explanation of browser-only versus companion-app-backed capabilities
- Consistent "What requires the companion app?" answers across task pages

## What Should Stay Outside End-User Docs

- Docker deployment details
- Reverse proxy configuration
- Backend architecture
- Logging internals
- Image conversion implementation details
- Developer-focused extension points

Those topics belong in admin docs or developer docs.


## Cross-Link Strategy

The future end-user docs should cross-link within the new docs structure, not to development-era files.

Suggested cross-link rules:

- Any page about preview behavior should link to the future end-user viewer support reference
- Any page about local drives, desktop-app editing, pairing, or recovery should link to the future end-user companion documentation
- End-user pages should link to admin docs only when the likely next action belongs to an administrator
- End-user pages should not link directly to developer docs unless the reader is explicitly being redirected for implementation details

Content to carry forward into the new docs structure:

- Existing viewer-support material should become end-user viewer support reference content
- Existing companion-app material should be split between end-user companion guidance and any admin-specific setup or operations content
- Existing deployment material should become admin docs content, not end-user docs content

Admin-docs destinations for end-user escalation should generally align with the admin plan's major areas:

- deployment, reverse proxy, and first-login issues should route to admin installation and deployment docs
- logging, service operation, and upgrade issues should route to admin operations and maintenance docs
- companion diagnostics, log paths, and support-only runtime details should route to companion app administration and support docs
- container startup, SMB connectivity, and other service-level failures should route to admin troubleshooting docs

For the current companion source doc specifically:

- Move user task flows, preferences, recovery, and uninstall steps into end-user docs
- Move diagnostics, log locations, and support-oriented runtime details into admin docs, especially companion app administration and support

## Resolved Planning Decisions

- Keep local drives integrated into the main end-user docs structure instead of creating a separate top-level guide for now
- Do not document individual keyboard shortcuts; explain how users open the in-app keyboard shortcut help screen
- Keep the capability matrix only on the getting-started page and do not duplicate it elsewhere
