# Test Performance Optimization - Phase 3 Plan

**Date:** November 9, 2025  
**Current Performance:** ~27-30 seconds (13 test files, 144 tests)  
**Target Performance:** 15-20 seconds (30-40% improvement)  

---

## Current Bottlenecks Analysis

**Performance Breakdown (Phase 2 complete):**
- **Total:** 27.93s
- **Collection:** 39.38s (largest bottleneck - 41% of total time)
- **Tests:** 30.72s (actual test execution)
- **Environment:** 6.29s (jsdom setup)
- **Setup:** 2.86s (beforeEach/afterEach)
- **Transform:** 788ms (TypeScript compilation)

**Key Issues Identified:**
1. ✅ WebSocket mock causing 5s reconnect delays in tests
2. ✅ Collection time still high (39s) despite optimizations
3. ✅ Slow individual tests (ConnectionDialog, SettingsDialog)
4. Environment overhead for non-component tests

---

## Phase 3A: Quick Wins (1 hour) 🔥 HIGH PRIORITY

**Expected Gain:** 5-8 seconds + better dev experience  
**Effort:** Low  
**Risk:** Low  

### Task 1: Fix WebSocket Mock ⚡ (Priority #1)
**Problem:** Tests show WebSocket connection attempts with 5s reconnect delays:
```
Connecting to WebSocket: ws://undefined/api/ws
WebSocket connected
WebSocket disconnected, reconnecting in 5s...
```

**Solution:** Mock the `useWebSocket` hook properly to prevent connection attempts

**Implementation:**
```typescript
// src/test/helpers/websocketMock.ts
export function createWebSocketMock() {
  return {
    useWebSocket: vi.fn(() => ({
      connected: false,
      lastMessage: null,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    })),
  };
}

// In test files or setup
vi.mock('../../hooks/useWebSocket', () => createWebSocketMock());
```

**Expected Gain:** 2-3 seconds (eliminates reconnect delays)

---

### Task 2: Add `--changed` Script for Dev Workflow 💡

**Problem:** Running all 144 tests on every change is slow  
**Solution:** Add incremental test script using Vitest's built-in caching

**Implementation:**
```json
// package.json
{
  "scripts": {
    "test:changed": "vitest run --changed",
    "test:watch": "vitest --changed"
  }
}
```

**Expected Gain:** 
- Full runs: No change
- Incremental runs: 60-80% faster (only changed files + dependencies)
- **Huge developer experience improvement**

---

### Task 3: Optimize 3 Slowest Tests 🎯

**Target Tests:**
1. `ConnectionDialog "creates new connection"` - 1,595ms
2. `ConnectionDialog "shows error on save failure"` - 1,223ms
3. `SettingsDialog "opens add connection dialog"` - 876ms

**Optimizations:**
- Replace `userEvent.type()` with direct value setting where appropriate
- Reduce `waitFor` timeouts from 10000ms to 3000ms
- Use `findBy` queries instead of `waitFor(() => getBy...)`
- Mock heavy child components

**Implementation Example:**
```typescript
// BEFORE (slow)
await userEvent.type(nameInput, "Test Connection");
await waitFor(() => {
  expect(screen.getByText("Save")).toBeEnabled();
}, { timeout: 10000 });

// AFTER (fast)
await userEvent.type(nameInput, "Test Connection");
expect(await screen.findByRole("button", { name: /save/i })).toBeEnabled();
```

**Expected Gain:** 3-5 seconds across these 3 tests

---

## Phase 3B: Structural Optimizations (2-3 hours) ⚡ MEDIUM PRIORITY

**Expected Gain:** 10-15 seconds  
**Effort:** Medium  
**Risk:** Medium  

### Task 1: Split Tests by Environment

**Problem:** All tests use `jsdom` environment, even simple unit tests  
**Solution:** Use `node` environment for non-component tests

**Implementation:**
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    // Override environment per test file
    environmentMatchGlobs: [
      ['src/services/**/*.test.ts', 'node'],
      ['src/utils/**/*.test.ts', 'node'],
      ['src/**/*.test.tsx', 'jsdom'], // Components need jsdom
    ],
  }
});
```

**Files to migrate to `node` environment:**
- `src/services/__tests__/api.test.ts`
- Any utility/helper tests

**Expected Gain:** 3-5 seconds (faster environment setup for unit tests)

---

### Task 2: Reduce Collection Time via `__mocks__` Directory

**Problem:** Collection time is 39s - mocks defined inline cause extra parsing  
**Solution:** Move common mocks to `__mocks__` directory

**Implementation:**
```typescript
// src/__mocks__/react-window.tsx
export const List = ({ children, itemCount }) => (
  <div data-testid="virtual-list">
    {Array.from({ length: itemCount }).map((_, i) => children({ index: i }))}
  </div>
);

// In test files - Vitest auto-discovers __mocks__
vi.mock('react-window'); // Automatically uses __mocks__/react-window.tsx
```

**Expected Gain:** 5-8 seconds (faster collection, less inline parsing)

---

### Task 3: Implement Light vs Full Mock Variants

**Problem:** Simple render tests load full component mocks unnecessarily  
**Solution:** Create minimal mocks for basic tests

**Implementation:**
```typescript
// src/test/helpers/lazyMocks.ts

export function createLightMocks() {
  return {
    MarkdownPreview: () => null,
    SettingsDialog: () => null,
    List: ({ children }) => children,
  };
}

export function createFullMocks() {
  // Current detailed mocks
}

// In simple tests
vi.mock('../../components/Preview/MarkdownPreview', () => 
  createLightMocks().MarkdownPreview
);
```

**Expected Gain:** 2-4 seconds on simple render tests

---

## Phase 3C: Advanced Optimizations (optional) 💡 NICE TO HAVE

**Expected Gain:** Variable (mostly CI/CD benefits)  
**Effort:** Low-Medium  
**Risk:** Low  

### Task 1: Test Sharding for CI/CD

**Implementation:**
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    shard: process.env.CI 
      ? { index: Number(process.env.VITEST_SHARD_INDEX || 1), count: 3 }
      : undefined,
  }
});

// .github/workflows/test.yml
jobs:
  test:
    strategy:
      matrix:
        shard: [1, 2, 3]
    steps:
      - run: VITEST_SHARD_INDEX=${{ matrix.shard }} npm run test:run
```

**Expected Gain:** 
- Local: No change
- CI: 40-50% faster (parallel shards)

---

### Task 2: Benchmark Suite for Performance Monitoring

**Implementation:**
```typescript
// src/__tests__/performance/directory-rendering.bench.ts
import { bench } from 'vitest';

bench('large directory (1000 items)', async () => {
  const largeDir = createLargeDirectoryListing(1000);
  renderBrowser();
  await screen.findByTestId('virtual-list');
}, { time: 100 });
```

**Expected Gain:** 
- Removes performance tests from regular suite: 1-2s
- Better performance tracking over time

---

### Task 3: Advanced Caching Strategies

**Implementation:**
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    cache: {
      dir: 'node_modules/.vitest',
    },
    // Only rerun tests when dependencies change
    deps: {
      inline: ['react-window'],
    },
  }
});
```

**Expected Gain:** 
- First run: No change
- Subsequent runs: 20-30% faster

---

## Implementation Priority

### ✅ Do Now (Phase 3A - 1 hour)
1. Fix WebSocket mock (2-3s gain)
2. Add `--changed` script (massive dev experience win)
3. Optimize 3 slowest tests (3-5s gain)

**Expected Total: 5-8 seconds + much better dev workflow**

### ⚡ Do Next (Phase 3B - 2-3 hours)
1. Split test environments (3-5s gain)
2. Move mocks to `__mocks__` (5-8s gain)
3. Light mock variants (2-4s gain)

**Expected Total: 10-15 seconds**

### 💡 Do Later (Phase 3C - optional)
1. CI/CD sharding (CI only benefit)
2. Benchmark suite (monitoring)
3. Advanced caching (incremental benefit)

---

## Success Criteria

### Phase 3A Success
- [x] WebSocket mock fixed, no more connection attempts in logs
- [x] `test:changed` script added and working
- [x] ConnectionDialog tests < 1000ms each
- [x] SettingsDialog tests < 600ms each
- [x] Total test time: 22-25 seconds
- [x] All tests still passing
- [x] No new flaky tests

### Phase 3B Success
- [ ] Unit tests using `node` environment
- [ ] Common mocks in `__mocks__` directory
- [ ] Light mocks for simple tests
- [ ] Total test time: 15-20 seconds
- [ ] Collection time < 25 seconds
- [ ] All tests still passing

### Phase 3C Success
- [ ] CI/CD sharding working
- [ ] Benchmark suite in place
- [ ] Advanced caching configured
- [ ] Total test time: 12-18 seconds

---

## Rollback Plan

Each phase is independent:
- Phase 3A: Revert individual test optimizations if issues arise
- Phase 3B: Easy to revert environment splits or mock locations
- Phase 3C: Optional enhancements, can skip if problematic

---

## Final Target

**After all phases:**
- **Target:** 15-20 seconds (30-40% improvement from current 27-30s)
- **Stretch Goal:** 12-15 seconds (50% improvement)
- **Realistic:** 18-22 seconds (25-35% improvement)

**Priority:** Maintain test reliability and readability over raw speed
