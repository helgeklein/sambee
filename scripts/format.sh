#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Auto-formatting backend and frontend...${NC}\n"

# Backend: Ruff
echo -e "${YELLOW}=== Backend: Ruff ===${NC}"
cd /workspace/backend || exit 1

echo "Fixing Python code with Ruff..."
ruff check --fix app
echo -e "${GREEN}✓ Ruff auto-fixes applied${NC}"

echo "Formatting Python code with Ruff..."
ruff format app
echo -e "${GREEN}✓ Ruff formatting applied${NC}\n"

# Frontend: Biome
echo -e "${YELLOW}=== Frontend: Biome ===${NC}"
cd /workspace/frontend || exit 1

echo "Auto-fixing TypeScript/JavaScript with Biome..."
npm run lint:fix
echo -e "${GREEN}✓ Biome auto-fixes applied${NC}"

echo "Formatting TypeScript/JavaScript with Biome..."
npm run format
echo -e "${GREEN}✓ Biome formatting applied${NC}\n"

echo -e "${GREEN}All formatting complete!${NC}"
