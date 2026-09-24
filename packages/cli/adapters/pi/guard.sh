#!/usr/bin/env bash
# datacloak pi hook shim: pi hook JSON on stdin → datacloak guard → exit code/stdout
# exit 2 blocks the tool call; stdout {"tool_args":{...}} rewrites args (use with modify:true)
set -euo pipefail
INPUT="$(cat)"
OUT="$(printf '%s' "$INPUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const t=j.tool_name||j.tool||'';if(t){process.stdout.write(JSON.stringify({event:'tool',tool:t,args:j.tool_args||j.tool_input||j.input||{}}))}else{process.stdout.write(JSON.stringify({event:'prompt',text:j.prompt||j.text||''}))}}catch{process.stdout.write(JSON.stringify({event:'prompt',text:''}))}}})" | datacloak guard || true)"
DEC="$(printf '%s' "$OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).decision||'allow')}catch{process.stdout.write('allow')}})")"
if [ "$DEC" = "deny" ]; then
  printf '%s' "$OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stderr.write((JSON.parse(s).reason||'denied by datacloak')+'\n')}catch{}})"
  exit 2
fi
if [ "$DEC" = "rewrite" ]; then
  printf '%s' "$OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.stringify({tool_args:JSON.parse(s).args}))}catch{}})"
fi
exit 0
