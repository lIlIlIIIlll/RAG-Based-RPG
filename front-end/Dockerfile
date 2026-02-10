# ============================================
# Frontend Dockerfile — RAG-based RPG
# ============================================
# Vite React build → served with lightweight Node server
# Easypanel: Build Path = /front-end

# --- Stage 1: Build ---
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Build arg for API URL (set in Easypanel env vars)
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY . .
RUN npm run build

# --- Stage 2: Serve ---
FROM node:20-slim

WORKDIR /app

RUN npm install -g serve@14

COPY --from=builder /app/dist ./dist

ENV PORT=3000

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]
