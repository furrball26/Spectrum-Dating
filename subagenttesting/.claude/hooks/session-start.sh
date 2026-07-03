#!/usr/bin/env bash
# SessionStart hook for the subagenttesting repo.
#
# Runs once at the start of every Claude Code session (interactive, headless,
# or cloud routine). Use it to make each session reproducible: install
# dependencies, warm caches, and surface repo context.
#
# Output on stdout is added to the session context, so keep it short and useful.
#
# TODO: when real tooling is added, install deps here, e.g.:
#   [ -f package.json ] && npm install --silent
#   [ -f requirements.txt ] && pip install -q -r requirements.txt

set -euo pipefail

echo "=== subagenttesting :: session start ==="
echo "Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'n/a')"
echo "HEAD:   $(git log -1 --oneline 2>/dev/null || echo 'n/a')"

# No dependency manifest or test suite exists yet; nothing to install.
if [ ! -f package.json ] && [ ! -f pyproject.toml ] && [ ! -f Cargo.toml ] && [ ! -f go.mod ]; then
  echo "Note: no build/test tooling detected yet (bare repo)."
fi

exit 0
