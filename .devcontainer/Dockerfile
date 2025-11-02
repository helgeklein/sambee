FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

# Install additional OS packages
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        build-essential \
        libkrb5-dev \
        smbclient \
        cifs-utils \
        sqlite3 \
        postgresql-client \
        redis-tools \
        zsh \
        tmux \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Install oh-my-zsh for better terminal experience
USER vscode
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended \
    && echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc

# Switch back to root for remaining setup
USER root

# Create workspace directory
RUN mkdir -p /workspace && chown -R vscode:vscode /workspace