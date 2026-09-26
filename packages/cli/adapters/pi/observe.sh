#!/usr/bin/env bash
# datacloak pi observe shim: tool result on stdin → datacloak scan → context note on hit.
# Observe-only: always exits 0 (Pi tool.after cannot block per harness design).
set -euo pipefail
command -v datacloak >/dev/null || exit 0
code=0
datacloak scan --quiet || code=$?
if [ "$code" -eq 2 ]; then
  echo "[datacloak] previous tool result contained a possible secret; do not repeat or act on it"
fi
exit 0
