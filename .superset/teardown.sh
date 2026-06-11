#!/usr/bin/env bash
# Superset worktree teardown: drop the venv so worktree deletion is clean.
# Run by Superset before deleting the worktree (skipped if absent).
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf .venv
