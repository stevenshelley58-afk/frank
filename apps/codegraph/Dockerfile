# frank-codegraph — lightweight Tree-sitter WASM code intelligence service.
# Runs as a long-lived watcher daemon. Writes graph JSON to a shared volume
# that frank-api serves read-only. Zero coupling to the request path.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install deps (only codegraph + its workspace deps)
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/codegraph/package.json apps/codegraph/
COPY packages/pipeline-graph/package.json packages/pipeline-graph/
RUN pnpm install --frozen-lockfile --filter @frank/codegraph... --no-optional 2>/dev/null || \
    pnpm install --filter @frank/codegraph... --no-optional

# Runtime
FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/codegraph/node_modules ./apps/codegraph/node_modules
COPY apps/codegraph/ apps/codegraph/

# Output volume mount point
RUN mkdir -p /data/codegraph
VOLUME /data/codegraph

ENV CODEGRAPH_OUTPUT=/data/codegraph
ENV CODEGRAPH_HOST=0.0.0.0
ENV CODEGRAPH_PORT=3002
EXPOSE 3002

# Run with tsx (no build step — the service is lightweight enough)
CMD ["npx", "tsx", "apps/codegraph/src/index.ts"]
