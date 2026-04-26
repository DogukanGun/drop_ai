#!/usr/bin/env bash
# Bootstraps per-plugin Python venvs for every plugin under plugins/* that ships
# a requirements.txt. Idempotent — re-running upgrades existing envs in place.
#
# Usage:
#   scripts/setup-plugin-venvs.sh                     # all plugins
#   scripts/setup-plugin-venvs.sh node-browser-use    # one plugin
set -euo pipefail

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required (https://docs.astral.sh/uv/). Install with:"
  echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=( $(ls "$ROOT/plugins") )
fi

for name in "${TARGETS[@]}"; do
  dir="$ROOT/plugins/$name"
  if [ ! -d "$dir" ]; then
    echo "skip: $name (no such directory)"
    continue
  fi
  if [ ! -f "$dir/requirements.txt" ]; then
    echo "skip: $name (no requirements.txt — likely a Node plugin)"
    continue
  fi
  echo
  echo "=== $name"
  ( cd "$dir" && uv venv --python 3.11 --allow-existing && uv pip install -r requirements.txt )
done

echo
echo "Done. Restart the orchestrator so the bridge picks up new venvs."
