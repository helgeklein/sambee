# syntax=docker/dockerfile:1.7

# Shared runtime for production, development, and container validation. Each
# cache-busted build refreshes Debian packages before installing dependencies.
ARG PYTHON_BASE_IMAGE=python:3.13.12-slim@sha256:f1927c75e81efd1e091dbd64b6c0ecaa5630b38635a3d1c04034ac636e1f94c8
FROM ${PYTHON_BASE_IMAGE} AS runtime-base
ENV DEBIAN_FRONTEND=noninteractive
ARG APT_REFRESH_KEY=static

COPY scripts/install-system-deps /tmp/
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    printf 'APT package refresh key: %s\n' "$APT_REFRESH_KEY" && \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    UPGRADE_EXISTING_PACKAGES=1 bash /tmp/install-system-deps && \
    rm /tmp/install-system-deps

# Development target: inherits the runtime contract, then adds editor and
# companion tooling without upgrading shared runtime packages again.
FROM runtime-base AS devcontainer
ARG HUGO_VERSION=0.160.0
ARG NODE_MAJOR=24
ARG RUST_TOOLCHAIN=stable

RUN apt-get update && \
    apt-get -y install --no-install-recommends \
        build-essential \
        ca-certificates \
        cifs-utils \
        curl \
        file \
        gcc-mingw-w64-x86-64 \
        git \
        gnupg \
        jq \
        libayatana-appindicator3-dev \
        libkrb5-dev \
        librsvg2-dev \
        libssl-dev \
        libwebkit2gtk-4.1-dev \
        libxdo-dev \
        ripgrep \
        smbclient \
        sqlite3 \
        sudo \
        tmux \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*

RUN arch="$(dpkg --print-architecture)" \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg arch=${arch}] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get -y install --no-install-recommends nodejs \
    && corepack enable \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*

RUN arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
        amd64) hugo_arch="Linux-64bit" ;; \
        arm64) hugo_arch="Linux-ARM64" ;; \
        *) echo "Unsupported architecture for Hugo: $arch" >&2; exit 1 ;; \
    esac \
    && curl -fsSL \
        "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_${hugo_arch}.tar.gz" \
        -o /tmp/hugo.tar.gz \
    && tar -xzf /tmp/hugo.tar.gz -C /tmp hugo \
    && install -m 0755 /tmp/hugo /usr/local/bin/hugo \
    && rm -f /tmp/hugo.tar.gz /tmp/hugo

RUN useradd --create-home --shell /bin/bash --uid 1000 vscode \
    && echo "vscode ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/vscode \
    && chmod 0440 /etc/sudoers.d/vscode \
    && mkdir -p /home/vscode/.cache/pip /home/vscode/.vscode-server/extensions /home/vscode/.vscode-server-insiders/extensions \
    && chown -R vscode:vscode /home/vscode

USER vscode
ENV PATH="/workspace/backend/.venv/bin:/home/vscode/.cargo/bin:/home/vscode/.local/bin:${PATH}"
RUN curl -fsSL https://sh.rustup.rs -o /tmp/rustup-init.sh \
    && chmod +x /tmp/rustup-init.sh \
    && /tmp/rustup-init.sh -y --profile minimal --default-toolchain "${RUST_TOOLCHAIN}" \
    && rustup component add rustfmt clippy \
    && rm -f /tmp/rustup-init.sh \
    && printf '%s\n' 'export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"' > ~/.bashrc
WORKDIR /workspace
CMD ["sleep", "infinity"]

# Build frontend on the native builder because the emitted assets are architecture-independent.
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
COPY frontend/scripts ./scripts
RUN npm ci
COPY frontend/ ./
COPY VERSION /VERSION
COPY GIT_COMMIT /GIT_COMMIT
RUN npm run build

# Build the pyvips wheel natively because upstream only publishes an sdist.
FROM --platform=$BUILDPLATFORM ${PYTHON_BASE_IMAGE} AS pyvips-wheel-builder
WORKDIR /tmp/pyvips-wheel-builder
COPY backend/requirements.lock.txt ./
RUN pyvips_version="$(sed -n 's/^pyvips==\([^[:space:]\\]*\).*/\1/p' requirements.lock.txt)" && \
    test -n "$pyvips_version" && \
    pip wheel --wheel-dir /tmp/wheels --no-deps "pyvips==$pyvips_version"

# Backend test target: combines the shared runtime dependencies with the
# development toolchain required by Companion relay interoperability tests.
FROM devcontainer AS backend-test
USER root
WORKDIR /workspace
COPY backend/requirements-dev.lock.txt /tmp/requirements-dev.lock.txt
COPY --from=pyvips-wheel-builder /tmp/wheels /tmp/wheels
RUN python -m venv /workspace/backend/.venv && \
    /workspace/backend/.venv/bin/python -m pip install --upgrade pip && \
    /workspace/backend/.venv/bin/python -m pip install \
        --require-hashes \
        --find-links=/tmp/wheels \
        -r /tmp/requirements-dev.lock.txt && \
    rm -rf /tmp/wheels
COPY backend/ ./backend/
COPY archive-contract/ ./archive-contract/
COPY archive_testdata/ ./archive_testdata/
COPY companion/ ./companion/
COPY VERSION ./VERSION
COPY .github/ ./.github/
COPY scripts/ ./scripts/
RUN chown -R vscode:vscode /workspace
USER vscode
ENV PYTHONPATH=/workspace/backend

# Production target: Python backend with built frontend.
FROM runtime-base AS production
WORKDIR /app
RUN useradd -m -u 1000 sambee && \
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
COPY scripts/preflight-archive-v2-cutover scripts/reset-archive-v2-cutover-state ./scripts/
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

# Block deployment before migrations when legacy archive operation state remains.
CMD ["sh", "-c", "/app/scripts/preflight-archive-v2-cutover && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-proxy-headers"]
