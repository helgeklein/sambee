# Backend Recovery Monitor Implementation Plan

## Problem Statement

The frontend currently treats backend availability as a passive status flag.
The status is updated by successful API responses, failed API requests, and the
server WebSocket lifecycle. That means suspend or network blips can leave the UI
showing backend errors until the user manually refreshes or another successful
request happens to clear the state.

## Goals

1. Make backend monitoring active and resilient instead of passive.
2. Recover automatically from suspend, tab restore, and transient network loss.
3. Recheck more frequently when recovery is likely, without tight-looping.
4. Keep the current UI usable during recovery.
5. Centralize recovery behavior so API traffic, websocket state, and banners do
   not drift apart.

## Non-Goals

1. Replacing the companion monitoring flow in the same change.
2. Reworking all browser error copy in the first pass.
3. Moving all websocket logic out of `FileBrowser` in one step.

## Current Behavior Summary

1. `frontend/src/services/backendAvailability.ts` stores `available`,
   `reconnecting`, and `unavailable`.
2. `frontend/src/services/api.ts` marks the backend unavailable on connectivity
   failures and available on successful responses.
3. `frontend/src/pages/FileBrowser.tsx` marks the backend reconnecting when the
   server WebSocket closes and retries on a fixed 5 second timer.
4. No dedicated recovery loop probes the backend after it becomes unavailable.

## Target Behavior

### State Handling

1. First connectivity loss should move the app into `reconnecting`.
2. Repeated failed recovery probes should escalate to `unavailable`.
3. Any successful health probe, websocket open, or normal API success should
   reset recovery state back to `available`.

### Recovery Triggers

The monitor should immediately retry recovery when any of these happen while the
backend is not available:

1. `window.focus`
2. `document.visibilitychange` back to visible
3. `window.online`
4. `window.pageshow`

### Recovery Actions

1. Probe the backend health endpoint immediately.
2. Force a websocket reconnect attempt immediately.
3. Continue background health probes with a short, adaptive delay.
4. Refresh the visible directory panes once the backend is confirmed healthy.

## Implementation Phases

### Phase 1: Active Recovery Loop

Files:

1. `frontend/src/hooks/useBackendRecoveryMonitor.ts`
2. `frontend/src/services/api.ts`
3. `frontend/src/services/backendRouter.ts`
4. `frontend/src/pages/FileBrowser.tsx`

Tasks:

1. Add a dedicated hook that watches backend availability state.
2. Use the existing `/api/health` endpoint for recovery probes.
3. Probe immediately when the backend enters `reconnecting` or `unavailable`.
4. Retry on a short cadence with modest backoff while recovery is in progress.
5. Stop probing immediately once recovery succeeds.

### Phase 2: Faster WebSocket Recovery

Files:

1. `frontend/src/pages/FileBrowser.tsx`

Tasks:

1. Replace the fixed 5 second websocket reconnect delay with a backoff ladder.
2. Reset websocket backoff after successful reconnect.
3. Allow resume and focus events to force an immediate reconnect attempt.
4. Avoid duplicate reconnect timers and stale sockets.

### Phase 3: API Status Semantics

Files:

1. `frontend/src/services/api.ts`
2. `frontend/src/services/backendAvailability.ts`

Tasks:

1. Treat the first network failure as `reconnecting`, not `unavailable`.
2. Preserve `unavailable` only after repeated recovery failures.
3. Keep local aborts and client-side timeouts excluded from backend-loss logic.

### Phase 4: UI Healing

Files:

1. `frontend/src/pages/FileBrowser.tsx`
2. `frontend/src/components/FileBrowser/FileBrowserAlerts.tsx`

Tasks:

1. Keep the browser UI mounted while recovery is running.
2. Refresh the current pane data automatically after backend recovery.
3. Keep banner messaging accurate to the current recovery state.

### Phase 5: Validation

Files:

1. `frontend/src/hooks/__tests__/useBackendRecoveryMonitor.test.ts`
2. `frontend/src/services/__tests__/backendAvailability.test.ts`
3. `frontend/src/pages/__tests__/FileBrowser-rendering.test.tsx`

Tasks:

1. Test repeated health probes and successful recovery.
2. Test event-driven wake and focus recovery.
3. Test escalation from reconnecting to unavailable after repeated failures.
4. Run frontend typecheck, lint, and focused tests.

## First Implementation Slice

The first slice should ship the highest-value behavior with limited surface
area:

1. Add the recovery hook.
2. Switch API connectivity failures to `reconnecting` before escalation.
3. Add adaptive health probes.
4. Add immediate retry on focus, visibility return, online, and pageshow.
5. Replace the fixed websocket retry delay with a faster backoff ladder.
6. Refresh visible panes automatically once the backend recovers.

## Risks And Mitigations

### Risk: Too Many Recovery Requests

Mitigation:

1. Only probe while backend status is not `available`.
2. Keep one probe in flight at a time.
3. Use bounded backoff after repeated failures.

### Risk: Duplicate WebSocket Reconnect Attempts

Mitigation:

1. Centralize reconnect timer management in `FileBrowser`.
2. Clear pending timers before scheduling a new reconnect.
3. Suppress duplicate reconnect scheduling during forced reconnects.

### Risk: Automatic Pane Refresh Feels Noisy

Mitigation:

1. Refresh only currently visible panes.
2. Refresh once on confirmed recovery.
3. Keep the existing manual retry action unchanged.

## Validation Checklist

1. Suspend and resume while FileBrowser is open.
2. Confirm the frontend returns without a manual page refresh.
3. Confirm repeated failures keep probing instead of giving up.
4. Confirm websocket reconnect happens faster than before.
5. Confirm no lint or typecheck regressions.
