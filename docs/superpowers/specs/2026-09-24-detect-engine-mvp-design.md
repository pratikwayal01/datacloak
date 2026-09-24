# DataCloak Detect Engine MVP — Design

Date: 2026-09-24 | PRD: `.opencode/datacloak-prd.md` v0.2 §4, §7 | Approach: B (PRD structure, minimal toolchain)

## 1. Goal

First shippable slice: `@datacloak/detect` with MVP category coverage, Faker synthetic
substitution, in-memory vault, `detect()/cloak()/restore()` API. Unblocks OpenCode plugin
and browser extension. No toolchain beyond npm + tsc + vitest.

## 2. Non-goals (deferred)

- Full §4.1 coverage: SSN, CC Luhn, IBAN, IPv6, DOB, street address, person names → later.
- `@noble/curves` PEM keypair gen → MVP uses static throwaway PEM template (`ponytail:` comment).
- Encrypted vault persist, NER pass 3, dual CJS/ESM (tsup), turbo, Biome.
- Plugin, extension, demo, full 500-sample corpus.

## 3. Layout

```
packages/detect/
  package.json          # name @datacloak/detect, deps @faker-js/faker, dev vitest + typescript
  tsconfig.json
  src/
    types.ts            # Detection, Substitution, CloakResult, VaultEntry, Config
    patterns/
      secrets.ts        # openai, anthropic, aws, github, stripe, jwt, pem
      credentials.ts    # env KEY=value (50+ names), DSNs, json/yaml inline values
      pii.ts            # email, phone US/E.164, ipv4
      index.ts          # registry: ordered {name, category, type, regex, confidence}
    entropy.ts          # shannon scan, threshold 4.5, len>=20, skip uuid/base64-image
    synthesizers/
      pii.ts            # faker.internet.email/phone/ipv4
      secrets.ts        # SYNTH-infixed format-preserving generators
      credentials.ts    # DSN template engine (preserve protocol/port/path)
      index.ts          # registry category -> fn
    tokens.ts           # opaque [CATEGORY_XXXXXX] fallback
    vault.ts            # bidirectional Map + LRU(2000) + clear/list/getBy*
    engine.ts           # DataCloakEngine
```

## 4. Detection flow

1. Pass 1: registry regexes in priority order (secrets > credentials > pii). Collect matches,
   sort by start asc / length desc, drop overlaps (longest wins). Emit
   `Detection{value,category,type,start,end,confidence}`.
2. Pass 2: tokenize on whitespace/quotes, shannon entropy per word; flag >= threshold and
   len >= 20 unless already matched or uuid/base64-image pattern. Category
   `HIGH_ENTROPY_STRING`, confidence medium.
3. Custom patterns from config validated at construction (`new RegExp` in try/catch,
   invalid → throw with pattern name). Appended lowest priority unless `priority` set.
4. Per-category enable flags: `detection.{secrets,envVars,pii,entropy}`.

## 5. Synthesis

| Category | Strategy |
|---|---|
| email | `faker.internet.email()` |
| phone US/E.164 | `faker.phone.number('(###) 555-0###')` / `'+44770090####'` |
| ipv4 | `faker.internet.ipv4()` |
| openai/anthropic/github/stripe/aws/jwt | prefix preserved + `SYNTH` + random alnum body |
| pem | static throwaway block, real-looking headers, random base64 body |
| env `K=V` | key preserved, value recursed through cloak |
| DSN | protocol/port/path preserved, user/pass/host/db faker-synthesized |
| unknown/custom w/o synthesizer | opaque token fallback + logged |

Rules: consistency via vault `original→synthetic` lookup before generating (DET-12);
collision check — regenerate (max 3 tries) if synthetic already in input text (DET-13);
`SYNTH` infix on all synthetic secrets (DET-10).

## 6. Vault + restore

- `Map<string,VaultEntry>` synthetic→entry + `Map<string,string>` original→synthetic.
- LRU: insertion-order Map, evict oldest when > maxEntries (default 2000).
- `restore(text)`: sort synthetics by length desc, split-join replace, return
  `{text, restored: count}`. No disk writes in MVP.
- `list/getBySynthetic/getByOriginal/clear` per PRD §7.

## 7. Error handling

- Constructor throws on invalid custom regex (fail loudly, DET-08).
- `cloak()` never throws on item failure: fallback opaque token, continue.
- `restore()` never throws: returns input unchanged on internal error.

## 8. Testing

Vitest suites: `patterns.test.ts` (per-pattern true/false positives), `entropy.test.ts`,
`synthesizers.test.ts` (format regex + SYNTH infix + service-invalid shape),
`engine.test.ts` (consistency, collision, de-overlap, custom patterns, restore round-trip),
`bench.test.ts` (10KB input <20ms assertion, non-blocking). MVP corpus: ~80 labeled
samples under `packages/detect/test/corpus.jsonl`, expanded to 500+ in Phase 1 full.

## 9. Acceptance

- DET-03/12 consistency, DET-05 de-overlap, DET-06 flags, DET-07/08 custom, DET-09/10/11
  synthesizers, DET-13 collision, DET-14 fallback, DET-15 template strings.
- `npm test` green, `npm run build` emits CJS via tsc.

## Self-review

- No TBDs. Scope single-package, no contradiction with PRD (structure matches §7,
  toolchain intentionally reduced, noted in §1). MVP category list explicit — no ambiguity
  about what "done" means. Upgrade path (tsup/turbo/noble/corpus) documented in §2.
