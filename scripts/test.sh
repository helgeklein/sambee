#!/bin/bash
set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Get the repository root (parent of scripts directory)
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  Sambee - Test & Analysis Suite${NC}"
echo -e "${BLUE}======================================${NC}\n"

# Track overall status
OVERALL_STATUS=0

# ============================================
# BACKEND TESTS
# ============================================
echo -e "${YELLOW}=== Backend: Static Analysis ===${NC}"
cd "$REPO_ROOT/backend" || exit 1

# mypy - Type checking (non-fatal, just warnings)
echo -e "${BLUE}Running mypy (type checking)...${NC}"
if mypy app; then
    echo -e "${GREEN}✓ mypy passed${NC}\n"
else
    echo -e "${YELLOW}⚠ mypy found issues (non-fatal)${NC}\n"
    # Don't fail on mypy errors as they're just type hints
fi

# Backend: Unit Tests
echo -e "${YELLOW}=== Backend: Unit Tests ===${NC}"
echo -e "${BLUE}Running pytest...${NC}"
# Use coverage only if COVERAGE env var is set
if [ "${COVERAGE:-0}" = "1" ]; then
    PYTEST_CMD="pytest -v --cov=app --cov-report=term-missing --cov-report=xml"
else
    PYTEST_CMD="pytest -v"
fi

if $PYTEST_CMD; then
    echo -e "${GREEN}✓ Backend tests passed${NC}\n"
else
    echo -e "${RED}✗ Backend tests failed${NC}\n"
    OVERALL_STATUS=1
fi

# ============================================
# FRONTEND TESTS
# ============================================
echo -e "${YELLOW}=== Frontend: Static Analysis ===${NC}"
cd "$REPO_ROOT/frontend" || exit 1

# TypeScript - Type checking
echo -e "${BLUE}Running TypeScript compiler (type checking)...${NC}"
if npx tsc --noEmit; then
    echo -e "${GREEN}✓ TypeScript type check passed${NC}\n"
else
    echo -e "${RED}✗ TypeScript type check failed${NC}\n"
    OVERALL_STATUS=1
fi

# Frontend: Build Test
echo -e "${YELLOW}=== Frontend: Build Test ===${NC}"
echo -e "${BLUE}Running production build...${NC}"
if npm run build; then
    echo -e "${GREEN}✓ Frontend build passed${NC}\n"
else
    echo -e "${RED}✗ Frontend build failed${NC}\n"
    OVERALL_STATUS=1
fi

# Frontend: Unit Tests (if they exist)
if grep -q '"test"' package.json; then
    echo -e "${YELLOW}=== Frontend: Unit Tests ===${NC}"
    echo -e "${BLUE}Running frontend tests...${NC}"
    if npm test -- --run; then
        echo -e "${GREEN}✓ Frontend tests passed${NC}\n"
    else
        echo -e "${RED}✗ Frontend tests failed${NC}\n"
        OVERALL_STATUS=1
    fi
fi

# ============================================
# SUMMARY
# ============================================
echo -e "${BLUE}======================================${NC}"
if [ $OVERALL_STATUS -eq 0 ]; then
    echo -e "${GREEN}✓ All tests and checks passed!${NC}"
    echo -e "${BLUE}======================================${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests or checks failed!${NC}"
    echo -e "${BLUE}======================================${NC}"
    exit 1
fi
