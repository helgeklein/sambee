# Image Preprocessing Architecture

This document describes the current preprocessing system for formats that
libvips cannot decode natively.

## Overview

Sambee preprocesses PSD, PSB, EPS, and AI files with ImageMagick before they
are returned to the viewer. Conversion is direct and fully in-memory.

```
input bytes
  -> ImageMagick preprocessor (stdin -> stdout)
  -> browser-ready JPEG or PNG bytes
```

## Components

### PreprocessorInterface

`PreprocessorInterface` defines the shared contract for preprocessors:

- `check_availability()`
- `validate_input(...)`
- `convert_to_final_format(...)`

It also centralizes file-size and timeout access through system settings.

### ImageMagickPreprocessor

`ImageMagickPreprocessor` is the only built-in implementation.

Responsibilities:

- detect ImageMagick 7 via `magick` or fall back to ImageMagick 6 via `convert`
- validate supported extensions
- convert PSD, PSB, EPS, and AI files directly to JPEG or PNG
- apply centralized output settings from `IMAGE_SETTINGS`
- handle CMYK-to-sRGB conversion where needed

### PreprocessorRegistry

`PreprocessorRegistry` maps preprocessable extensions to
`ImageMagickPreprocessor`. There is no multi-tool fallback chain.

### Image Converter Integration

`convert_image_for_viewer()` checks whether the incoming file requires
preprocessing. If it does, it resolves the registered preprocessor, performs the
conversion, and returns the converted bytes with converter name `ImageMagick`.

## Supported Formats

- `psd`
- `psb`
- `eps`
- `ai`

Raster-oriented formats are emitted as JPEG. Vector-style formats that may need
transparency preservation are emitted as PNG.

## Security Model

ImageMagick is constrained by the repository-managed policy file:

- repository file: `imagemagick-policy.xml`
- container target: `/etc/ImageMagick-7/policy.xml`

Important protections:

- resource limits for memory, disk, and image dimensions
- network delegates disabled
- indirect path reads disabled
- no shell invocation in the application layer

## Operational Behavior

- preprocessing is fully in-memory via stdin/stdout
- invalid input is rejected before conversion
- missing ImageMagick raises `PreprocessorError`
- timeouts raise `PreprocessorError`

## Configuration

Advanced settings:

- `preprocessors.imagemagick.max_file_size_bytes`
- `preprocessors.imagemagick.timeout_seconds`

Supported environment values:

- `PREPROCESSOR=imagemagick`
- `PREPROCESSOR=auto`

`auto` currently resolves to ImageMagick if it is installed.

## Extending the System

To add a new preprocessing tool or format:

1. Implement a `PreprocessorInterface` subclass.
2. Register the extension in `PreprocessorRegistry._FORMAT_REGISTRY`.
3. Add file-type metadata if needed.
4. Add tests covering availability, validation, and conversion behavior.

## Related Documentation

- [IMAGE_PREPROCESSOR_REGISTRY.md](./IMAGE_PREPROCESSOR_REGISTRY.md)
- [ADDING_NEW_FILE_TYPES.md](./ADDING_NEW_FILE_TYPES.md)
