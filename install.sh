#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 LTS is required." >&2
  exit 1
fi

node_major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$node_major" -ne 22 ]; then
  echo "Node.js 22 LTS is required. Other major versions are not supported yet." >&2
  exit 1
fi

node scripts/codexdentist.mjs install
