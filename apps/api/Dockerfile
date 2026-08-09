FROM node:22.23.2-alpine3.23@sha256:46825fbbd4e996a78b7a2cdc08d75e38a5a505bdab95dcda55605359bf124bc6

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Docker CLI for self-build capability
RUN apk add --no-cache docker-cli docker-cli-compose bash

WORKDIR /app

# Copy the monorepo
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile

# Default environment
ENV FRANK_ENV=development
ENV FRANK_CELL_ID=frank-cell-1
ENV FRANK_API_HOST=0.0.0.0
ENV FRANK_API_PORT=3000
ENV FRANK_PUBLIC_URL=https://frank.fail
ENV FRANK_LOG_LEVEL=info

EXPOSE 3000

# Run migrations then start the API
CMD ["pnpm", "--filter", "@frank/api", "exec", "tsx", "apps/api/src/start.ts"]
