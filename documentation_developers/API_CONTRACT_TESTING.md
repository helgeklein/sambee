# Frontend/Backend API Contract Testing

## Overview

This document describes how we ensure the frontend and backend APIs remain compatible and synchronized.

## Current Implementation

### Contract Tests (`frontend/src/services/__tests__/loggingConfig.test.ts`)

We use **schema validation tests** that:
1. Define the exact expected backend response format
2. Verify all required fields are present
3. Check field types match expectations
4. Test behavior with all valid values
5. Verify error handling for edge cases

**Example:**
```typescript
it("should handle backend API response format correctly", async () => {
  // This is the EXACT format the backend returns
  const backendResponse: LoggingConfig = {
    enabled: true,
    log_level: "WARNING",
    components: ["ImageViewer", "Swiper"],
  };

  // Verify all required fields are present
  expect(config).toHaveProperty("enabled");
  expect(config).toHaveProperty("log_level");
  expect(config).toHaveProperty("components");

  // Verify types
  expect(typeof config.enabled).toBe("boolean");
  expect(typeof config.log_level).toBe("string");
  expect(Array.isArray(config.components)).toBe(true);
});
```

## Best Practices for API Contract Testing

### 1. **Schema Validation Tests** ✅ (Current Implementation)
**What:** Test that frontend types match backend API responses
**When:** Every API endpoint should have contract tests
**Pros:**
- Simple to implement
- Fast to run
- No additional tools needed
- Tests live with the code

**Cons:**
- Manual synchronization required
- Doesn't catch breaking changes until tests run

**Example:**
```typescript
// Test every field of the API response
const response = await apiService.getLoggingConfig();
expect(response).toHaveProperty("log_level");
expect(typeof response.log_level).toBe("string");
```

### 2. **OpenAPI/Swagger Code Generation** (Recommended for Growth)
**What:** Generate TypeScript types from FastAPI's OpenAPI schema
**When:** When you have many endpoints or frequent API changes
**Tools:**
- `openapi-typescript`
- `@openapitools/openapi-generator-cli`

**Pros:**
- Automatic synchronization
- Compile-time type safety
- No manual type definitions needed
- Backend is source of truth

**Cons:**
- Build step complexity
- Generated code may need customization

**Implementation:**
```bash
# 1. Export OpenAPI schema from your local backend
curl --fail --silent http://localhost:8000/openapi.json --output openapi.json

# 2. Generate TypeScript types with the checked-in dependency only
npx --no-install openapi-typescript openapi.json -o src/types/api.ts

# 3. Review the generated diff before commit
```

### 3. **Consumer-Driven Contract Testing** (Pact)
**What:** Frontend defines contracts, backend must satisfy them
**When:** Microservices or multiple teams
**Tools:** Pact, Spring Cloud Contract

**Pros:**
- True contract testing
- Tests API behavior, not just types
- Can test against mock server

**Cons:**
- Complex setup
- Requires additional infrastructure
- Steeper learning curve

### 4. **E2E Integration Tests**
**What:** Tests that exercise both frontend and backend together
**When:** Critical user flows
**Tools:** Playwright, Cypress

**Pros:**
- Tests real integration
- Catches runtime issues
- Tests full stack

**Cons:**
- Slow to run
- Flaky
- Requires full environment

### 5. **Shared Type Repository**
**What:** Single source of truth for types in monorepo
**When:** Monorepo with shared package
**Structure:**
```
packages/
  types/          # Shared types
  frontend/       # Imports from types/
  backend/        # Generates/exports to types/
```

**Pros:**
- Guaranteed synchronization
- Compile-time safety
- Single source of truth

**Cons:**
- Requires monorepo setup
- Backend must export types

## Recommendations

### Current State (Good for Now)
✅ **Schema validation tests** for logging API
- Fast, simple, effective
- Catches mismatches in tests
- No additional dependencies

### For Scaling Up
When you add more endpoints or have frequent API changes:

1. **Add OpenAPI type generation**
   Add `openapi-typescript` to `devDependencies` and commit the `package-lock.json` change in the same PR.
   Add to package.json:
   ```json
   {
     "scripts": {
       "generate-api-types": "npx --no-install openapi-typescript ./openapi.json --output src/types/api.ts"
     }
   }
   ```
   Export `openapi.json` from the local backend first, then review the generated type diff before commit.

2. **Add contract tests for all endpoints**
   - Create test for each API endpoint
   - Verify response structure
   - Test all valid values
   - Test error cases

3. **Consider CI/CD checks**
   - Run contract tests on every PR
   - Generate API types and check for changes
   - Alert on breaking changes

### Testing Checklist

For each new API endpoint:
- [ ] Backend validation (Pydantic models)
- [ ] Backend tests (pytest)
- [ ] Frontend types (TypeScript interfaces)
- [ ] Contract tests (response structure)
- [ ] Behavior tests (level hierarchy, filtering)
- [ ] Error handling tests
- [ ] Integration test (optional, for critical paths)

## Examples in Codebase

### Backend Tests
```python
# backend/tests/test_logging_config.py
def test_get_logging_config_default(client, auth_headers_admin):
    response = client.get("/api/logs/config", headers=auth_headers_admin)
    assert response.status_code == 200

    data = response.json()
    assert "enabled" in data
    assert "log_level" in data
    assert "components" in data
    assert isinstance(data["log_level"], str)
```

### Frontend Contract Tests
```typescript
// frontend/src/services/__tests__/loggingConfig.test.ts
it("should handle backend API response format correctly", async () => {
  const backendResponse: LoggingConfig = {
    enabled: true,
    log_level: "WARNING",
    components: ["ImageViewer"],
  };

  vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

  const config = await loggingConfig.getConfig();
  expect(config).toHaveProperty("log_level");
  expect(typeof config.log_level).toBe("string");
});
```

### Frontend Behavior Tests
```typescript
it("should correctly implement log level threshold (WARNING)", async () => {
  const backendResponse: LoggingConfig = {
    enabled: true,
    log_level: "WARNING",
    components: [],
  };

  vi.mocked(apiService.getLoggingConfig).mockResolvedValue(backendResponse);

  // WARNING enables WARNING, ERROR (not DEBUG, INFO)
  expect(await loggingConfig.isLevelEnabled("DEBUG")).toBe(false);
  expect(await loggingConfig.isLevelEnabled("INFO")).toBe(false);
  expect(await loggingConfig.isLevelEnabled("WARNING")).toBe(true);
  expect(await loggingConfig.isLevelEnabled("ERROR")).toBe(true);
});
```

## Detecting Breaking Changes

### Compile-Time (TypeScript)
```typescript
// If backend changes log_level → level, TypeScript catches it:
const config = await apiService.getLoggingConfig();
console.log(config.log_level);  // TS Error if field renamed
```

### Test-Time (Contract Tests)
```typescript
// If backend adds required field, test fails:
expect(config).toHaveProperty("log_level");  // Fails if removed
```

### Runtime (Defensive Programming)
```typescript
// Always validate API responses:
if (!config || typeof config.log_level !== 'string') {
  throw new Error('Invalid config response');
}
```

## Summary

**Current approach:** Schema validation tests ✅
- Simple, fast, effective
- No additional tools required
- Tests live with the code

**Future improvements:**
- OpenAPI type generation (when scaling)
- More contract tests (new endpoints)
- E2E tests (critical flows)

**Key principle:** Test the contract, not the implementation!
