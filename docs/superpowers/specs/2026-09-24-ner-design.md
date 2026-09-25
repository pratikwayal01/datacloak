# NER Slice (Hybrid) — Design

Date: 2026-09-24 | PRD: `.opencode/datacloak-prd.md` v0.2 §4.2 (Pass 3), Phase 3

## 1. Goal

`packages/ner` (`@pratikw/detect-ner`): person names, street addresses, and
dates of birth. Hybrid: heuristic provider ships and works with zero
downloads; `NerProvider` interface + ONNX loader accept a user-supplied
model path (model acquisition is a tracked follow-up, not this slice).

## 2. Architecture

```ts
interface NerProvider {
  name: string;
  detectNames(text: string): Span[];      // {value, start, end, confidence}
  detectAddresses(text: string): Span[];
  detectDob(text: string, context: PiiContext): Span[];
}
interface PiiContext { hasEmail: boolean; hasPhone: boolean; hasId: boolean; }
```

- **Heuristic provider** (ships):
  - Names: title-case token pairs (`[A-Z][a-z]+ [A-Z][a-z]+`) with
    allowlist signals (honorific `Mr|Ms|Dr`, preceding `my name is|contact|attn`,
    signature position) and blocklist (sentence starts, months, weekdays,
    common code identifiers, company suffixes Inc/LLC/GmbH).
    Confidence high with signal, medium bare pair, never single tokens.
  - Addresses: house-number + street-suffix (`St|Ave|Rd|Blvd|Str|Weg|Road|...`)
    + town + ZIP/postcode (`\d{5}(-\d{4})?`, UK `A[A]9[A] 9AA`-family,
    DE 5-digit) in one window; all three parts required for high.
  - DOB: ISO/DMY/MDY date patterns, accepted ONLY when PiiContext shows a
    co-located email/phone/ID signal (PRD rule); otherwise ignored.
- **ONNX provider** (wired, model-supplied): `OnnxNerProvider(modelPath)`
  lazy-loads `onnxruntime-node` (optional peer, dynamic import so the base
  package has zero native deps) and maps label spans to the same `Span[]`.
  Without a model file it throws a clear install hint at construction.
- **Engine integration**: `new DataCloakEngine({ ner })` runs provider
  after pass 1 + entropy, de-overlaps (pattern wins ties), maps categories
  `PERSON_NAME`/`STREET_ADDRESS`/`DATE_OF_BIRTH` (type pii). Synthesis
  reuses existing Faker table (no new synthesizers).
- **Config**: `detection: { ..., nerNames: false }` default OFF (PRD:
  false-positive rate); per-call opt-in, no global default change.

## 3. Layout

```
packages/ner/
  package.json   # @pratikw/detect-ner, peerOptional onnxruntime-node
  tsconfig.json
  src/{types.ts,heuristic.ts,onnx.ts,index.ts}
  test/{heuristic.test.ts,integration.test.ts}
  test/corpus-ner.jsonl (~40 lines: names/addresses/dobs + negatives)
```

## 4. Testing

Heuristic unit tests (signal/blocklist matrix, address 3-part rule, DOB
gating on/off context); ONNX loader tests (missing file → hint error;
mocked session object for span mapping — no real model download);
engine integration (NER detections cloak + restore round-trip; pattern
wins overlap, e.g. email inside signature block); corpus recall gate ≥90%
(heuristics, documented below ONNX-grade).

## Self-review

- Scope single-package + engine option; no changes to detect internals
  except the `ner` constructor option (additive).
- ONNX-without-model is honest: loader + mapping tested with mocks, real
  model acquisition filed as follow-up (no fake eval numbers).
- DOB gating and never-single-token-names bound the false-positive rate;
  corpus includes adversarial negatives (Lorem sentences, code identifiers).
