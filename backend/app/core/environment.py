"""
Environment detection for Sambee application.

Automatically detects whether running in development or production mode
based on the presence of built frontend static files.
"""

from pathlib import Path

# Production static files path (created by Docker build)
_STATIC_PATH = Path("/app/static")

#
# Environment Detection
#

# Production: Built frontend static files exist (Docker deployment)
# Development: No static files, frontend runs via Vite dev server
IS_PRODUCTION = _STATIC_PATH.exists()
IS_DEVELOPMENT = not IS_PRODUCTION

# CORS origins for development mode
# In development: frontend runs on separate Vite dev server (port 3000)
# In production: frontend served from same origin as backend (no CORS needed)
DEV_CORS_ORIGINS = ["http://localhost:3000"]
