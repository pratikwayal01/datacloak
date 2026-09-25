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

# Locate the install (global or user prefix) and verify by absolute path —
# no reliance on NODE_PATH resolution quirks across npm/node versions.
PKGDIR=""
for c in "$(npm root -g 2>/dev/null)/@pratikw/detect" "$HOME/.local/lib/node_modules/@pratikw/detect"; do
  if [ -f "$c/package.json" ] && [ -f "$c/dist/engine.js" ]; then PKGDIR="$c"; break; fi
done
if [ -z "$PKGDIR" ]; then
  echo "datacloak: installed but package not found — check npm output above" >&2
  exit 1
fi
node --input-type=module -e "
import('file://$PKGDIR/dist/engine.js').then((m) => {
  const c = new m.DataCloakEngine().cloak('mail john.doe@acme.com');
  if (c.text.includes('john.doe@acme.com')) process.exit(1);
  console.log('datacloak: installed ok (cloak verified)');
}).catch((e) => { console.error('datacloak: verify failed:', e.message); process.exit(1); })"
