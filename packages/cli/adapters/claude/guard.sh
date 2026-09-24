#!/usr/bin/env bash
# datacloak hook shim: harness JSON on stdin → datacloak guard → harness codec on stdout
set -euo pipefail
INPUT="$(cat)"
TOOL="$(printf '%s' "$INPUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_name||j.tool||'')}catch{}})")"
if [ -n "$TOOL" ]; then
  printf '%s' "$INPUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write(JSON.stringify({event:'tool',tool:j.tool_name||j.tool,args:j.tool_input||j.input||{}}))})" | datacloak guard
else
  printf '%s' "$INPUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const t=j.prompt||j.text||'';process.stdout.write(JSON.stringify({event:'prompt',text:t}))}catch{process.stdout.write(JSON.stringify({event:'prompt',text:''}))}})" | datacloak guard
fi
