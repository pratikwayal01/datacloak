# DataCloak — swap real secrets for fakes before AI ever sees them

![npm](https://img.shields.io/npm/v/@pratikw/detect)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript)
![Stage](https://img.shields.io/badge/stage-detect_MVP-green)
![Tests](https://img.shields.io/badge/tests-28_passing-brightgreen)
![Recall](https://img.shields.io/badge/corpus_recall-100%25-brightgreen)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

![DataCloak cloak and restore demo](assets/poster.jpg)

**DataCloak** is a local-first sensitive-data protection layer for AI prompts.
Paste a `.env`, a DSN, or an API key into your agent — DataCloak swaps every
secret and PII value for a **realistic synthetic fake** (same shape, same
meaning, zero real data) before it reaches the model, then swaps the
originals back into the response. The model reasons over a structurally
identical prompt and its answers come back with your real values restored —
result quality never compromised.

```ts
cloak('contact john.doe@acme.com, key sk-abcdefghij1234567890')
// → 'contact Nigel_Lebsack@hotmail.com, key sk-SYNTHQ4j985lvvRXTkYUwtqW8'
restore(/* model reply with synthetics */)
// → originals back, byte-identical
```

## Contents

- [Status](#status) · [What it detects](#what-it-detects) · [Requirements](#requirements)
- [Installation](#installation) · [Quick start](#quick-start) · [Guarantees](#guarantees)
- [Testing](#testing) · [Honest gaps](#honest-gaps) · [Architecture](#architecture)
- [Publishing](#publishing) · [Contributing](#contributing) · [License](#license)
- [Further reading](#further-reading)

## Status

| Package | What it does | Status |
|---------|--------------|--------|
| `@pratikw/detect` ([npm](https://www.npmjs.com/package/@pratikw/detect)) | Detection engine, Faker synthesis, vault, `detect/cloak/restore` | ✅ v0.1.2 published |
| `@pratikw/opencode-plugin` | Auto cloak/block/redact/restore inside OpenCode, no commands | ✅ Built, unpublished |
| Browser extension | Auto-cloak on 8 AI chat sites, per-tab vault, popup viewer | ✅ Built, unreleased |
| `@pratikw/datacloak` CLI + adapters | `cloak/restore/scan/guard` + hooks for Claude Code, Codex, Gemini, Qwen, Kilo, OpenClaw, Hermes, Pi, DeepSeek, Aider | ✅ Built, unpublished |
| NER (`detect-ner`) | Person names, street addresses, DOB | ⬜ Next |
| Teams + CI | Shared config, `scan` in pre-commit, VS Code | ⬜ Planned |

## What it detects

| Category | Coverage |
|----------|----------|
| API keys | OpenAI, Anthropic, AWS, GitHub PAT, Stripe |
| Tokens | JWT, PEM private keys, high-entropy strings (Shannon ≥ 4.5) |
| Credentials | Env `KEY=value` (50+ key names), DSNs (postgres, mongo, redis, mysql, amqp), inline JSON/YAML secrets |
| PII | Email, US + E.164 phones, IPv4 |

## Requirements

- `node` ≥ 18, `npm`

No account, no server, no network calls. Everything runs in-process.

## Installation

One-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/pratikwayal01/datacloak/master/install.sh | bash
```

Or with npm directly:

```bash
npm install -g @pratikw/detect
```

From source:

```bash
git clone https://github.com/pratikwayal01/datacloak.git && cd datacloak
npm install
npm run build --workspace packages/detect   # tsc → packages/detect/dist/
npm test --workspace packages/detect        # 28 tests
```

## Quick start

```js
import { DataCloakEngine } from '@pratikw/detect';

const cloak = new DataCloakEngine();

// Outbound: real values → synthetics (vault remembers the mapping)
const out = cloak.cloak(
  'DATABASE_URL=postgres://alice:s3cr3t@db.prod.acme.com:5432/users'
);
// → 'DATABASE_URL=postgres://Kaelyn_Torp80:SYNTHpw53@hefty-curl.com:5432/users'
//    key name preserved, protocol/port/path intact, user/pass/host faked

// Inbound: model echoes synthetics → restore originals before display
const back = cloak.restore(modelReply);
// → { text: '...db.prod.acme.com...', restored: 2 }
```

(From source, import from `'./packages/detect/dist/engine.js'` instead.)

## Guarantees

Rules that hold on every call:

- **Consistent identity** — same original → same synthetic within a session.
- **Service-invalid fakes** — synthetic secrets carry a `SYNTH` infix:
  structurally valid, visually identifiable, fail authentication.
- **Key names preserved** — env vars and DSNs keep protocol, port, path
  and key names; only secret values are faked.
- **Safe fallback** — unknown formats become opaque `[CATEGORY_XXXXXX]` tokens.
- **Extensible** — custom regex patterns with loud load-time validation.
- **Local only** — the vault is in-memory, never written to disk.

## Testing

```bash
npm test --workspace packages/detect
# vault, patterns, entropy, synthesizers, engine — 5 suites, 28/28 green
```

- Corpus recall: 39/39 labeled samples (100%, gate ≥ 95%) — `test/corpus.jsonl`
- Perf: ~9.5ms to cloak 12KB (guard < 200ms)
- Synthesis pins: phones locked to fictional `555-01` / `+44770090` ranges,
  JWT encoder UTF-8-safe with NumericDate seconds

## Honest gaps

Surfaced during implementation, all tracked (none hidden):

- Phones match substrings of longer digit runs — recall-oriented MVP tradeoff.
- `cloak()` has no per-item try/catch; only null-synthesizer fallback is
  covered (`opaqueToken`), a throwing custom synthesizer would propagate.
- Opaque-token fallback skips the input-collision check (negligible: random 6-char suffix).
- `restore().restored` counts distinct vault entries hit, not total occurrences.
- Env regex is line-anchored — mid-line `export KEY=v` is missed by design.
- Corpus is 39 samples, not the 500+ planned for Phase 1 full.
- No NER yet: names, street addresses, DOB need co-located signals or wait for Phase 4.

## Architecture

```
packages/detect/src/
├── engine.ts          # DataCloakEngine: detect(), cloak(), restore()
├── patterns/          # secrets.ts, credentials.ts, pii.ts → index.ts registry
├── entropy.ts         # Shannon scan (≥4.5, ≥20 chars, UUID/image skips)
├── synthesizers/      # pii.ts, secrets.ts, credentials.ts → index.ts registry
├── tokens.ts          # opaque [CATEGORY_XXXXXX] fallback
├── vault.ts           # bidirectional Map + LRU(2000)
└── types.ts           # Detection, CloakResult, VaultEntry, Config
```

Two-pass detection: compiled RegExp registry in priority order with
longest-match de-overlap, then an entropy sweep for anything the patterns
missed. Synthesis is per-category Faker calls; the vault maps
`synthetic ↔ original` in memory only — never written to disk.

## Publishing

Maintainer-only. Releases go out via the
[`publish-detect`](.github/workflows/publish.yml) workflow
(repo secret `NPM_TOKEN` needs publish rights on the `@pratikw` scope):

```bash
# bump version in packages/detect/package.json, then:
git tag detect-v0.1.1 && git push origin detect-v0.1.1
# CI builds, tests, checks tag == package version, publishes with provenance
```

## Contributing

Design-then-plan-then-build: spec docs live in `docs/superpowers/specs/`,
implementation plans in `docs/superpowers/plans/` — one written plan per
slice before code. Per-task review (spec + quality) gates every change.
Threat model → `.opencode/datacloak-prd.md` §11 (read it before touching
detection semantics).

## License

MIT — see [LICENSE](LICENSE).

## Further reading

- [`.opencode/datacloak-prd.md`](.opencode/datacloak-prd.md) — full PRD (vision, both surfaces, roadmap)
- [`docs/superpowers/specs/2026-09-24-detect-engine-mvp-design.md`](docs/superpowers/specs/2026-09-24-detect-engine-mvp-design.md) — engine design
- [`docs/superpowers/plans/2026-09-24-detect-engine-mvp.md`](docs/superpowers/plans/2026-09-24-detect-engine-mvp.md) — implementation plan
- `assets/` — launch video (`brag.mp4`), poster
