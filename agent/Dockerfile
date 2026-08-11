FROM node:20-bookworm-slim

# Verktøy Jarvis kan bruke i sandkassen (python + curl for helsesjekker)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 curl ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.mjs ./
COPY lib ./lib

ENV NODE_ENV=production \
    AGENT_HOST=0.0.0.0 \
    AGENT_PORT=8787 \
    AGENT_DATA=/data \
    AGENT_SANDBOX=/data/sandbox

VOLUME ["/data", "/certs"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsk "http${AGENT_TLS_CERT:+s}://127.0.0.1:${AGENT_PORT}/api/status" || exit 1

CMD ["node", "server.mjs"]
