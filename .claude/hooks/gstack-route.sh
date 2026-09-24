#!/bin/bash
# UserPromptSubmit hook: route every prompt through gstack by default, so the
# maintainer never has to write "use gstack". Deliberately short: this text is
# prepended to every prompt. The reasoning lives in AGENTS.md.

set -uo pipefail

if [ ! -d "$HOME/.claude/skills/gstack/bin" ]; then
  echo "gstack is NOT installed: say so plainly rather than silently working without it (AGENTS.md requires it)."
  exit 0
fi

cat <<'ROUTING'
Before acting, pick the gstack command that fits this prompt and use it. Route:
- reported bug / "why does X happen" -> /investigate
- change is written, about to land -> /review
- security question or audit -> /cso
- "what is the state of the code" / quality baseline -> /health
- test the running app, find and fix bugs -> /qa (/qa-only to report without fixing)
- vague intent that needs pinning down -> /spec ; plan needing a second opinion -> /plan-eng-review
- performance or load question -> /benchmark, plus loadtest/run.mjs for the server
- writing or refreshing docs after a change -> /document-release
State the command you chose in one line before running it. If genuinely none
fits (a pure question, a one-line edit), say "no gstack command fits: <reason>"
and proceed, but do not skip this choice silently. Repository rules in
AGENTS.md (tests first, docs/handoff.md, no internal hostnames) still apply.
ROUTING
exit 0
