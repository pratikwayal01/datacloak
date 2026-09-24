#!/usr/bin/env bash
# DataCloak one-line installer: npm i -g @datacloak/detect (needs node >= 18)
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "datacloak: missing $1" >&2; exit 1; }; }
need node
need npm

MAJOR="$(node -p "process.versions.node.split('.')[0]")"
test "$MAJOR" -ge 18 || { echo "datacloak: node >= 18 required (found $(node -v))" >&2; exit 1; }

npm install -g @datacloak/detect
node -e "import('@datacloak/detect').then(() => console.log('datacloak: installed ok'))"
