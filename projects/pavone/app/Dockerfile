FROM node:22-alpine

# node:22-alpine already ships a `node` user at uid/gid 1000 — reuse it rather
# than creating a second uid 1000 (which fails the build with "gid in use").
WORKDIR /app

# Zero runtime dependencies, so there is deliberately no `npm install` step.
# .dockerignore keeps .env, data/ and .git out of the image — do not remove it,
# it is what stops the API key being baked into an image layer.
COPY --chown=node:node . .

# The data volume must be writable by the non-root runtime user.
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 8787
VOLUME /app/data

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/app/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
