.PHONY: help dev stop test clean setup

help:
	@echo "Available commands:"
	@echo "  make setup   - Initial setup"
	@echo "  make dev     - Start development servers"
	@echo "  make stop    - Stop all services"
	@echo "  make test    - Run all tests"
	@echo "  make clean   - Clean up containers and volumes"

setup:
	@docker compose -f .devcontainer/docker-compose.yml build
	@docker compose -f .devcontainer/docker-compose.yml run --rm devcontainer bash .devcontainer/post-create.sh

dev:
	@echo "Starting backend on http://localhost:8000"
	@echo "Starting frontend on http://localhost:3000"
	@docker compose -f docker-compose.dev.yml up

stop:
	@docker compose -f docker-compose.dev.yml down

test:
	@docker compose -f docker-compose.dev.yml run --rm backend pytest
	@docker compose -f docker-compose.dev.yml run --rm frontend npm test

clean:
	@docker compose -f docker-compose.dev.yml down -v
	@docker compose -f .devcontainer/docker-compose.yml down -v
	@rm -rf data/*.db
	@rm -rf frontend/node_modules
	@rm -rf backend/__pycache__