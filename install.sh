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

# Mantém o projeto longe das portas padrão da VPS.
if grep -q '^APP_PORT=' .env; then
  sed -i 's/^APP_PORT=.*/APP_PORT=3187/' .env
else
  echo 'APP_PORT=3187' >> .env
fi

if grep -q '^POSTGRES_PORT=' .env; then
  sed -i 's/^POSTGRES_PORT=.*/POSTGRES_PORT=55432/' .env
else
  echo 'POSTGRES_PORT=55432' >> .env
fi

if grep -qE '^SHOPIFY_API_KEY=$|^SHOPIFY_API_SECRET=$|^SHOPIFY_APP_URL=$' .env; then
  echo "Preencha SHOPIFY_API_KEY, SHOPIFY_API_SECRET e SHOPIFY_APP_URL no .env."
  exit 1
fi

echo "Portas configuradas: app=3187, postgres interno=55432"
echo "Subindo PostgreSQL e aplicação..."
docker compose up -d --build

echo
echo "Containers:"
docker compose ps

echo
echo "Logs: docker compose logs -f app"
