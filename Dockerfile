# syntax=docker/dockerfile:1.7

# Multi-stage build for production
# Stage 1: Build frontend on the native builder because the emitted assets are architecture-independent.
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# Provide build metadata to the frontend bundle so client-side version checks
# use the same values the backend reports at runtime.
COPY VERSION /VERSION
COPY GIT_COMMIT /GIT_COMMIT
RUN npm run build

# Stage 2: Build the pyvips wheel natively because upstream only publishes an sdist.
FROM --platform=$BUILDPLATFORM python:3.13.12-slim@sha256:f1927c75e81efd1e091dbd64b6c0ecaa5630b38635a3d1c04034ac636e1f94c8 AS pyvips-wheel-builder
WORKDIR /tmp/pyvips-wheel-builder
COPY backend/requirements.lock.txt ./
RUN pyvips_version="$(sed -n 's/^pyvips==\([^[:space:]\\]*\).*/\1/p' requirements.lock.txt)" && \
    test -n "$pyvips_version" && \
    pip wheel --wheel-dir /tmp/wheels --no-deps "pyvips==$pyvips_version"

# Stage 3: Python backend with built frontend
FROM python:3.13.12-slim@sha256:f1927c75e81efd1e091dbd64b6c0ecaa5630b38635a3d1c04034ac636e1f94c8
WORKDIR /app

# Set non-interactive mode for apt to avoid warnings
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies and create user
COPY scripts/install-system-deps /tmp/
RUN UPGRADE_EXISTING_PACKAGES=1 bash /tmp/install-system-deps && \
    rm /tmp/install-system-deps && \
    useradd -m -u 1000 sambee && \
    mkdir -p /app/data && \
    chown sambee:sambee /app/data

# Copy ImageMagick policy and metadata files
COPY imagemagick-policy.xml /etc/ImageMagick-7/policy.xml

# Copy backend dependency lockfile first for better caching (changes rarely)
COPY backend/requirements.lock.txt ./
COPY --from=pyvips-wheel-builder /tmp/wheels /tmp/wheels

# Install Python dependencies before copying full backend (changes rarely - better layer caching)
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --root-user-action=ignore --disable-pip-version-check --require-hashes --find-links=/tmp/wheels -r requirements.lock.txt && \
    rm -rf /tmp/wheels

# Copy version metadata (changes often)
COPY VERSION /VERSION
COPY GIT_COMMIT /GIT_COMMIT

ARG BUILD_CREATED_AT=unknown

# Keep runtime build metadata consistent across architectures by sourcing it
# from a single workflow-provided timestamp instead of per-platform build time.
RUN printf '%s\n' "$BUILD_CREATED_AT" > /BUILD_TIME

# Copy backend code and built frontend (change often)
COPY backend/ ./
COPY --from=frontend-builder /app/dist ./static

# Recreate the writable runtime data directory after copying the backend.
# This prevents checked-in dev data from shadowing the production data path
# and ensures SQLite can create /app/data/sambee.db as the non-root user.
RUN rm -rf /app/data && \
    mkdir -p /app/data && \
    chown sambee:sambee /app/data

# Switch to non-root user
USER sambee

# Expose port
EXPOSE 8000

# Health check (wget is installed via install-system-deps script)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8000/api/health >/dev/null || exit 1

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
