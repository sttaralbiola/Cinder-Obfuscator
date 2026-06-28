# Cinder — web wrapper around the Prometheus Lua obfuscator
FROM node:20-bookworm-slim

# lua5.1: the runtime Prometheus targets
# git: used once at build time to pull the obfuscator engine
RUN apt-get update && \
    apt-get install -y --no-install-recommends lua5.1 git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pin the engine to a specific ref so rebuilds are reproducible.
# Override with --build-arg PROMETHEUS_REF=<tag|commit> if you want a specific version.
ARG PROMETHEUS_REF=master
RUN git clone --depth 1 --branch ${PROMETHEUS_REF} \
    https://github.com/prometheus-lua/Prometheus.git /app/prometheus

# Install Node deps first so they're cached separately from app code changes
COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=10000
ENV PROMETHEUS_DIR=/app/prometheus
ENV LUA_BIN=lua5.1

EXPOSE 10000

CMD ["node", "server.js"]
