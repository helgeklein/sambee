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

## Settings & Dialogs

### New Settings

The settings gained a new category page:

- New admin **File Search** settings page

## PDF Viewer

### New Approach to Normalization

Earlier versions normalized every PDF with Ghostscript. This introduced occasional issues and slowed down the viewer. Sambee now opens PDFs in their original form first. When a PDF cannot be displayed because its internal structure is incompatible with the viewer, Sambee can create a separate normalized version for viewing; the original file is never modified. Compatibility processing is limited by file size, processing time, memory, and temporary storage, and each normalized PDF is checked before use.

### Other Changes

- Swipe to move between pages on mobile
- Bugfix: geometry changes between pages, e.g., from portrait to landscape, would create endless "flicker loop"
