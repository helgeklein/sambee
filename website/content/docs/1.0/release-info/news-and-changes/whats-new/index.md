+++
title = "What's New"
+++

## Quick Bar

### File Search

With the addition of file search (keyboard shortcut: <kbd>/</kbd>), Sambee's quick bar is becoming a universal search and navigation tool.

File search complements the existing directory navigation (keyboard shortcut: <kbd>Ctrl+K</kbd>) by providing instant access to recently opened files across directories. File search supersedes file filtering mode, which was removed.

### Directory Navigation History

Directory navigation now has a history. When you're looking for something, just open the quick bar in directory nav mode and it'll probably already be there. If not, typing a few characters of the name should bring it up in milliseconds.

### Other Changes

- Changed <kbd>F1</kbd> to consistently invoke keyboard shortcuts help

## Text and Markdown Editors

### Search and Replace

In any editor, search and replace are essential functions that need to work efficiently while providing granular control. The text and the Markdown editors got just that: compact search and replace popouts with history, regex support and full keyboard usability.

### Other Changes

- Added keyboard shortcuts help
- Added word wrap (toggled by keyboard shortcut <kbd>Alt+Z</kbd>)
- Added viewport scrolling (keyboard shortcut <kbd>Ctrl+Arrow up/down</kbd>)
- Fixed text selection highlighting
- Fixed `lock not found or expired` when saving

### Markdown Editor

- Added <kbd>Ctrl+B</kbd> and <kbd>Ctrl+I</kbd> keyboard shortcuts for bold and italic formatting

## PDF Viewer

### More Speed and Higher Fidelity: New Approach to Normalization

Earlier versions normalized every PDF with Ghostscript. This introduced occasional issues and slowed down the viewer. Sambee now opens PDFs in their original form first. When a PDF cannot be displayed because its internal structure is incompatible with the viewer, Sambee can create a separate normalized version for viewing; the original file is never modified. Compatibility processing is limited by file size, processing time, memory, and temporary storage, and each normalized PDF is checked before use.

### Other Changes

- Mobile: swipe to move between pages
- Encrypted PDFs: the user is now asked to enter a password
- Large PDFs: better user feedback while loading
- Color rendering: support for ICC profiles and CMYK
- Image codecs: support for JPEG 2000 (JXL)
- Bugfix: geometry changes between pages, e.g., from portrait to landscape, would create endless "flicker loop"
- Bugfix: page rotation commands in the file were not honored

## File List

### ZIP Archive Creation, Inspection, and Extraction

Sambee lets you navigate seamlessly into ZIP archives the same way you'd navigate into subdirectories to explore their contents. The UX is instantaneous - only the relevant parts of the ZIP file are decoded. When extracting or compressing, the archive is streamed directly from source to target to minimize CPU, memory, and disk utilization. ZIP operations, like any other, are fully supported across backend boundaries, i.e., between SMB connections and local drives.

The addition of ZIP archive inspection was the right opportunity to implement storage and content provider abstraction layers. These new abstractions centralize knowledge of storage backends (e.g., SMB, Companion) and how to work with the data on the storage (e.g., regular files, archives), respectively. Introducing these abstractions significantly improves the product's architecture and will greatly simplify adding additional backends or container file types in the future.

### Upload & Download

A product like Sambee needs efficient ways to get files and folders in and out of the system. To upload files or folders to SMB or local drive destinations, either drag them to Sambee's file browser or select the **Upload** (<kbd>Ctrl+U</kbd>) command in the bottom toolbar. To download files or folders, choose files and/or folders and select the **Download** (<kbd>Ctrl+D</kbd>) command in the bottom toolbar.

Downloading creates a temporary ZIP archive from the selected files and folders, which is then streamed to the browser and subsequently deleted. Sambee allows downloading from all locations: from SMB connections, from local drives, and even from inside ZIP archives.

### Local Drives: Resolve .LNK Files

Shortcuts (`.lnk` files), symlinks, and junctions on local drives now show the target path in the status bar. The target information is pulled in asynchronously after the directory list has loaded - we don't want to give up on that snappy UI, after all. Paths are sensibly shortened to fit the available row width.

When activated, file targets are opened whereas directory targets are navigated to.

### File Copy and Move: Overwrite Options

Copy and move operations can now overwrite an existing file or replace it only when the source is newer. The same choices work for batches and apply to all supported local and SMB transfers. Directories with the same name are merged safely, preserving destination-only content and resolving only conflicting files.

### Command Toolbar (Desktop) & Per-Row Actions (Mobile)

A new toolbar at the bottom of the file list makes available commands discoverable. On small screens, typical mobile controls are used instead: a "+" icon to create new files or directories and per-row action menus to access commands that operate on individual files or folders.

### Item Selection on Small Screens (Mobile)

On phones and other small screen devices, files and folders can be selected either through a long press or via the item action menu. Once one item is selected, Sambee switches to multi-selection mode where additional items can be selected through a single tap. An action bar at the bottom of the screen provides access to commands.

### File Metadata on Small Screens (Mobile)

On phones and other small screen devices, file size and modification time are now displayed in a two-line layout.

### Other Changes

- Added a toolbar button to switch between single-pane and dual-pane modes.
- When keyboard shortcuts are ignored (because inapplicable in the current situation), Sambee now shows a toast message to make the user unobtrusively aware of the fact.
- Keyboard navigation: removed delay after entering a new directory.
- Typeahead buffer: cleared when <kbd>Esc</kbd> is pressed.
- The status bar is now always shown.

## Settings

### No More Save Button

Clicking a save button at the bottom of the page after adjusting some configuration settings is easily forgotten. So best get rid of that pesky save button altogether. Modern UIs like Sambee's are clever enough to apply config changes automatically and show the user that saving happened through subtle visual cues.

### New Settings

The settings gained a new category page:

- New admin settings page: **File Search**

File browser settings:

- **Touch-friendly file selection:** controls how mobile-style file selection is enabled (auto, always on, off).

System settings:

- **Temporary archive download size limit:** sets the maximum size of the temporary ZIP archive created when multiple items are downloaded.

### Other Changes

- Localization: Timestamps weren't properly localized in some settings pages (account, user management).

## Image Viewer

- Large images: better user feedback while loading

## Miscellaneous

- Mobile UI: text size increase to improve readability
- PWA on Chrome on Android: changed the system status bar color from the default blue to gold, matching Sambee's top bar
- OIDC configuration fields now accept multiple group names as advertised
- Bugfix: Concurrent OIDC token refreshes would cause SQLite database lock errors.
- Unicode: file and directory names are normalized to Unicode NFC (single characters) when renamed or created/copied/moved.

## Under the Hood

- Frontend: improved recovery after network unavailability (e.g., after suspend/resume)
- Security: updated all **dependencies** with known vulnerabilities to fixed versions

## Internals

### Release Workflow: Companion Alignment with Docker Image

Companion's release process has been simplified and aligned to match the Docker image workflow:

1. When a new Companion build is created, its GitHub release is published automatically and promoted to the `test` channel.
1. Interim Companion GitHub releases are deleted automatically when they're no longer needed.

### Other Changes

- Dependency security: The backend's lockfile update process was simplified so that Dependabot can now update lockfiles, too. This removes the need to check out Dependabot PRs locally just to run a lockfile update script.
