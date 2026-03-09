#!/bin/sh
set -e

echo "[entrypoint] Running DB migration (drizzle-kit push)..."
npx drizzle-kit push --force
echo "[entrypoint] DB migration complete."

echo "[entrypoint] Starting Next.js..."
exec npm start
