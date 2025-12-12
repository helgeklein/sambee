# Multi-stage build for production
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend with built frontend
FROM python:3.13-slim
WORKDIR /app

# Set non-interactive mode for apt to avoid warnings
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies and create user
COPY scripts/install-system-deps /tmp/
RUN bash /tmp/install-system-deps && \
    rm /tmp/install-system-deps && \
    useradd -m -u 1000 sambee && \
    mkdir -p /app/data && \
    chown sambee:sambee /app/data && \
    date -u +"%Y-%m-%dT%H:%M:%SZ" > /BUILD_TIME

# Copy ImageMagick policy and metadata files
COPY imagemagick-policy.xml /etc/ImageMagick-7/policy.xml
COPY VERSION /VERSION
COPY GIT_COMMIT /GIT_COMMIT

# Copy backend code and built frontend
COPY backend/ ./
COPY --from=frontend-builder /app/dist ./static

# Install Python dependencies (requirements.txt has been copied in the previous step)
RUN pip install --root-user-action=ignore --disable-pip-version-check --no-cache-dir -r requirements.txt

# Switch to non-root user
USER sambee

# Expose port
EXPOSE 8000

# Health check (curl is installed via install-system-deps script)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]