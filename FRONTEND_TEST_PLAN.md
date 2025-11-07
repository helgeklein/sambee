# Frontend Test Implementation Plan

## Stack & Setup

**Testing Stack:**
- Vitest (test runner)
- React Testing Library (component testing)
- MSW (API mocking)
- Playwright (E2E - optional)

**Installation:**
```bash
cd frontend
npm install -D vitest @vitest/ui @vitest/coverage-v8 \
  @testing-library/react @testing-library/jest-dom @testing-library/user-event \
  jsdom msw
```

**Coverage Goals:**
- Lines: 80%+
- Branches: 75%+
- Functions: 80%+

---

## Phase 1: Foundation (Week 1)

### Setup Tasks
- [ ] Install dependencies
- [ ] Create `vitest.config.ts`
- [ ] Create `src/test/setup.ts`
- [ ] Create `src/test/utils/test-utils.tsx` (render with providers)
- [ ] Create `src/test/mocks/handlers.ts` (MSW handlers)
- [ ] Create `src/test/mocks/server.ts` (MSW server)
- [ ] Update package.json scripts

### First Tests: Login Component
File: `src/pages/__tests__/Login.test.tsx`

- [ ] Test: renders login form
- [ ] Test: successful login stores token and redirects
- [ ] Test: failed login shows error message
- [ ] Test: submit button disabled while loading
- [ ] Test: form validation (empty fields)
- [ ] Test: Enter key submits form

**Target:** 5-6 tests, ~100% coverage of Login component

---

## Phase 2: Core Components (Week 2)

### API Service Tests
File: `src/services/__tests__/api.test.ts`

**Authentication:**
- [ ] login() sets access token
- [ ] login() throws on invalid credentials
- [ ] logout() clears token
- [ ] requests include auth header

**Connections:**
- [ ] getConnections() returns list
- [ ] createConnection() posts data
- [ ] updateConnection() updates data
- [ ] deleteConnection() removes connection

**Browse:**
- [ ] browseDirectory() returns file listing
- [ ] handles nested paths correctly

**Error Handling:**
- [ ] 401 redirects to login
- [ ] network errors handled

**Target:** 12-15 tests, ~90% coverage of API service

### Browser Component Tests
File: `src/pages/__tests__/Browser.test.tsx`

**Rendering:**
- [ ] displays connection selector
- [ ] shows breadcrumb navigation
- [ ] renders file/folder list
- [ ] displays loading state
- [ ] shows error state

**Interaction:**
- [ ] clicking folder navigates into it
- [ ] clicking file opens preview
- [ ] breadcrumb navigation works
- [ ] back button navigates up

**Edge Cases:**
- [ ] empty directory shows message
- [ ] handles API errors

**Target:** 10-12 tests, ~80% coverage of Browser

---

## Phase 3: Admin & Settings (Week 3)

### Admin Panel Tests
File: `src/pages/__tests__/AdminPanel.test.tsx`

- [ ] displays connection list
- [ ] opens add connection dialog
- [ ] opens edit connection dialog
- [ ] opens delete confirmation
- [ ] creates new connection
- [ ] updates existing connection
- [ ] deletes connection

**Target:** 7-8 tests

### Connection Dialog Tests
File: `src/components/Admin/__tests__/ConnectionDialog.test.tsx`

- [ ] renders form fields
- [ ] validates required fields
- [ ] submits form data
- [ ] shows error on API failure
- [ ] closes on cancel

**Target:** 5-6 tests

### Settings Dialog Tests
File: `src/components/Settings/__tests__/SettingsDialog.test.tsx`

- [ ] displays user info
- [ ] change password form works
- [ ] validates password fields
- [ ] logout works

**Target:** 4-5 tests

---

## Phase 4: Integration Tests (Week 3-4)

### Full Workflow Tests
File: `src/__tests__/integration/workflows.test.tsx`

- [ ] Complete login → browse → preview flow
- [ ] Admin: create connection → browse files
- [ ] Error recovery: failed request → retry

**Target:** 3-4 integration tests

---

## Phase 5: E2E Tests (Week 4 - Optional)

### Setup Playwright
```bash
npm install -D @playwright/test
npx playwright install
```

### Critical Path E2E
File: `e2e/critical-paths.spec.ts`

- [ ] User can login and browse files
- [ ] Admin can manage connections
- [ ] File preview works

**Target:** 3-4 E2E tests

---

## MSW Mock Handlers Structure

File: `src/test/mocks/handlers.ts`

```typescript
export const handlers = [
  // Auth
  http.post('/api/auth/token', ...),
  http.get('/api/auth/me', ...),
  http.post('/api/auth/change-password', ...),
  
  // Admin
  http.get('/api/admin/connections', ...),
  http.post('/api/admin/connections', ...),
  http.put('/api/admin/connections/:id', ...),
  http.delete('/api/admin/connections/:id', ...),
  
  // Browse
  http.get('/api/browse/:connectionId/list', ...),
  
  // Preview
  http.get('/api/preview/:connectionId/start', ...),
  http.get('/api/preview/:connectionId/stream/:streamId', ...),
];
```

---

## Test Utilities

### Custom Render (src/test/utils/test-utils.tsx)
```typescript
function AllProviders({ children }) {
  return (
    <ThemeProvider theme={theme}>
      <BrowserRouter>{children}</BrowserRouter>
    </ThemeProvider>
  );
}

export function render(ui, options) {
  return rtlRender(ui, { wrapper: AllProviders, ...options });
}
```

### Common Test Patterns

**User Interaction:**
```typescript
const user = userEvent.setup();
await user.type(screen.getByLabelText(/username/i), 'admin');
await user.click(screen.getByRole('button', { name: /login/i }));
```

**Async Assertions:**
```typescript
expect(await screen.findByText(/error/i)).toBeInTheDocument();
await waitFor(() => expect(mockFn).toHaveBeenCalled());
```

**Query Priority:**
1. `getByRole()` - most accessible
2. `getByLabelText()` - for form fields
3. `getByText()` - for static content
4. `getByTestId()` - last resort

---

## Coverage Tracking

### After Each Phase

**Phase 1:** ~20% coverage (Login + API basics)
**Phase 2:** ~60% coverage (Browser + API complete)
**Phase 3:** ~80% coverage (Admin + Settings)
**Phase 4:** ~85% coverage (Integration tests)

### Run Coverage
```bash
npm run test:coverage
```

### CI Integration
Add to `.github/workflows/test.yml`:
```yaml
- name: Test Frontend
  working-directory: frontend
  run: npm run test:run

- name: Coverage
  working-directory: frontend
  run: npm run test:coverage
```

---

## Testing Best Practices

### DO ✅
- Test user behavior (what users see/do)
- Use semantic queries (getByRole, getByLabelText)
- Wait for async updates (findBy, waitFor)
- Mock external dependencies (API, localStorage)
- Keep tests simple and focused
- Use descriptive test names

### DON'T ❌
- Test implementation details (state, props)
- Use container.querySelector() 
- Test third-party libraries
- Make tests depend on each other
- Skip accessibility considerations

---

## Test File Naming

```
src/
  pages/
    Login.tsx
    __tests__/
      Login.test.tsx
  components/
    Admin/
      ConnectionDialog.tsx
      __tests__/
        ConnectionDialog.test.tsx
  services/
    api.ts
    __tests__/
      api.test.ts
```

---

## Progress Checklist

### Week 1
- [ ] Setup complete
- [ ] Login tests (6 tests)
- [ ] API service tests started (5+ tests)

### Week 2
- [ ] API service tests complete (15 tests)
- [ ] Browser tests (12 tests)
- [ ] 60% coverage achieved

### Week 3
- [ ] Admin panel tests (8 tests)
- [ ] Settings tests (5 tests)
- [ ] Component tests (10 tests)
- [ ] 80% coverage achieved

### Week 4
- [ ] Integration tests (4 tests)
- [ ] E2E tests (optional, 3 tests)
- [ ] CI/CD integration
- [ ] 85% coverage achieved

---

## Estimated Effort

- **Setup:** 4-6 hours
- **Phase 1:** 6-8 hours
- **Phase 2:** 12-16 hours
- **Phase 3:** 12-16 hours
- **Phase 4:** 4-6 hours
- **Total:** ~40-50 hours (1-2 weeks full-time)

---

## Resources

- [Vitest Docs](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [MSW Docs](https://mswjs.io/)
- [Common Testing Mistakes](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

---

## Success Metrics

- ✅ 80%+ code coverage
- ✅ All critical paths tested
- ✅ Tests run in < 10 seconds
- ✅ Zero flaky tests
- ✅ CI/CD integrated
- ✅ Team can write tests independently
