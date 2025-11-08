# Browser Component Test Fix Plan

## Problem Analysis

### Current Status
- **24 tests created** for the Browser component
- **3 tests passing**: Simple rendering tests
- **21 tests failing**: All due to WebSocket-related errors

### Root Cause
The Browser component has complex real-time features that are difficult to mock in tests:

1. **WebSocket Connection** (lines 450-510 in Browser.tsx):
   - Automatically connects on component mount
   - Sends subscription messages when directory/connection changes
   - Issue: `wsRef.current.send()` is called but `wsRef.current` is `null`
   - The mock WebSocket doesn't properly simulate the connection lifecycle

2. **WebSocket Readiness Check** (line 524):
   ```typescript
   if (wsRef.current?.readyState === WebSocket.OPEN && selectedConnectionId) {
     wsRef.current.send(...)  // ← Fails here, wsRef.current is null
   }
   ```
   - Optional chaining prevents initial error, but subsequent code assumes `wsRef.current` exists
   - The mock doesn't set `readyState` to `WebSocket.OPEN`

3. **ResizeObserver** (line 561):
   - Used for dynamic virtual list height calculation
   - Currently mocked but working

## Fix Strategy

### Option 1: Enhanced WebSocket Mock (RECOMMENDED)
**Effort**: Medium | **Reliability**: High | **Maintainability**: High

Improve the WebSocket mock to properly simulate the connection lifecycle.

#### Steps:
1. **Update MockWebSocket class** in `/workspace/frontend/src/test/setup.ts`:
   ```typescript
   class MockWebSocket {
     static CONNECTING = 0;
     static OPEN = 1;
     static CLOSING = 2;
     static CLOSED = 3;

     url: string;
     readyState: number = MockWebSocket.CONNECTING;
     onopen: ((event: Event) => void) | null = null;
     onclose: ((event: CloseEvent) => void) | null = null;
     onerror: ((event: Event) => void) | null = null;
     onmessage: ((event: MessageEvent) => void) | null = null;

     constructor(url: string) {
       this.url = url;
       // Simulate connection opening asynchronously
       setTimeout(() => {
         this.readyState = MockWebSocket.OPEN;
         if (this.onopen) {
           this.onopen(new Event('open'));
         }
       }, 0);
     }

     close() {
       this.readyState = MockWebSocket.CLOSED;
       if (this.onclose) {
         this.onclose(new CloseEvent('close'));
       }
     }

     send(data: string) {
       // No-op in tests, but doesn't throw
     }

     addEventListener() {}
     removeEventListener() {}
   }
   ```

2. **Add WebSocket constants** to global:
   ```typescript
   global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
   // Ensure WebSocket constants are available
   Object.defineProperty(global.WebSocket, 'CONNECTING', { value: 0 });
   Object.defineProperty(global.WebSocket, 'OPEN', { value: 1 });
   Object.defineProperty(global.WebSocket, 'CLOSING', { value: 2 });
   Object.defineProperty(global.WebSocket, 'CLOSED', { value: 3 });
   ```

3. **Wait for WebSocket connection in tests**:
   - Use `waitFor()` before interacting with the component
   - Example:
     ```typescript
     await waitFor(() => {
       expect(screen.getByText("Documents")).toBeInTheDocument();
     });
     ```

#### Benefits:
- ✅ Realistic WebSocket behavior simulation
- ✅ Tests verify component works with WebSocket lifecycle
- ✅ No changes needed to component code
- ✅ Reusable for other components using WebSocket

#### Implementation Time: ~30 minutes

---

### Option 2: Mock at Module Level
**Effort**: Low | **Reliability**: Medium | **Maintainability**: Medium

Mock the entire WebSocket connection logic by intercepting the useEffect that creates it.

#### Steps:
1. **Add mock in Browser.test.tsx beforeEach**:
   ```typescript
   beforeEach(() => {
     vi.clearAllMocks();
     localStorage.setItem("access_token", "fake-token");

     // Mock WebSocket globally with proper readyState
     const mockWs = {
       readyState: 1, // OPEN
       send: vi.fn(),
       close: vi.fn(),
       addEventListener: vi.fn(),
       removeEventListener: vi.fn(),
     };
     
     global.WebSocket = vi.fn().mockImplementation(() => mockWs);
     
     // Default successful mocks
     vi.mocked(api.getConnections).mockResolvedValue(mockConnections);
     vi.mocked(api.listDirectory).mockResolvedValue(mockDirectoryListing);
   });
   ```

2. **No component changes needed**

#### Benefits:
- ✅ Quick to implement
- ✅ Tests focus on UI behavior, not WebSocket details

#### Drawbacks:
- ❌ Doesn't verify WebSocket lifecycle integration
- ❌ Mock setup repeated in test file

#### Implementation Time: ~15 minutes

---

### Option 3: Component Refactoring
**Effort**: High | **Reliability**: High | **Maintainability**: Very High

Refactor Browser component to separate WebSocket logic into a custom hook.

#### Steps:
1. **Create `useWebSocketConnection` hook**:
   ```typescript
   // src/hooks/useWebSocketConnection.ts
   export function useWebSocketConnection(
     connectionId: string,
     path: string,
     onMessage: (data: any) => void
   ) {
     const wsRef = useRef<WebSocket | null>(null);
     
     useEffect(() => {
       // WebSocket connection logic here
     }, [connectionId, path]);
     
     return { wsRef };
   }
   ```

2. **Mock the hook in tests**:
   ```typescript
   vi.mock("../hooks/useWebSocketConnection", () => ({
     useWebSocketConnection: () => ({
       wsRef: { current: null }
     })
   }));
   ```

3. **Update Browser component** to use the hook

#### Benefits:
- ✅ Clean separation of concerns
- ✅ Easy to test in isolation
- ✅ Reusable across components
- ✅ Better code organization

#### Drawbacks:
- ❌ Requires component refactoring
- ❌ More time-consuming
- ❌ Potential for introducing bugs

#### Implementation Time: ~2-3 hours

---

## Recommended Approach

**Implement Option 1** (Enhanced WebSocket Mock) because:

1. **Minimal changes required** - Only update test setup
2. **Tests real behavior** - Verifies WebSocket integration works
3. **Reusable** - Benefits all future components using WebSocket
4. **Quick win** - Can fix all 21 failing tests in ~30 minutes
5. **No component changes** - Zero risk of breaking production code

## Implementation Checklist

### Phase 1: Fix WebSocket Mock (30 min)
- [ ] Update `MockWebSocket` class in `setup.ts`
  - [ ] Add `readyState` property starting at `CONNECTING`
  - [ ] Simulate async connection opening with `setTimeout`
  - [ ] Set `readyState` to `OPEN` when connection opens
  - [ ] Add `send()` method that doesn't throw
  - [ ] Add `close()` method that updates state
- [ ] Add WebSocket constants (`CONNECTING`, `OPEN`, `CLOSING`, `CLOSED`) to global
- [ ] Test the mock in isolation

### Phase 2: Update Tests (15 min)
- [ ] Ensure all tests use `waitFor()` for async operations
- [ ] Add explicit waits for elements that depend on API calls
- [ ] Verify timeout values are sufficient (default 1000ms may be too short)

### Phase 3: Run and Debug (30 min)
- [ ] Run tests: `npm test -- src/pages/__tests__/Browser.test.tsx --run`
- [ ] Debug any remaining failures
- [ ] Check for timing issues in interaction tests
- [ ] Verify all 24 tests pass

### Phase 4: Coverage Check (15 min)
- [ ] Run coverage: `npm run test:coverage -- src/pages/__tests__/Browser.test.tsx --run`
- [ ] Verify Browser component coverage meets targets (80% lines, 75% branches)
- [ ] Document any uncovered edge cases

## Expected Outcomes

After implementing Option 1:
- **24/24 tests passing** ✅
- **Coverage**: ~75-85% (some WebSocket edge cases may remain uncovered)
- **Test reliability**: High (tests will be stable and repeatable)
- **Maintenance**: Low (WebSocket mock is reusable)

## Alternative: Skip WebSocket Tests (NOT RECOMMENDED)

If time is very limited, we could:
1. Mark WebSocket-dependent tests as `it.skip()` or `it.todo()`
2. Focus on testing core UI rendering without WebSocket
3. Add WebSocket tests later

**Cons**:
- ❌ Incomplete test coverage
- ❌ Missing integration testing
- ❌ Technical debt accumulation

## Files to Modify

1. **`/workspace/frontend/src/test/setup.ts`** (PRIMARY)
   - Lines 47-67: Replace MockWebSocket class
   - Line 67: Add WebSocket constants

2. **`/workspace/frontend/src/pages/__tests__/Browser.test.tsx`** (OPTIONAL)
   - May need to adjust `waitFor()` timeouts if tests are still flaky
   - May need to add explicit waits for WebSocket connection

## Testing Strategy

After fixes:
1. Run individual test: `npm test -- Browser.test.tsx --run`
2. Run all tests: `npm test -- --run`
3. Check coverage: `npm run test:coverage -- Browser.test.tsx --run`
4. Verify no regression in other test suites

## Success Criteria

- ✅ All 24 Browser tests pass consistently
- ✅ No "Cannot read properties of null" errors
- ✅ Tests complete in < 30 seconds
- ✅ Coverage meets or exceeds 75% for Browser component
- ✅ No new warnings or errors in test output
- ✅ Other test suites remain unaffected (Login, API Service, Admin Panel, etc.)

## Risk Assessment

**Low Risk**: Option 1 only modifies test infrastructure, not production code

**Potential Issues**:
- Timing-related flakiness in CI environments
- Need to adjust timeouts for slower systems
- WebSocket mock may need refinement for edge cases

**Mitigation**:
- Use generous `waitFor()` timeouts (2-3 seconds)
- Add retry logic for flaky tests
- Document any known timing sensitivities

---

## Next Steps

1. Review this plan with team
2. Approve Option 1 as the implementation strategy
3. Execute Phase 1-4 checklist
4. Document results and any issues encountered
5. Update FRONTEND_TEST_PLAN.md with completion status
