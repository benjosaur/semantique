#!/usr/bin/env bash
# Superset workspace teardown (wired up via .superset/config.json): drop the
# venv before the worktree is deleted. cd to this script's repo root rather
# than trusting cwd — this script always lives inside the worktree being
# deleted, so the dirname anchor is safe in every invocation path.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf .venv
