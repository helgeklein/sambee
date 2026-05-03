+++
title = "Supported File Formats"
description = "User-facing summary of which file types Sambee can preview directly in the browser and what to expect when a preview is unavailable."
+++

This page lists the complete set of file types Sambee can preview directly in the browser.

## Browser Preview Categories

| Category | Extensions | What users should expect |
|---|---|---|
| Browser-native images | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`, `.avif` | Open in the image viewer with zoom, pan, and related viewer controls. |
| Converted images | `.tif`, `.tiff`, `.heic`, `.heif`, `.bmp`, `.dib`, `.ico`, `.cur`, `.pcx`, `.tga`, `.ppm`, `.pgm`, `.pbm`, `.pnm`, `.xbm`, `.xpm`, `.psd`, `.psb`, `.eps`, `.ai`, `.jp2`, `.j2k`, `.jpt`, `.j2c`, `.jpc`, `.jxl`, `.exr`, `.hdr`, `.fits`, `.fit`, `.fts`, `.svs`, `.ndpi`, `.scn`, `.mrxs`, `.vms`, `.vmu`, `.bif`, `.img`, `.mat` | Sambee converts the source into a browser-friendly preview before opening it in the image viewer. |
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
