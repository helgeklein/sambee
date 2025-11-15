FROM mcr.microsoft.com/devcontainers/python:3.13

# Install Sambee system dependencies from centralized script
COPY scripts/install-system-deps.sh /tmp/
RUN bash /tmp/install-system-deps.sh && rm /tmp/install-system-deps.sh

# Install additional devcontainer-specific packages
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        build-essential \
        libkrb5-dev \
        smbclient \
        cifs-utils \
        sqlite3 \
        zsh \
        tmux \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Install oh-my-zsh for better terminal experience
USER vscode
RUN rm -rf ~/.oh-my-zsh \
    && sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended \
    && echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc

# Pre-create directories with correct ownership to prevent Docker from creating them as root
RUN mkdir -p /home/vscode/.vscode-server/extensions \
    && mkdir -p /home/vscode/.vscode-server-insiders/extensions \
    && mkdir -p /home/vscode/.cache/pip \
    && chmod -R 755 /home/vscode/.cache

# Set working directory and run as vscode user
WORKDIR /workspace

CMD ["sleep", "infinity"]