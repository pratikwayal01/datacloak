#!/usr/bin/env bash
# DataCloak one-line installer: npm i -g @pratikw/detect (needs node >= 18)
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "datacloak: missing $1" >&2; exit 1; }; }
need node
need npm

MAJOR="$(node -p "process.versions.node.split('.')[0]")"
test "$MAJOR" -ge 18 || { echo "datacloak: node >= 18 required (found $(node -v))" >&2; exit 1; }

# Global prefix not writable (system node)? Fall back to ~/.local instead of
# failing with EACCES — never sudo from a piped installer.
PREFIX_ARGS=()
if ! test -w "$(npm root -g 2>/dev/null || echo /nonexistent)"; then
  PREFIX_ARGS=(--prefix "$HOME/.local")
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) echo "datacloak: add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\"" >&2 ;;
  esac
fi

npm install -g "${PREFIX_ARGS[@]}" @pratikw/detect
NODE_PATH="$(npm root -g "${PREFIX_ARGS[@]}")" node -e "import('@pratikw/detect').then(() => console.log('datacloak: installed ok'))"
