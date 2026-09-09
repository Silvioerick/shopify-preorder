#!/bin/sh
set -eu

echo "[shopify-preorder] waiting for database migrations..."
npx prisma generate
npx prisma migrate deploy

echo "[shopify-preorder] starting application..."
exec "$@"
