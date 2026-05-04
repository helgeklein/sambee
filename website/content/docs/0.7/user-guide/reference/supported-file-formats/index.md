+++
title = "Supported File Formats"
description = "Summary of which file types Sambee can preview directly in the browser and what to expect when a preview is unavailable."
+++

This page lists the file types Sambee can preview directly in the browser.

## Browser Preview Categories

| Category | Extensions | What to expect |
|---|---|---|
| Common browser image formats | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`, `.avif` | Open in the image viewer with zoom, pan, and related controls. |
| Converted image formats | `.tif`, `.tiff`, `.heic`, `.heif`, `.bmp`, `.dib`, `.ico`, `.cur`, `.pcx`, `.tga`, `.ppm`, `.pgm`, `.pbm`, `.pnm`, `.xbm`, `.xpm`, `.psd`, `.psb`, `.eps`, `.ai`, `.jp2`, `.j2k`, `.jpt`, `.j2c`, `.jpc`, `.jxl`, `.exr`, `.hdr`, `.fits`, `.fit`, `.fts`, `.svs`, `.ndpi`, `.scn`, `.mrxs`, `.vms`, `.vmu`, `.bif`, `.img`, `.mat` | Sambee converts the file into a browser-ready preview before opening it in the image viewer. |
| PDF | `.pdf` | Open in the PDF viewer with page navigation, search, zoom, and download support. |
| Markdown | `.md`, `.markdown` | Open in a rendered Markdown view with an edit path available in the browser. |

## Important Limits

Preview support does not mean every file opens in exactly the same way every time.

- Very large images may be scaled for browser use.
- Multi-page or specialist image formats may preview as a simplified view rather than showing every original editing feature.
- Preview support is separate from desktop-app editing support.

## When A File Type Is Not Supported

If a file type does not have a browser preview, Sambee does not fake one.

Instead, you should expect one of these paths:

- download the file
- open it from Sambee with **Open in App**, if Sambee Companion is installed and running on your computer

For the broader workflow explanation, see [Preview Supported Files](../../viewing-and-previewing/preview-supported-files/).
