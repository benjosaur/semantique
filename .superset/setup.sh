#!/usr/bin/env bash
# Superset worktree setup: create a local venv and install deps.
# Run by Superset on new-worktree init (fallback: `bash .superset/setup.sh`).
set -euo pipefail
cd "$(dirname "$0")/.."

uv venv .venv
VIRTUAL_ENV="$PWD/.venv" uv pip install -r requirements.txt -r requirements-dev.txt

echo "venv ready: $(.venv/bin/python --version) at $PWD/.venv"
