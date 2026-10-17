# MandateGRC production image. No npm dependencies: the app runs on Node's standard library.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    TRUST_PROXY=1 \
    MANDATEGRC_DATA_DIR=/data

WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
COPY tools/backup.mjs ./tools/backup.mjs

# Run as an unprivileged user; the database lives on a mounted volume at /data.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
