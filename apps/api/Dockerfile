FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Install tsx globally for running TypeScript
RUN npm install -g tsx@4

# Docker CLI for self-build capability
RUN apk add --no-cache docker-cli docker-cli-compose bash

WORKDIR /app

# Copy the monorepo
COPY . .

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Default environment
ENV FRANK_ENV=development
ENV FRANK_CELL_ID=frank-cell-1
ENV FRANK_API_HOST=0.0.0.0
ENV FRANK_API_PORT=3000
ENV FRANK_PUBLIC_URL=https://frank.fail
ENV FRANK_LOG_LEVEL=info

EXPOSE 3000

# Run migrations then start the API
CMD ["tsx", "apps/api/src/start.ts"]
