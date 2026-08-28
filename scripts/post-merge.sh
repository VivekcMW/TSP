#!/usr/bin/env bash
set -euo pipefail

# Post-merge setup runs with stdin closed, so keep every command non-interactive.
export CI=true

if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  npm run db:push
else
  echo "DATABASE_URL is not set; skipping database schema sync."
fi

npm run build