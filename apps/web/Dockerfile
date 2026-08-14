# @frank/web — built inside the monorepo so workspace packages
# (@frank/pipeline-graph) resolve. Same shape as apps/api/Dockerfile:
# COPY the repo, pnpm install, run from source. Build context is the repo
# root (see infra/docker-compose.dev.yml).
FROM node:22.23.2-alpine3.23@sha256:46825fbbd4e996a78b7a2cdc08d75e38a5a505bdab95dcda55605359bf124bc6

# ffmpeg/git: retained for image stability; explorer/worktrees routes that
# needed them were deleted in Wave 1.
RUN apk add --no-cache ffmpeg git

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

# Copy the monorepo (repo-root .dockerignore excludes node_modules/.next/.git)
COPY . .

# Install dependencies (workspace links included)
RUN pnpm install --frozen-lockfile

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

# Build the Next.js app (transpiles @frank/pipeline-graph via next.config.mjs)
RUN pnpm --filter @frank/web build

EXPOSE 3001

CMD ["pnpm", "--filter", "@frank/web", "start"]
