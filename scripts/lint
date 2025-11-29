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
NC='\033[0m' # No Color

echo -e "${YELLOW}Running linters for backend and frontend...${NC}\n"

# Backend: Ruff
echo -e "${YELLOW}=== Backend: Ruff ===${NC}"
cd "$REPO_ROOT/backend" || exit 1

echo "Checking Python code with Ruff..."
if ruff check app; then
    echo -e "${GREEN}✓ Ruff check passed${NC}\n"
else
    echo -e "${RED}✗ Ruff check failed${NC}\n"
    exit 1
fi

echo "Checking Python formatting with Ruff..."
if ruff format --check app; then
    echo -e "${GREEN}✓ Ruff format check passed${NC}\n"
else
    echo -e "${RED}✗ Ruff format check failed${NC}\n"
    exit 1
fi

# Frontend: Biome
echo -e "${YELLOW}=== Frontend: Biome ===${NC}"
cd "$REPO_ROOT/frontend" || exit 1

echo "Checking TypeScript/JavaScript with Biome..."
if npm run lint; then
    echo -e "${GREEN}✓ Biome check passed${NC}\n"
else
    echo -e "${RED}✗ Biome check failed${NC}\n"
    exit 1
fi

echo -e "${GREEN}All lint checks passed!${NC}"
