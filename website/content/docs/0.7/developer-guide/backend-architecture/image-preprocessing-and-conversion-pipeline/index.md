+++
title = "Image Preprocessing and Conversion Pipeline"
description = "Understand how Sambee preprocesses exotic image formats, how the backend conversion path is structured, and which security and configuration constraints contributors must preserve."
+++

Sambee's image preview path is not one converter with one code path.

For browser preview, the backend uses two related layers:

- `backend/app/services/image_converter.py` for the general conversion pipeline
- `backend/app/services/preprocessor.py` for formats that must be normalized before the general pipeline can produce browser-ready output

Use this page when a format change affects backend conversion behavior, external image-tool dependencies, or preprocessing policy.

## Why Preprocessing Exists

Some formats can be decoded and converted directly through the main image-conversion path.

Others need an explicit preprocessing stage first because Sambee does not rely on the normal stack to decode them safely or usefully for browser preview.

That is the current role of preprocessing for formats such as:

- `psd`
- `psb`
- `eps`
- `ai`

The design goal is direct conversion to the final browser-ready result, not a chain of intermediate file formats.

## Main Backend Pieces

| Path | Responsibility |
|---|---|
| `backend/app/services/image_converter.py` | primary image conversion path, libvips-backed processing, output-format selection, resizing, and MIME return values |
| `backend/app/services/preprocessor.py` | preprocessor abstraction, ImageMagick-backed implementation, format registry, and factory behavior |
| `backend/app/core/image_settings.py` | centralized encoder arguments and output-tuning settings |
| `imagemagick-policy.xml` | repository-managed ImageMagick policy that constrains resource and delegate behavior |

## Runtime Flow

At a high level, the backend image-preview flow is:

1. the viewer request reaches the backend preview path
2. the backend determines the file extension and preview behavior
3. the converter checks whether the extension requires preprocessing
4. preprocessable formats are sent to the registered preprocessor directly to produce browser-ready bytes
5. all other convertible formats stay on the libvips-backed conversion path
6. the viewer endpoint returns the converted bytes with the resulting MIME type

This is why preview changes can span registry metadata, service logic, environment dependencies, and viewer expectations at the same time.

## General Conversion Path

`convert_image_for_viewer(...)` in `image_converter.py` is the main entry point.

For the general conversion path it is responsible for:

- loading image data through libvips
- detecting alpha handling needs
- converting colorspaces for web-safe output
- downscaling when max dimensions are configured
- choosing a final output format such as WebP, JPEG, or PNG
- returning `(bytes, mime_type, converter_name, duration_ms)` for the caller

This is the path used for formats such as TIFF, HEIC, BMP, ICO, and similar server-converted formats that do not need the separate preprocessing registry.

## Preprocessing Path

When the extension is registered in `PreprocessorRegistry`, the converter takes a different route.

`PreprocessorRegistry.requires_preprocessing(extension)` decides whether the format uses the preprocessing path.

If it does:

1. the converter resolves the preprocessor with `get_preprocessor_for_format(...)`
2. the preprocessor converts the source bytes directly to the final browser-ready format
3. the converter returns those bytes without sending them through a second conversion stage

Current product behavior intentionally chooses:

- JPEG output for raster-oriented preprocessable formats such as PSD and PSB
- PNG output for vector-style preprocessable formats such as EPS and AI when transparency preservation matters more

That is a product behavior decision, not just an implementation convenience.

## Preprocessor Abstractions

The preprocessing service is structured around three backend concepts.

### Preprocessorinterface

`PreprocessorInterface` defines the contract every preprocessor must satisfy.

Key responsibilities include:

- `check_availability()`
- `validate_input(...)`
- `convert_to_final_format(...)`

It also centralizes file-size and timeout access through system settings so those limits do not get hard-coded in format-specific code.

### Imagemagickpreprocessor

`ImageMagickPreprocessor` is the only built-in implementation today.

It is responsible for:

- detecting ImageMagick 7 through `magick` and falling back to ImageMagick 6 through `convert`
- validating supported extensions
- converting PSD, PSB, EPS, and AI input directly to JPEG or PNG
- applying centralized output arguments from `image_settings.py`
- handling colorspace normalization, including CMYK-to-sRGB conversion behavior
- enforcing timeout and size checks before or during conversion

For vector formats such as EPS and AI, it also applies density settings so rendered output quality is usable in the browser.

### Preprocessor Registry and Factory

`PreprocessorRegistry` is the single source of truth for which extensions require preprocessing and which preprocessor class handles them.

The registry:

- normalizes extension lookup case-insensitively
- maps extensions such as `psd`, `psb`, `eps`, and `ai` to `ImageMagickPreprocessor`
- allows explicit runtime registration of additional formats
- does not implement multi-tool fallback chains itself

`PreprocessorFactory` is the configuration-oriented construction layer.

It currently supports:

- `PREPROCESSOR=imagemagick`
- `PREPROCESSOR=auto`

`auto` currently means: use ImageMagick if it is available.

## Security and Policy Constraints

The preprocessing path runs external tooling, so its constraints are part of the product contract.

Important protections include:

- repository-managed ImageMagick policy in `imagemagick-policy.xml`
- resource limits for memory, disk, and image dimensions
- disabled network delegates
- disabled indirect path reads
- application-layer behavior that pipes bytes through stdin and stdout instead of constructing shell commands around user-controlled paths

Contributors should treat these protections as required behavior. If a format change needs weaker policy or looser limits, that is an architectural change, not a local implementation tweak.

## Operational Behavior

The preprocessing path is designed to fail explicitly rather than degrade silently.

- invalid input is rejected during validation
- unavailable ImageMagick raises preprocessing errors
- timeout failures surface as preprocessing errors
- unsupported extensions are rejected by the registry path

The converter then turns preprocessing failures into user-visible conversion failures for the preview API.

## Configuration Surface

The main advanced settings for ImageMagick-backed preprocessing are:

- `preprocessors.imagemagick.max_file_size_bytes`
- `preprocessors.imagemagick.timeout_seconds`

Contributors should adjust those only when they understand the operational impact on preview latency, memory pressure, and denial-of-service resistance.

## Adding or Changing a Preprocessing Path Safely

Use this sequence when introducing a new preprocessable format or a new preprocessing backend:

1. decide that the format really belongs in preprocessing rather than the ordinary libvips-backed conversion path
2. implement or reuse a `PreprocessorInterface` subclass
3. register the extension in `PreprocessorRegistry`
4. update file-type metadata and viewer expectations if the format becomes previewable
5. validate ImageMagick policy or other tool-level constraints if the new path needs different capabilities
6. add backend tests for availability, validation, timeout behavior, and successful conversion output

If you skip the first decision, it becomes easy to route a format through preprocessing simply because it works locally, even when it weakens the long-term architecture.

## Common Failure Modes

- a new format is registered for preprocessing when the ordinary conversion path would have been safer or simpler
- extension registration and file-type metadata drift apart
- ImageMagick availability differs between local development and deployment
- policy restrictions block a format in production even though it worked in a permissive local environment
- timeout or file-size limits are raised casually to make one sample file work, increasing operational risk for everyone else

## Where to Continue

- Use [Viewer Architecture and Preview Contracts](../../frontend-architecture/viewer-architecture-and-preview-contracts/) for the browser-visible preview contract, file-type registry alignment, and viewer routing implications.
- Use [Request Flow and Service Boundaries](../request-flow-and-service-boundaries/) for the broader backend layering model.
- Use [Test Strategy Overview](../../testing-and-quality-gates/test-strategy-overview/) when the change requires wider validation coverage.

## Validation Expectations

When you change preprocessing or image-conversion architecture, usually run:

```bash
cd backend && pytest -v
cd backend && mypy app
```

If the change affects preview behavior, add the relevant frontend checks as well.
