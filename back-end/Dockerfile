# ============================================
# Backend Dockerfile — RAG-based RPG
# ============================================
# Includes: Node.js backend + CLI2API binary (for per-user proxy isolation)
# Easypanel: Build Path = /back-end

# --- Stage 1: Download CLI2API binary ---
FROM alpine:3.20 AS cli2api-downloader

ARG CLI2API_VERSION=6.8.7
RUN apk add --no-cache curl tar \
    && curl -fSL "https://github.com/router-for-me/CLIProxyAPI/releases/download/v${CLI2API_VERSION}/CLIProxyAPI_v${CLI2API_VERSION}_linux_amd64.tar.gz" \
       -o /tmp/cli2api.tar.gz \
    && mkdir -p /tmp/cli2api \
    && tar -xzf /tmp/cli2api.tar.gz -C /tmp/cli2api \
    && chmod +x /tmp/cli2api/cli-proxy-api

# --- Stage 2: Production image ---
FROM node:20-slim

WORKDIR /app

# Install CLI2API binary from download stage
COPY --from=cli2api-downloader /tmp/cli2api/cli-proxy-api /usr/local/bin/cli-proxy-api

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application source
COPY src/ ./src/

# Create directories for runtime data
RUN mkdir -p /app/data /app/uploads /app/logs

# Environment defaults (override via Easypanel env vars)
ENV PORT=3001
ENV CLI2API_BINARY_PATH=/usr/local/bin/cli-proxy-api
ENV CLI2API_BASE_PORT=8320
ENV CLI2API_MAX_PORTS=200
ENV CLI2API_MANAGEMENT_KEY=mgmt-secret-change-me
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "src/server.js"]
