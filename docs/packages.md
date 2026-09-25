# Packages

| Package | npm | What it does | Status |
|---|---|---|---|
| `@pratikw/detect` | [npm](https://www.npmjs.com/package/@pratikw/detect) | Detection engine, Faker synthesis, vault | v0.1.2 published |
| `@pratikw/datacloak` | — | `cloak/restore/scan/guard` CLI + shell + 10 harness adapters | v0.1.0 pending |
| `@pratikw/opencode-plugin` | — | Auto cloak/block/redact/restore in OpenCode | v0.1.0 pending |
| `@pratikw/detect-ner` | — | Names, addresses, DOB (heuristics + ONNX loader) | v0.1.0 pending |
| Browser extension | — | 8 chat sites, per-tab vault, popup | Unreleased (load unpacked) |

## What each detects

**detect:** OpenAI/Anthropic/AWS/GitHub/Stripe keys, JWT, PEM, env vars,
DSNs (postgres, mongo, redis, mysql, amqp), inline JSON/YAML secrets,
email, US + E.164 phones, IPv4, high-entropy strings.

**detect-ner** (opt-in): person names, street addresses (US/DE), dates of
birth (gated on co-located PII signal).
