+++
title = "Viewer Architecture And Preview Contracts"
description = "Understand how Sambee chooses viewers, how file-type registries stay aligned, and what contributors must preserve when preview behavior changes."
+++

Preview behavior in Sambee is a cross-boundary contract, not just a frontend component choice.

## The Core Contract

The browser app decides how to render a file based on metadata and file-type information, but that depends on server-side classification staying aligned.

Three rules matter most:

- the backend and frontend file-type registries must describe the same extensions and MIME types
- the backend decides whether an image format needs server-side conversion for browser compatibility
- the frontend chooses the right viewer component and file icon based on the effective file type and MIME information it receives

## Where The Main Decisions Live

| Path | Responsibility |
|---|---|
| `backend/app/utils/file_type_registry.py` | backend source of truth for extensions, MIME types, categories, and whether an image requires conversion |
| `frontend/src/utils/FileTypeRegistry.ts` | frontend source of truth for extensions, MIME types, categories, viewer components, icons, and colors |
| `frontend/src/components/Viewer/` | viewer components and shared viewer UI |
| `backend/app/services/image_converter.py` | server-side conversion for non-browser-native image formats |

## Viewer Selection Model

At a high level, the preview pipeline works like this:

1. the backend determines file category and MIME behavior
2. the backend decides whether the file can stream as-is or needs image conversion
3. the frontend maps the file type to the appropriate viewer component
4. the shared viewer controls keep the toolbar and common behavior consistent across viewers

That is why a file-type change almost always touches both backend and frontend code.

## Browser-Native Versus Server-Converted Images

Sambee supports both browser-native formats and formats that need server-side conversion.

- browser-native formats can be sent to the viewer directly
- non-browser-native image formats are converted on the server before the browser renders them
- special cases such as transparency preservation can change the output format choice

If you change conversion rules, you are changing a product contract, not just an implementation detail.

## Shared Viewer UI

The UI for image and PDF viewers is intentionally centralized.

- shared toolbar behavior lives in `ViewerControls`
- image-specific and PDF-specific features are enabled through configuration, not duplicate toolbar code
- future viewers should reuse that common shell when possible instead of inventing a parallel control surface

## Adding A New File Type Safely

For a new file type, keep the workflow disciplined.

1. add the type to the backend registry
2. add the matching type to the frontend registry
3. decide whether the format is browser-native or requires conversion
4. connect it to the right viewer component and icon treatment
5. update the user-facing docs where preview support changes
6. run the relevant tests and validation checks

The highest-risk mistake is letting the two registries drift apart.

## Common Failure Modes

- backend and frontend MIME types do not match
- a format is marked browser-native when it really needs conversion
- a viewer component is not registered even though the type is recognized
- docs are not updated after user-visible preview support changes
- a conversion change improves one format but breaks gallery behavior, download semantics, or mobile viewing

## Validation Expectations

When you change viewer or file-type behavior, usually run:

```bash
cd frontend && npm test
cd frontend && npx tsc --noEmit
cd frontend && npm run lint
cd backend && pytest -v
cd website && npm run build
```

If the change is image-conversion-specific, include the relevant backend tests around image conversion and preview behavior.
