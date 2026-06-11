#!/usr/bin/env bash
# Superset workspace setup (wired up via .superset/config.json): create a
# local venv and install deps. Superset runs setup commands with cwd = the
# new workspace/worktree directory — do NOT cd relative to this script, since
# Superset's no-config fallback invokes the MAIN repo's copy of setup.sh
# against the worktree cwd.
set -euo pipefail

uv venv .venv
VIRTUAL_ENV="$PWD/.venv" uv pip install -r requirements.txt -r requirements-dev.txt

echo "venv ready: $(.venv/bin/python --version) at $PWD/.venv"
