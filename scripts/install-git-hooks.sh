#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Not a git repository: $ROOT" >&2
  exit 1
fi

git config core.hooksPath .githooks
chmod +x .githooks/pre-push scripts/git-pre-push-check.sh

echo "Git hooks installed (core.hooksPath=.githooks)"
echo "Before each push: npm run build (+ prisma generate) must pass."
echo "Skip once: SKIP_PRE_PUSH=1 git push"
