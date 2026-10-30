# LabZSK web: simulator, attempt server, teacher panel – one Node.js process without npm dependencies.
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/web \
    PANEL_DIR=/app/server/panel \
    TZ=Europe/Warsaw

WORKDIR /app
COPY web/ ./web/
COPY tools/ ./tools/
COPY server/ ./server/
RUN mkdir -p /data && chown node:node /data

USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--no-warnings=ExperimentalWarning", "server/src/server.js"]
