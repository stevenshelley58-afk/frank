# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY infra ./infra
RUN pnpm install --frozen-lockfile=false
RUN pnpm build

FROM base AS migrate
CMD ["pnpm", "--filter", "@frank/api", "migrate"]

FROM base AS api
COPY runtime ./runtime
EXPOSE 8080
CMD ["pnpm", "--filter", "@frank/api", "start"]

FROM base AS worker
CMD ["pnpm", "--filter", "@frank/workers", "start"]

FROM nginx:1.27-alpine AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=base /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
