#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker não encontrado. Instale Docker Engine + Docker Compose plugin e rode novamente."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin não encontrado."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.docker.example .env

  if command -v openssl >/dev/null 2>&1; then
    DB_PASS="$(openssl rand -hex 24)"
    sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${DB_PASS}/" .env
  fi

  echo
  echo "Arquivo .env criado. Preencha SHOPIFY_API_KEY, SHOPIFY_API_SECRET e SHOPIFY_APP_URL antes de continuar."
  echo "Edite com: nano .env"
  exit 0
fi

if grep -qE '^SHOPIFY_API_KEY=$|^SHOPIFY_API_SECRET=$|^SHOPIFY_APP_URL=$' .env; then
  echo "Preencha SHOPIFY_API_KEY, SHOPIFY_API_SECRET e SHOPIFY_APP_URL no .env."
  exit 1
fi

echo "Subindo PostgreSQL e aplicação..."
docker compose up -d --build

echo
echo "Containers:"
docker compose ps

echo
echo "Logs: docker compose logs -f app"
