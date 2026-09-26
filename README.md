# DataCloak — swap real secrets for fakes before AI ever sees them

![docs](https://img.shields.io/badge/docs-GitHub_Pages-blue)
![release](https://img.shields.io/github/v/release/pratikwayal01/datacloak)
![npm](https://img.shields.io/npm/v/@pratikw/detect)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript)
![Tests](https://img.shields.io/badge/tests-passing-brightgreen)
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

Full guides: **https://pratikwayal01.github.io/datacloak/**

## What it detects

| Category | Coverage |
|----------|----------|
| API keys | OpenAI (incl. `sk-proj-`, `sk-svcacct-`), Anthropic, AWS, GitHub PAT, Stripe |
| Tokens | JWT, PEM private keys, high-entropy strings (Shannon ≥ 4.5) |
| Credentials | Env `KEY=value` (50+ key names), DSNs (postgres, mongo, redis, mysql, amqp), inline JSON/YAML secrets |
| PII | Email, US + E.164 phones, IPv4 |
| NER (opt-in `@pratikw/detect-ner`) | Person names, street addresses (US/DE), DOB (gated on co-located PII) |

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
npm test --workspace packages/detect        # 29 tests, corpus recall gate
```

Browser extension (unpacked, Chrome/Edge):

```bash
npm install
npm run build --workspace packages/browser-extension  # esbuild → dist/
```

Then open `chrome://extensions`, enable **Developer mode**, click
**Load unpacked**, and select `packages/browser-extension`.
Covers claude.ai, ChatGPT, Gemini, Grok (x.ai), Perplexity, Cowork and
DeepSeek — auto-cloak on send, restore in responses, popup viewer on the
toolbar. Firefox: `about:debugging → This Firefox → Load Temporary Add-on`
with `manifest.json` (untested, expected-compatible).

## Coding agents

One binary, eleven harnesses — full copy-paste steps in
[`docs/harnesses.md`](docs/harnesses.md):

| Agent | Mechanism |
|---|---|
| Claude Code | `UserPromptSubmit` + `PreToolUse`/`PostToolUse` hooks |
| OpenAI Codex CLI | `hooks.json` prompt gate + tool deny/rewrite |
| Gemini CLI | `BeforeAgent`/`BeforeTool`/`AfterTool` hooks |
| Qwen Code | `UserPromptSubmit` + `PreToolUse`/`PostToolUse` hooks |
| Kilo Code | Plugin (re-exports OpenCode hooks) |
| OpenClaw | `before_prompt_build` / `before_tool_call` plugin |
| Hermes Agent | `pre_llm_call` / `pre_tool_call` / result transform |
| Pi | `hooks.yaml` (prompt context-only — Pi limitation) |
| DeepSeek harness | `agent/pre-step` + `tools/pre-execute` cordis plugin |
| Aider | Shell preexec + pre-commit hook (no in-harness API) |
| OpenCode | Native plugin ([npm](https://www.npmjs.com/package/@pratikw/opencode-plugin)) — add `@pratikw/opencode-plugin` to the `plugin` array in `opencode.json`, restart |
| Anything else | `datacloak install-shell` preexec backstop |

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
# vault, patterns, entropy, synthesizers, engine — 5 suites, 29/29 green
```

- Corpus recall: 40/40 labeled samples (100%, gate ≥ 95%) — `test/corpus.jsonl`
  (fixtures use obviously-fake credentials like `admin:pass` by design —
  GitHub secret-scanning hits on them are false positives)
- NER corpus: 26/26 positives + 10/10 negatives — `packages/ner/test/corpus-ner.jsonl`
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
- NER is heuristic-grade: rare surnames matching street suffixes (Lane, Way)
  false-negative; multi-word streets partial; ONNX slot wired, model not bundled.

## Architecture

```
packages/
├── detect/               @pratikw/detect — engine, patterns, synthesizers, vault
│   └── src/
│       ├── engine.ts          # DataCloakEngine: detect(), cloak(), restore()
│       ├── patterns/          # secrets.ts, credentials.ts, pii.ts → index.ts registry
│       ├── entropy.ts         # Shannon scan (≥4.5, ≥20 chars, UUID/image skips)
│       ├── synthesizers/      # pii.ts, secrets.ts, credentials.ts → index.ts registry
│       ├── tokens.ts          # opaque [CATEGORY_XXXXXX] fallback
│       ├── vault.ts           # bidirectional Map + LRU(2000)
│       └── types.ts           # Detection, CloakResult, VaultEntry, Config
├── ner/                  @pratikw/detect-ner — heuristic NER + ONNX loader (opt-in)
├── opencode-plugin/      @pratikw/opencode-plugin — cloak/block/redact/restore hooks
├── cli/                  @pratikw/datacloak — binary + shell + 10 harness adapters
├── browser-extension/    MV3 extension — composer intercept, per-tab vault, popup
└── vscode-extension/     cloak/restore commands, vault tree, status bar
```

Two-pass detection: compiled RegExp registry in priority order with
longest-match de-overlap, then an entropy sweep for anything the patterns
missed. Synthesis is per-category Faker calls; the vault maps
`synthetic ↔ original` in memory only — never written to disk.

## Publishing

Maintainer-only. Single release train: tag `vX.Y.Z` publishes all four
packages (`detect`, `datacloak`, `opencode-plugin`, `detect-ner`) at that
version via [`publish`](.github/workflows/publish.yml)
(repo secret `NPM_TOKEN` needs publish rights on `@pratikw`):

```bash
# bump version in all four packages/*/package.json to X.Y.Z, then:
git tag v0.2.0 && git push origin v0.2.0
# CI builds, tests, checks versions == tag, publishes with provenance
```

Installer flags: `install.sh --repair` (reinstall + re-verify),
`install.sh --uninstall` (removes packages; vault files left for you to purge).

## Contributing

Bug reports and feature requests live in
[GitHub issues](https://github.com/pratikwayal01/datacloak/issues) —
check the [privacy policy](https://pratikwayal01.github.io/datacloak/privacy/)
first if your report involves real credentials (hint: don't paste them;
use synthetic examples). Pull requests welcome: keep them focused, add
tests for behavior changes (`npm test --workspace packages/<name>`).

## Contact

Bug reports and feature requests: https://github.com/pratikwayal01/datacloak/issues.

## License

MIT — see [LICENSE](LICENSE).

## Further reading

- [Documentation](https://pratikwayal01.github.io/datacloak/) — install, quick start, agents, architecture, privacy
- [Threat model](.opencode/datacloak-prd.md) — full PRD (vision, surfaces, roadmap, §11 limitations)
- `assets/` — launch video (`brag.mp4`), poster
