#!/usr/bin/env bash
set -euo pipefail

# Runs before git push — blocks push when TypeScript build fails (same as Docker deploy).
# Skip once: SKIP_PRE_PUSH=1 git push

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "${SKIP_PRE_PUSH:-}" = "1" ]; then
  echo "[pre-push] SKIP_PRE_PUSH=1 — build check skipped"
  exit 0
fi

echo "[pre-push] tabaghe-api: checking build before push..."

export DATABASE_URL="${DATABASE_URL:-postgresql://prepush:prepush@127.0.0.1:5432/prepush?schema=public}"

if ! npx prisma generate >/dev/null; then
  echo "[pre-push] prisma generate failed — push cancelled" >&2
  exit 1
fi

if ! npm run build; then
  echo "[pre-push] BUILD FAILED — fix errors above, then push again" >&2
  echo "[pre-push] (skip once: SKIP_PRE_PUSH=1 git push)" >&2
  exit 1
fi

echo "[pre-push] build OK — pushing"
exit 0
