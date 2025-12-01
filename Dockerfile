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

# Install system dependencies from centralized script
COPY scripts/install-system-deps /tmp/
RUN bash /tmp/install-system-deps && rm /tmp/install-system-deps

# Copy ImageMagick policy configuration (after ImageMagick is installed)
COPY imagemagick-policy.xml /etc/ImageMagick-7/policy.xml

# Copy and install backend dependencies
COPY backend/requirements.txt .
RUN pip install --root-user-action=ignore --disable-pip-version-check --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./

# Copy built frontend
COPY --from=frontend-builder /app/dist ./static

# Create non-root user and data directory with appropriate permissions
RUN useradd -m -u 1000 sambee && \
    mkdir -p /app/data && \
    chown sambee:sambee /app/data

# Switch to non-root user
USER sambee

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]