# Image Viewer Migration Plan

## Goals
- Replace the current Swiper-based viewer with a production-ready solution that offers stable gestures on iOS/Android and feature parity on desktop.
- Retain existing UX features: gallery navigation, zoom/rotate controls, keyboard shortcuts, and server-assisted preloading of adjacent images.
- Provide a migration path that keeps the legacy viewer available behind a feature flag until the new solution is validated.

## Candidate Libraries

### PhotoSwipe 5
- **Strengths**: purpose-built touch gesture engine (pinch, drag, momentum), dialog/inline modes, event hooks (`beforeOpen`, `change`, `close`), plugin ecosystem (captions, deep zoom), dynamic imports to keep bundle small, well-maintained.
- **Keyboard integration**: expose PhotoSwipe instance via `Lightbox` controller, map our `useKeyboardShortcuts` handlers to `pswp.next()`, `pswp.prev()`, `pswp.zoomTo()`.
- **Custom UI**: use CSS variables + slot-like hooks to reinsert `ViewerControls` overlay; PhotoSwipe events allow sync with our toolbar state.
- **Concerns**: default layout is lightbox-centric; need inline plugin or custom container styling to keep existing layout.

### Yet Another React Lightbox (YARL)
- **Strengths**: React-first API with TypeScript types, controlled props for slides + state, optional `zoom` plugin enabling pinch and wheel zoom, plugin suite (thumbnails, video, fullscreen), customizable via `render` slots.
- **Keyboard integration**: `controllerRef` gives imperative API for `slideNext`, `zoomIn`, `close`; easy to hook into existing shortcut infrastructure.
- **Custom UI**: render prop system allows embedding our controls and per-slide overlays without hacking internals.
- **Concerns**: larger base bundle than PhotoSwipe; need to evaluate gesture smoothness with 10k+ image galleries.

### Other options (lower priority)
- `react-photoswipe-gallery`: thin React wrapper around PhotoSwipe core; useful if we need fully declarative slide definitions but adds minimal value beyond direct PhotoSwipe integration.
- `swiper-element` + vanilla JS rewrite: keeps Swiper but avoids React-specific issues; still inherits Swiper’s gesture bugs on iOS so not recommended.

## Evaluation Criteria
1. **Gesture completeness**: pinch-to-zoom, inertial swipe, drag-to-close, double-tap zoom.
2. **State/shortcut API**: ability to control slides programmatically and map to our keyboard system.
3. **Extensibility**: plugin support, custom render hooks for controls, ability to inject logging.
4. **Performance**: smoothness on large galleries (± preloading), memory footprint, bundle size.
5. **Theming**: CSS variables for dark theme, ability to reuse existing overlay styling.

## Proof-of-Concept Tasks
1. **Scaffold feature flag**: `IMAGE_VIEWER_YARL` via `VITE_IMAGE_VIEWER_YARL` (plus optional `localStorage` override stored under `sambee.featureFlags`) to switch between Swiper and the upcoming YARL component through `FileTypeRegistry`. The same plumbing can host a future `IMAGE_VIEWER_PHOTOSWIPE` toggle without refactoring.
2. **Shared data adapter**: Extract current blob-cache + preload logic into a hook (`useImageGalleryData`) consumed by both viewers.
3. **PhotoSwipe POC**:
   - Render PhotoSwipe Lightbox with our slide list.
   - Wire pinch/double-tap zoom, map toolbar buttons to PhotoSwipe API.
   - Hook keyboard shortcuts via PhotoSwipe instance.
   - Verify logging (`logger.infoMobile`) can subscribe to `pswp` events.
4. **YARL POC**:
   - Implement same adapter feeding YARL slides with `Zoom` plugin.
   - Connect `controllerRef` to keyboard shortcuts + toolbar.
   - Confirm pinch zoom on iOS Safari.
5. **QA checklist**: device matrix (Safari iOS, Chrome Android, Chrome/Edge desktop), offline cache revocation, blob memory cleanup, spinner delay behavior.

## Migration Strategy
1. **Phase 0 – groundwork**
   - Land feature flag + shared hooks without changing default viewer.
   - Add Cypress/Vitest smoke tests ensuring viewer mounts correctly.
2. **Phase 1 – dual-run**
   - Deploy PhotoSwipe (or YARL) behind flag for internal testing.
   - Collect mobile logs, compare stuck-swipe metrics vs Swiper.
   - Address integration gaps (e.g., rotation UI, keyboard shortcuts, download button).
3. **Phase 2 – public rollout**
   - Enable flag for small cohort, monitor error tracking + performance.
   - Update documentation (`MOBILE_IMAGE_LOADING_UX.md`, `VIEWER_SUPPORT.md`).
4. **Phase 3 – decommission Swiper**
   - Remove legacy viewer-specific hooks and mobile logging hacks once new solution is stable.
   - Simplify `FileTypeRegistry` to single viewer import.

## Next Steps
1. Approve candidate shortlist (PhotoSwipe vs YARL) and greenlight POC.
2. Assign owner for feature flag + data adapter extraction.
3. Schedule mobile QA sessions focused on pinch zoom + rapid swipe stability.
4. Document success criteria (no unexpected closes, no stuck animations, ≤1 fetch per slide) before rollout.
