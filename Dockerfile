# Nashriyar — self-hosted image (university server / VPS).
# Stage 1 builds the SPA (dist/) and the Node server bundle (server-dist/node.mjs).
# Stage 2 ships only those two outputs: the bundle is self-contained (migrations inlined,
# only node:* built-ins are external), so the runtime image needs no node_modules at all.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist
WORKDIR /app
# poppler-utils: server-side PDF → page images (pdftoppm), ROADMAP phase 11. Set PDF_RENDERER=browser to skip it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server-dist/node.mjs"]
