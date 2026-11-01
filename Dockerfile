FROM node:20-bookworm-slim

# Install headless Chromium and process supervisor
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    dumb-init \
    ca-certificates \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    NODE_ENV=production

WORKDIR /app

COPY package.json ./
COPY bin/ ./bin/
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY docs/ ./docs/

# Create non-root runtime user for secure browser sandbox execution
RUN useradd -m -s /bin/bash arachne && \
    mkdir -p /app/.arachne-vault && \
    chown -R arachne:arachne /app

USER arachne

EXPOSE 9222 9333

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "bin/arachne.mjs", "status"]
