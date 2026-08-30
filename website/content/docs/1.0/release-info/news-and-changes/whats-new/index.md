+++
title = "What's New"
+++

## Quick Bar

### File Search

Sambee's quick bar is getting closer to the goal of becoming a universal search and navigation tool with the addition of file search (keyboard shortcut: <kbd>/</kbd>).

File search complements the existing directory navigation (keyboard shortcut: <kbd>Ctrl+K</kbd>) by providing instant access to recently opened files across directories as well as files in the current directory matching a user-specified search term.

File search supercedes file filtering mode which was removed.

### Directory Navigation History

Directory navigation gets a history functionality that makes it possible to instantly navigate to the folders you need most.

### Other Changes

- Changed <kbd>F1</kbd> to consistently invoke keyboard shortcuts help

## Settings & Dialogs

### New Settings

The settings gained a new category page:

- New admin **File Search** settings page

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

## Image Viewer

- Large images: better user feedback while loading

## Text and Markdown Editors

### Search and Replace

In any editor, search and replace are essential functions that need to work efficiently while providing granular control. The text and the Markdown editors got just that: compact search and replace popouts with history, regex support and full keyboard usability.

### Other Changes

- Added keyboard shortcuts help
- Added word wrap (toggled by keyboard shortcut <kbd>Alt+Z</kbd>)
- Bugfix: text selection highlighting

## Markdown Editor

- Added <kbd>Ctrl+B</kbd> and <kbd>Ctrl+I</kbd> keyboard shortcuts for bold and italic formatting

## File List

### Local Drives: Resolve .LNK Files

Shortcuts (`.lnk` files), symlinks, and junctions on local drives now show the target path (pulled in asynchronously after the directory list has loaded; we don't want to give up on that snappy UI, after all). Paths are sensibly shortened to fit the available row width. When activated, file targets are opened whereas directory targets are navigated to.

### Other Changes

- Keyboard navigation: removed delay after entering a new directory
- Typeahead buffer: cleared when <kbd>Esc</kbd> is pressed

## Miscellaneous

- Bugfix: Concurrent OIDC token refreshes would cause SQLite database lock errors.


## Under the Hood

- Frontend: improved recovery after network unavailability (e.g., after suspend/resume)

## Internals

### Release Workflow: Companion Alignment with Docker Image

Companion's release process has been simplified and aligned to match the Docker image workflow:

1. When a new Companion build is created, its GitHub release is published automatically and promoted to the `test` channel.
1. Interim Companion GitHub releases are deleted automatically when they're no longer needed.
