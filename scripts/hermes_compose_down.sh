#!/usr/bin/env bash
set -euo pipefail

docker compose \
  -f docker-compose.yml \
  -f docker-compose.hermes.yml \
  --env-file .env \
  stop hermes

docker compose \
  -f docker-compose.yml \
  -f docker-compose.hermes.yml \
  --env-file .env \
  rm -f hermes

echo "Hermes service stopped. Frank Hub services were not stopped."
