#!/usr/bin/env bash
# DataCloak one-line installer: npm i -g @pratikw/detect (needs node >= 18)
# Usage: install.sh [--uninstall] [--repair]
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

if [ "${1:-}" = "--uninstall" ]; then
  npm rm -g "${PREFIX_ARGS[@]}" @pratikw/detect @pratikw/datacloak @pratikw/opencode-plugin @pratikw/detect-ner 2>/dev/null || true
  echo "datacloak: uninstalled (vault files in ~/.config/datacloak left in place — delete manually to purge secrets)"
  exit 0
fi

install_pkg() {
  npm install -g "${PREFIX_ARGS[@]}" @pratikw/detect 2>&1 | grep -v -E "npm warn|fund" || true
}

# Locate the install (global or user prefix); require dist present (not just dir).
locate_pkg() {
  local c
  for c in "$(npm root -g 2>/dev/null)/@pratikw/detect" "$HOME/.local/lib/node_modules/@pratikw/detect"; do
    if [ -f "$c/package.json" ] && [ -f "$c/dist/engine.js" ]; then printf '%s' "$c"; return 0; fi
  done
  return 1
}

verify_pkg() {
  local dir="$1"
  node --input-type=module -e "
import('file://$dir/dist/engine.js').then((m) => {
  const c = new m.DataCloakEngine().cloak('mail john.doe@acme.com');
  if (c.text.includes('john.doe@acme.com')) process.exit(1);
  console.log('datacloak: installed ok (cloak verified)');
}).catch((e) => { console.error('datacloak: verify failed:', e.message); process.exit(1); })"
}

PKGDIR="$(locate_pkg || true)"
if [ "${1:-}" = "--repair" ] || [ -z "$PKGDIR" ]; then
  [ -z "$PKGDIR" ] && echo "datacloak: missing or broken install — (re)installing" >&2
  install_pkg
  PKGDIR="$(locate_pkg || true)"
fi
if [ -z "$PKGDIR" ]; then
  echo "datacloak: install failed — package not found after install, check npm output above" >&2
  exit 1
fi
verify_pkg "$PKGDIR"
