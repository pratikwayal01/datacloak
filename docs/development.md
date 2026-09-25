# Development

```bash
npm install          # workspaces: packages/*
npm run build --workspace packages/detect
npm test --workspace packages/detect        # 28 tests, corpus recall gate
npm test --workspace packages/ner           # 18 tests, NER corpus gate
npm test --workspace packages/opencode-plugin
npm test --workspace packages/cli
npm test --workspace packages/browser-extension
```

## Repo layout

```
packages/
  detect/              @pratikw/detect — engine, patterns, synthesizers, vault
  ner/                 @pratikw/detect-ner — heuristic NER + ONNX loader
  opencode-plugin/     @pratikw/opencode-plugin — v1 hooks, auto cloak/block/redact
  cli/                 @pratikw/datacloak — binary + shell + 10 harness adapters
  browser-extension/   MV3 extension (Chrome/Edge, Firefox expected)
docs/                  this site (MkDocs Material)
```

## Process

Spec → plan → subagent build with per-task review, recorded under
`docs/superpowers/`. Threat model in `.opencode/datacloak-prd.md` §11 —
read it before touching detection semantics.
