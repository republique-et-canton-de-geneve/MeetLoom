#!/bin/bash
# SessionStart hook: prepare a Claude Code on the web container for this repo.
# Idempotent; skipped on local machines, where AGENTS.md documents the
# one-time manual gstack install.
#   1. npm dependencies, so `npm run check` works from the first prompt.
#   2. gstack, required by AGENTS.md and enforced by check-gstack.sh.

set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
GSTACK_DIR="$HOME/.claude/skills/gstack"

# 1. npm dependencies. `npm ci` never rewrites the lockfile. `--ignore-scripts`
# because this runs unattended before anyone has looked at the branch: no
# dependency lifecycle script executes automatically in a session that holds a
# repository token. MeetLoom needs none (SQLite is built into Node). A stamp of
# the lockfile hash, written only after success, decides whether to reinstall.
if [ -f "$REPO_ROOT/package-lock.json" ]; then
  NPM_STAMP="$REPO_ROOT/node_modules/.session-start-lockfile"
  LOCK_HASH=$(sha256sum "$REPO_ROOT/package-lock.json" 2>/dev/null | cut -d' ' -f1)
  if [ -n "$LOCK_HASH" ] && [ "$(cat "$NPM_STAMP" 2>/dev/null)" = "$LOCK_HASH" ]; then
    echo "[session-start] dependencies match package-lock.json, skipping install."
  elif (cd "$REPO_ROOT" && npm ci --ignore-scripts --no-audit --no-fund); then
    [ -n "$LOCK_HASH" ] && printf '%s\n' "$LOCK_HASH" > "$NPM_STAMP"
  else
    echo "[session-start] WARNING: npm ci failed; run it by hand before trusting any check."
  fi
fi

# 2. Playwright browser: the container ships a Chromium that may not match
# the Playwright version in package-lock.json; playwright.config.ts uses
# PW_CHROMIUM_PATH instead of downloading the pinned build.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -z "${PW_CHROMIUM_PATH:-}" ]; then
  PW_CHROMIUM_PATH=$(find /opt/pw-browsers -name chrome -type f 2>/dev/null | sort -V | tail -1)
  if [ -n "$PW_CHROMIUM_PATH" ]; then
    echo "export PW_CHROMIUM_PATH=\"$PW_CHROMIUM_PATH\"" >> "$CLAUDE_ENV_FILE"
    echo "[session-start] PW_CHROMIUM_PATH -> $PW_CHROMIUM_PATH"
  fi
fi

# 3. gstack.
if [ -d "$GSTACK_DIR/bin" ]; then
  echo "[session-start] gstack already installed."
else
  echo "[session-start] installing gstack (required by AGENTS.md)..."
  mkdir -p "$HOME/.claude/skills"
  rm -rf "$GSTACK_DIR"
  if git clone --single-branch --depth 1 \
       https://github.com/garrytan/gstack.git "$GSTACK_DIR" >/dev/null 2>&1; then
    if (cd "$GSTACK_DIR" && ./setup --team --plan-tune-hooks=no --quiet >/dev/null 2>&1); then
      echo "[session-start] gstack ready."
    else
      # A half-installed clone would let check-gstack.sh allow skills and make
      # the next session skip the install; remove it so the next one retries.
      rm -rf "$GSTACK_DIR"
      echo "[session-start] WARNING: gstack setup failed; clone removed so the next session retries."
    fi
  else
    echo "[session-start] WARNING: could not clone gstack (no network?); skills will be blocked."
  fi
fi

exit 0
