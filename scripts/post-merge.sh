#!/bin/bash
# This script runs in Replit after a git merge.
# Oracle uses GitHub Actions instead — do NOT use this script on Oracle.
set -e
echo "[post-merge] Installing dependencies..."
pnpm install --frozen-lockfile
echo "[post-merge] Done."
