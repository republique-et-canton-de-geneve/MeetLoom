#!/bin/bash
# PreToolUse hook on Skill: block skill use when gstack is not installed.
# session-start.sh installs gstack in web containers, so this guard is a safety
# net there, not a wall. Never commit this hook without session-start.sh.

if [ ! -d "$HOME/.claude/skills/gstack/bin" ]; then
  cat >&2 <<'MSG'
BLOCKED: gstack is not installed globally.

gstack is required for AI-assisted work in this repository (AGENTS.md).

Install it:
  git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
  cd ~/.claude/skills/gstack && ./setup --team

Then restart your AI coding tool.
MSG
  echo '{"permissionDecision":"deny","message":"gstack is required but not installed. See stderr for install instructions."}'
  exit 0
fi

echo '{}'
