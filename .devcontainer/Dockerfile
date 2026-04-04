FROM mcr.microsoft.com/devcontainers/python:3.13

# Install Sambee system dependencies from centralized script
COPY scripts/install-system-deps /tmp/
RUN bash /tmp/install-system-deps && rm /tmp/install-system-deps

# Copy ImageMagick policy configuration
COPY imagemagick-policy.xml /etc/ImageMagick-7/policy.xml

# Install additional devcontainer-specific packages
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        build-essential \
        libkrb5-dev \
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
