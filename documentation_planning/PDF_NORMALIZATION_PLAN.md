# PDF Compatibility Normalization Plan

## Purpose

Replace unconditional Ghostscript rewriting with an evidence-driven PDF
compatibility fallback. The normal viewer path must serve the original file;
normalization is reserved for documents that demonstrably fail in PDF.js or for
a separately defined oversized-scan derivative policy.

## Problem Statement

The current viewer normalizes every PDF when Ghostscript is installed. This
buffers the source, rewrites it with `pdfwrite` and the `/printer` preset, then
buffers the result before responding.

This was introduced to repair PDFs that PDF.js rejects because of malformed
cross-reference tables, broken object references, unusual incremental updates,
or other non-standard structure. Extension-based selection cannot distinguish
those files from valid PDFs.

`notar.pdf` is the representative regression:

- Original: 2,794,409 bytes.
- Normalized: 6,707,226 bytes (+140%).
- Server-side Ghostscript work: about 2.1 seconds per open.
- Cause: 25 JPEG 2000 image streams are rewritten as high-quality JPEG streams.

## Goals

- Keep valid PDFs unmodified, streamable, and as small as their source permits.
- Retain a reliable recovery path for PDFs that fail in the browser.
- Retry at most once per open; never create a client retry loop.
- Reuse successful normalized output until its source file changes.
- Keep source downloads byte-identical and independent of viewer derivatives.
- Record enough diagnostics to classify new compatibility cases safely.

## Non-Goals

- Make Ghostscript a general PDF optimizer or archival converter.
- Fix arbitrary PDF.js rendering defects by rewriting every document.
- Use `/ebook` or another global quality preset without representative visual
  comparison.
- Silently replace originals for download, editing, audit, or sharing flows.

## Target Design

### Original-First Viewer Path

`GET /viewer/file` continues to authorize and inspect the file, but streams the
original PDF rather than reading it fully and calling Ghostscript. Preserve the
current inline content disposition and MIME type.

The frontend loads this original response first. It retains the current
transport timeout and retry UI; an HTTP, authentication, or SMB failure is not a
PDF compatibility failure and must not request normalization.

### Explicit Normalized Variant

Add an authenticated, idempotent viewer variant selected by a narrow query
parameter, for example `GET /viewer/file?pdf_variant=normalized`. The endpoint:

1. Repeats authorization and path validation.
2. Obtains the source revision from canonical path, size, and `modified_at`.
3. Returns a matching cached derivative when present.
4. Otherwise reads the source, normalizes it, validates the output, caches it,
   and returns it.

Derivatives are stored in an application-managed directory local to the Docker
container, outside user-accessible SMB paths, and are never used by the download
endpoint. The cache is namespaced per user and has a configurable 50 MB default
quota; a quota of `0` disables caching. Expose those settings in a new PDF
viewer administration category.

The cache key includes user identity, connection identity, canonical path,
source size, source modification time, Ghostscript version, and an explicit
normalizer configuration version. A changed source revision or normalizer
configuration is a cache miss.

Use cache entries' last-access time to apply LRU eviction when a user's quota is
exceeded, plus a configurable inactivity TTL to remove stale entries even when
the quota is not full. This is a best-effort local cache: it need not be shared
between containers, and it must recover cleanly from an empty cache after a
container replacement.

### Bounded Frontend Fallback

Introduce a document-source state with two variants: `original` and
`normalized`. Start with `original` for every open.

Automatically switch to `normalized` only once when the original document-load
failure is `InvalidPDFException`/`Invalid PDF structure`. Reset the `Document`
key and viewer page state before retrying so React-PDF creates a new loading
task.

For every other failure, retain the normal error state and provide a
user-triggered "Try compatibility mode" action. Do not persist per-document
failure signatures or promote additional error messages to automatic fallbacks.
This preserves an escape hatch for real but unclassified cases while avoiding
automatic rewrites for transport errors, password-protected documents,
image-decoder failures, or resource exhaustion.

After the normalized variant fails, stop. Display both failure contexts in
client diagnostics; do not alternate variants or schedule retries.

### Normalizer Safeguards

Keep the current Ghostscript safety flags, timeout, orientation preservation,
and original-bytes fallback if Ghostscript itself cannot produce output.

For compatibility rewriting, use a deliberate configuration rather than the
`/printer` preset as a blanket policy. First evaluate a configuration that
preserves JPEG and JPEG 2000 streams when Ghostscript can safely pass them
through. Any output-setting change requires visual regression samples and a new
cache configuration version.

Protect the fallback from pathological input:

- Retain a hard conversion timeout and log a distinct timeout outcome.
- Cap concurrent normalizations with a process-wide semaphore.
- Place a configurable maximum source size on automatic normalization.
- Let the manual action explain when a document exceeds that cap.
- Reject empty or non-PDF Ghostscript output and never cache it.

Do not reject a normalized result merely because it is larger: it may be needed
for compatibility. Record the size delta for operational review.

### Oversized Scan Policy

Structural repair and image downsampling solve different problems and must use
separate policies.

For a document that is classified as huge from actual image dimensions and page
geometry, compatibility mode first requests a separately named
`pdf_variant=screen` derivative. It must have explicit image-resolution,
pixel-count, and quality settings validated against representative scans.
Target quality is sufficient for the screen's native resolution with a measured
reserve for zooming in.

Do not classify a document as huge from PDF file size alone. Establish and test
the detector from image dimensions and page geometry before activating the
screen derivative automatically. For documents below that threshold,
compatibility mode uses the fidelity-preserving normalized variant. Keep the
structural compatibility fallback loss-minimizing; do not use it as generic
image optimization.

## Implementation Phases

### Phase 1: Baseline and Diagnostics

- Add structured events for original load failures, normalization requests,
  cache hits/misses, Ghostscript result, duration, and size delta.
- Capture error name/message, source revision metadata, normalizer configuration
  version, and a privacy-safe source identifier. Do not log document contents.
- Assemble fixtures: a normal PDF, `notar.pdf`, a manually identified PDF that
  reproduces the historical `Invalid PDF structure` error, a large scan,
  encrypted PDF, and a PDF with annotations and links.
- Record original versus normalized visual, semantic, byte-size, and elapsed
  time observations for every fixture.

### Phase 2: Backend Variant and Cache

- Extract original streaming and normalized-response creation into explicit
  functions with no extension-only normalization decision.
- Implement normalized-variant authorization, revision-aware per-user cache
  lookup, atomic cache writes, LRU eviction, inactivity-TTL cleanup, and the
  configurable per-user quota (default 50 MB; `0` disables the cache).
- Add a new PDF viewer administration settings category for the cache quota and
  inactivity TTL.
- Version the normalizer command as a constant and include it in cache metadata.
- Return headers that identify the served variant and prevent a proxy from
  confusing an original with its derivative.
- Keep the download endpoint explicitly on the original-file code path.

### Phase 3: Viewer Fallback

- Make original and normalized source selection explicit in `PDFViewer`.
- Classify only the documented structural load error for automatic fallback; add
  the manual compatibility action for everything else.
- Ensure a variant transition resets page count, page selection bounds, search
  highlights, loading timeout state, and object URLs.
- Emit client diagnostic data once for each stage and present a bounded terminal
  error after both variants fail.

### Phase 4: Oversized-Scan Decision

- Establish and test a concrete image-dimension/effective-DPI threshold for the
  huge-document detector.
- Prototype the screen derivative and compare visual quality, output size,
  Ghostscript duration, PDF.js decode time, and memory.
- Set its image-resolution and pixel-count limits for native screen quality plus
  a measured zoom reserve, then ship it with its own regression fixtures.

## Test Plan

### Backend

- Original viewer requests stream valid PDFs without invoking Ghostscript.
- A normalized-variant request invokes Ghostscript once and returns a PDF.
- Repeated requests for the same source revision return the cached derivative.
- Changed source size, `modified_at`, user identity, or normalizer configuration
  invalidates or bypasses the cache as appropriate.
- The 50 MB per-user quota uses LRU eviction, the inactivity TTL removes stale
  entries, and a zero quota performs no cache reads or writes.
- Ghostscript failure, timeout, empty output, and invalid output do not poison
  the cache and return a controlled normalized-variant error.
- Authorization is identical for original and normalized variants.
- Downloads always return the original source bytes.
- The concurrency limit prevents more than the configured conversions.

### Frontend

- A normal PDF makes exactly one original request.
- `InvalidPDFException` makes one normalized retry and then renders on success.
- A network or API failure never requests a normalized variant.
- An unclassified document failure exposes compatibility mode but does not retry
  automatically or persist an error signature.
- A normalized failure ends in a stable error state with no timer or request
  loop.
- Variant transitions clean up blob URLs and reset viewer state correctly.

### End-to-End and Visual Regression

- Confirm the historical malformed sample fails as original and succeeds as a
  normalized variant.
- Confirm `notar.pdf` opens from the original response and retains its original
  size on the wire.
- Confirm a huge-document fixture selects the screen derivative only when its
  image/page measurements cross the tested threshold.
- Compare pages, search text, page count, rotation, links, and annotations for
  fixtures where both variants render.
- Exercise the fallback in the supported browser matrix and on a constrained
  mobile viewport.

## Rollout and Acceptance Criteria

Release behind a server-side feature flag. During the observation period, retain
the manual compatibility action even if automatic fallback succeeds.

The implementation is accepted when:

- Normal PDFs no longer invoke Ghostscript on first open.
- Known malformed PDFs can still be opened through one fallback attempt.
- Normalized results are cached and invalidate after source changes.
- The per-user cache respects its configured quota and inactivity TTL; a zero
  quota disables caching.
- No path can loop between original and normalized variants.
- Downloads remain byte-identical to SMB source files.
- `notar.pdf` is served at approximately 2.79 MB without the approximately
  2.1-second normalization delay.
- The complete backend and frontend test suites pass.
