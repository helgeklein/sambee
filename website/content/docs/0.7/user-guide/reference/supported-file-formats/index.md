+++
title = "Supported File Formats"
description = "User-facing summary of which file types Sambee can preview directly in the browser and what to expect when a preview is unavailable."
+++

This page summarizes the file types Sambee can preview directly in the browser in version `0.7`.

## Browser Preview Categories

| Category | Common examples | What users should expect |
|---|---|---|
| Images | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.avif` | Open in the image viewer with zoom, pan, and related viewer controls. |
| Additional image formats through conversion | formats such as TIFF, HEIC, BMP, ICO, PSD, EPS, AI, and other specialist image types | Sambee may convert the source into a browser-friendly preview instead of showing the original format natively. |
| PDF | `.pdf` | Open in the PDF viewer with page navigation, search, zoom, and download support. |
| Markdown | `.md`, `.markdown` | Open in a rendered Markdown view with an edit path available in the browser. |

## Important Limits

Preview support is user-visible behavior, not a promise that every file opens identically in every situation.

- Very large images may be scaled for browser use.
- Multi-page or specialist image formats may preview as a simplified view rather than preserving every original editing feature.
- Preview support is separate from desktop-app editing support.

## When A File Type Is Not Supported

If a file type does not have a browser preview, Sambee does not fake one.

Instead, you should expect one of these paths:

- download the file
- open it in a desktop app through Companion, if that workflow is available to you

For the broader workflow explanation, see [Preview Supported Files](../../viewing-and-previewing/preview-supported-files/).
