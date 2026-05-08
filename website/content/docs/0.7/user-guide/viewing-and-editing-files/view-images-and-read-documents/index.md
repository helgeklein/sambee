+++
title = "View Images & Read Documents"
+++

Sambee can display many types of files directly in the browser.

## Images

The image viewer is optimized for speed and efficiency, making it possible to browse even large collections of high-resolution images smoothly.

When possible, Sambee passes images through unchanged from storage to the browser. This happens when the file size is not too large and the image format is natively supported by browsers. In all other cases, images are converted on the fly on the server. This typically takes only a few hundred milliseconds and enables Sambee to support a [wide range of image formats](../../reference/supported-file-formats/).

Sambee's image viewer comes with controls such as:

- Zoom
- Pan
- Rotate
- Full-screen
- Previous/next
- Download

While the image viewer optimizes images for display in the browser, downloaded images are always the unaltered original.

## PDFs

PDF files are preprocessed on the server to maximize compatibility and potentially reduce file size.

Sambee's PDF viewer comes with controls such as:

- Search
- Zoom
- Pan
- Rotate
- Full-screen
- Previous/next
- Download

PDF search works in any PDF document that has a text layer.

While the PDF viewer optimizes documents for display in the browser, downloaded files are always the unaltered original.

## Markdown

Markdown files are shown fully rendered for easier reading rather than as raw source code.

Sambee's Markdown viewer comes with controls such as:

- Search
- Full-screen
- Previous/next
- Download

Markdown editing is covered separately in [Edit Markdown](../edit-markdown/).

## Full List of Supported File Types

See [Supported File Formats](../../reference/supported-file-formats/) for a complete list of supported file types.
