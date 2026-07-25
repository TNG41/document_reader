# Build context is the repo root (see docker-compose.yml) so this stage
# can pull in both backend/ and frontend/ — the API serves both from one
# process, so there's nothing else to run.

# --- Build stage: install deps with full dev toolchain available ---
FROM node:20-alpine AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev

# --- Runtime stage: copy only what's needed, run as non-root ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV FRONTEND_DIR=/app/frontend

# tesseract.js downloads a language model at runtime; give it a writable cache dir
RUN mkdir -p uploads .cache && \
    addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

COPY --from=build /app/node_modules ./node_modules
COPY backend/package*.json ./
COPY backend/src ./src
COPY backend/db ./db
COPY frontend ./frontend

USER appuser
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:4000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/app.js"]
