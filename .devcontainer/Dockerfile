# MCR publishes Python devcontainer images by major/minor tag, so pin the exact
# reviewed 3.13 baseline with a manifest digest.
FROM mcr.microsoft.com/devcontainers/python:3.13@sha256:9b0762901a555c31c2c63824cb5b1ade77da939500e034317b8d09578b94ba0e

ARG HUGO_VERSION=0.160.0

# Install Sambee system dependencies from centralized script
COPY scripts/install-system-deps /tmp/
RUN bash /tmp/install-system-deps && rm /tmp/install-system-deps

# Copy ImageMagick policy configuration
COPY imagemagick-policy.xml /etc/ImageMagick-7/policy.xml

# Install additional devcontainer-specific packages
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        build-essential \
        curl \
        libkrb5-dev \
        ripgrep \
        smbclient \
        cifs-utils \
        sqlite3 \
        tmux \
        # Tauri v2 Linux system dependencies
        libwebkit2gtk-4.1-dev \
        libxdo-dev \
        libssl-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        file \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Install Hugo Extended as a pinned devcontainer dependency.
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

# Use a minimal bash configuration
USER vscode
RUN printf '%s\n' 'export PATH="$HOME/.local/bin:$PATH"' > ~/.bashrc

# Pre-create directories with correct ownership to prevent Docker from creating them as root
RUN mkdir -p /home/vscode/.vscode-server/extensions \
    && mkdir -p /home/vscode/.vscode-server-insiders/extensions \
    && mkdir -p /home/vscode/.cache/pip \
    && chmod -R 755 /home/vscode/.cache

# Set working directory and run as vscode user
WORKDIR /workspace

CMD ["sleep", "infinity"]
