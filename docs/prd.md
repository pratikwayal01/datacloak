# DataCloak PRD
## Sensitive Data Protection for AI Coding Agents and Browser Interfaces

**Version:** 0.2 — Draft  
**Date:** September 24, 2026  
**Status:** For review — synthetic substitution strategy resolved  

---

## 1. Overview

### 1.1 Problem Statement

AI coding agents and browser-based AI chat interfaces routinely receive text that contains secrets, credentials, and PII. When a developer pastes a `.env` file into OpenCode to debug a connection string, or asks Claude to help refactor code that reads from `process.env`, the raw values — database passwords, API keys, OAuth tokens — flow directly into the model's context window, are transmitted to external inference providers, logged in session history, and potentially used in training data.

The same problem exists in the browser: developers paste stack traces with IP addresses, support engineers paste customer records into ChatGPT, and HR teams draft performance reviews in Gemini — all with personally identifiable information intact.

This is not a theoretical risk. The OWASP Top 10 for LLMs (2025) lists Sensitive Information Disclosure (LLM01) as the leading vulnerability class for AI-integrated applications, and Gartner predicts that by 2028, fifty percent of all enterprise cybersecurity incident responses will involve AI application data leaks.

### 1.2 Existing OSS Landscape

Several open-source projects address parts of this problem. DataCloak is designed with full awareness of them and is differentiated in scope, detection quality, and the combination of surfaces it covers.

| Project | Surface | Approach | Key Gaps |
|---|---|---|---|
| **opencode-security-guard** (marioalexandreantunes) | OpenCode plugin | 53 regex rules + entropy, 5-layer hook chain, in-memory vault with HMAC-SHA256 tokens | No PII (emails, phones, SSNs) — secrets only; no restore to agent; no browser surface |
| **opencode-secrets-protect** (jscheel) | OpenCode plugin | 40+ pattern + entropy detection via `tool.execute.after` | Output-only (doesn't guard prompts); no vault/restore; no PII |
| **taisy03/opencode-key-plugin** | OpenCode plugin | secretlint (27 rules) + vault + `/key` command; injects keys as env vars | Limited to API keys; no PII; no browser surface |
| **SteamedFish/opencode-guard** | OpenCode plugin | HMAC-masked values that preserve format (emails stay valid) | Config-file global salt required; no PII generalization; no browser surface |
| **PiiI** (JaySmith502) | Chrome extension (MV3) | Local ML inference, alias mapping per session, 6 AI chat sites | No secrets/env-var detection; no OpenCode integration; active development only |
| **Blankit** (SVirat) | Chrome extension (MV3) | Local PII redaction, file upload support, audit log | No secrets; no OpenCode; closed-source core despite OSS claim |
| **PrivacyScrubber** | Chrome extension (MV3) | Token substitution + restore, offline, no account needed | Regex-only; no entropy; no OpenCode; no audit |
| **pii-shield-extension** (kaispriestersbach) | Chrome extension (MV3) | Chrome Built-in AI (Gemini Nano) for detection, reversible + one-way modes | Requires Chrome Canary/Dev; Gemini Nano dependency; no secrets |
| **presidio** (data-privacy-stack, ex-Microsoft) | Python library / Docker service | NER + regex + checksum, 50+ entity types, images, structured data | Not an agent plugin or browser extension; requires Python runtime; no secrets detection built-in |
| **GrowthSpace MCP proxy** | MCP proxy layer | Lightweight sidecar that redacts PII in MCP tool results | PII only; no secrets; not packaged as a reusable extension |
| **hoop.dev** | MCP gateway (MIT) | Identity-aware L7 proxy, policy engine, session recording | Server-side infrastructure; not a developer's local tool; requires deployment |

**The gap:** No existing OSS project combines (a) full secrets + PII + env-var detection, (b) bidirectional cloaking with a reversible token vault, (c) an OpenCode plugin surface, and (d) a browser extension surface, all in a single cohesive tool with a shared detection engine and shared configuration model.

### 1.3 Product Vision

DataCloak is an open-source, local-first sensitive data protection layer that intercepts text before it reaches any AI model — whether that model is being driven by OpenCode, a browser chat interface, or an MCP tool call. Rather than replacing sensitive values with opaque brackets like `[REDACTED]` or `[API_KEY_X4T9KQZ]`, DataCloak substitutes them with **Faker-generated synthetic values** that are structurally identical to the originals: a real-looking email replaces a real email, a plausible Stripe key replaces a real Stripe key, a valid-format phone number replaces a real phone number. The model receives text that reads naturally and reasons over it accurately — it just never sees the real data. A local vault maps every synthetic value back to the original so responses can be de-synthesized on return. All processing happens on the user's machine. Nothing is ever sent to a DataCloak server.

---

## 2. Goals and Non-Goals

### 2.1 Goals

- Prevent API keys, secrets, credentials, and PII from reaching AI model providers in both agentic (OpenCode) and interactive (browser chat) contexts.
- Provide bidirectional cloaking: cloak on the way in, restore on the way back.
- Ship a single detection engine (TypeScript) shared by both surfaces so rules stay in sync.
- Be zero-config by default: no account, no server, no required setup beyond installation.
- Be transparent: every redaction is logged locally; users can see exactly what was replaced and why.
- Be extensible: custom regex patterns and named entity rules can be added per-project.
- Maintain full context utility: cloaked text must be indistinguishable in structure and meaning from the original so the model reasons over it naturally — achieved by replacing real values with Faker-generated synthetic equivalents, not opaque tokens.

### 2.2 Non-Goals

- Network egress control or firewall enforcement — DataCloak cannot stop a shell command from `curl`-ing secrets to an external host.
- Protection against a compromised OpenCode binary or malicious plugins loaded in the same process.
- GDPR/HIPAA compliance certification — DataCloak is a technical control that supports compliance but does not provide it.
- Image or audio redaction (tracked for a future release).
- Multi-user or cloud vault — the vault is strictly local and session-scoped.
- Replacing a dedicated secrets manager (Vault, AWS Secrets Manager, 1Password CLI) — DataCloak complements those tools at the AI-agent boundary.

---

## 3. Target Users

**Primary: Individual developers using OpenCode or browser-based AI chat**  
Developers who paste `.env` files, config snippets, database connection strings, or API key rotation scripts into AI agents as part of daily workflow. They want protection that is invisible when nothing sensitive is present and informative when something is caught.

**Secondary: Security-conscious teams and platform engineers**  
Teams that need a lightweight DLP control at the AI boundary without standing up infrastructure. They want custom rules per repo, an audit trail, and CI/CD integration (e.g., run DataCloak in dry-run mode on committed files).

**Tertiary: Support engineers and non-technical AI chat users**  
People who paste customer data, support tickets, or medical records into ChatGPT or Claude. They need automatic protection without any understanding of what was detected or why.

---

## 4. Detection Engine

The detection engine is the core shared library. Both the OpenCode plugin and the browser extension import it. It runs entirely in-process — no subprocess, no network call, no native binary.

### 4.1 Detection Categories

**Secrets**
- API keys: OpenAI (`sk-…`), Anthropic (`sk-ant-…`), AWS (`AKIA…`), Google Cloud (`AIza…`), Stripe (`sk_live_…`, `rk_live_…`), Twilio, SendGrid, GitHub PAT (`ghp_…`, `github_pat_…`), GitLab, Slack, Shopify, Vercel, Supabase, Hugging Face
- PEM private keys (RSA, EC, DSA, OPENSSH)
- JWTs (`eyJ…`)
- Bearer tokens in Authorization headers
- Generic high-entropy strings (Shannon entropy ≥ 4.5 over ≥ 20 characters, with false-positive suppression for base64-encoded images and UUIDs)

**Credentials in structured text**
- Environment variable assignments: `KEY=value` where the key matches a credential pattern (50+ known key names)
- Connection strings and DSNs: `postgres://user:pass@host`, `mongodb+srv://…`, `redis://:pass@…`, `mysql://…`, `amqp://user:pass@…`
- Inline config values in JSON/YAML/TOML: `"api_key": "…"`, `secret: '…'`, etc.
- `.env` file format (entire file or inline)

**PII**
- Email addresses
- Phone numbers (US, international E.164)
- Social Security Numbers / National ID numbers (US SSN, UK NI, German Steuernummer)
- Credit card numbers (Luhn-validated, all major networks)
- IBAN / bank account numbers
- IP addresses (IPv4 and IPv6, with private-range suppression option)
- Dates of birth (when co-located with other PII signals)
- Street addresses (US, UK, DE; heuristic NER-assisted)
- Person names (optional; NER-based, off by default due to false-positive rate)

### 4.2 Detection Architecture

Detection runs in two passes:

**Pass 1 — Pattern matching (sync, <1ms for typical prompts)**  
A compiled set of RegExp objects applied in priority order. Matches are de-overlapped (longest match wins). Each match produces a `Detection` record: `{ value, category, type, start, end, confidence }`.

**Pass 2 — Entropy scan (sync, <5ms for typical prompts)**  
A sliding-window Shannon entropy scan over tokenized words. Words exceeding the entropy threshold that were not already matched in pass 1 are flagged as `HIGH_ENTROPY_STRING` with `confidence: "medium"`.

A future optional Pass 3 will support a locally-running NER model (via ONNX Runtime) for name and address detection, following the architecture of `privaite` and `presidio`. This is off by default.

### 4.3 Synthetic Substitution via Faker

**Decision: DataCloak uses Faker-generated synthetic values as substitutes, not opaque tokens.**

This resolves the token format open question entirely. Rather than replacing `john.doe@acme.com` with `[EMAIL_7BFNX1K]`, DataCloak replaces it with `patricia.holden@nexosoft.net` — a structurally valid email that the model treats as a real email. The model can still reason about "this is an email field", "the domain suggests a B2B context", "format this in a mailto link" — all without seeing the actual address.

**Why this matters over opaque tokens:**

Opaque tokens break semantic flow. A prompt like `"My database URL is [DATABASE_URL_R3TQP9W], why is it throwing a connection timeout?"` forces the model to work around the placeholder. The same prompt with `"My database URL is postgres://svc_user:wKqT7x2@db-staging.nexosoft.net:5432/appdb, why is it throwing a connection timeout?"` — synthetic but structurally real — lets the model reason about host, port, credentials format, SSL, and connection string validity exactly as it would with the real value.

#### 4.3.1 Faker Package and Locale

DataCloak depends on `@faker-js/faker` (MIT, zero native deps, browser-compatible). Locale defaults to `en` (US). Configurable per-project to any Faker locale for locale-appropriate synthetic names, addresses, and phone formats.

```bash
# No extra install needed — faker is a dependency of @datacloak/detect
npm install @datacloak/opencode-plugin
```

The browser extension bundles only the Faker modules it uses (tree-shaken), adding ~85KB to the extension bundle.

#### 4.3.2 Substitution Map by Detection Category

Each category has a dedicated synthesizer that calls Faker APIs to produce a structurally valid, semantically plausible replacement.

**PII**

| Category | Real example | Synthetic replacement | Faker call |
|---|---|---|---|
| Email | `john.doe@acme.com` | `patricia.holden@nexosoft.net` | `faker.internet.email()` |
| Phone (US) | `(415) 555-0192` | `(832) 555-0247` | `faker.phone.number('(###) 555-0###')` |
| Phone (E.164) | `+447700900123` | `+447700900847` | `faker.phone.number('+44770090####')` |
| SSN | `324-67-8901` | `518-92-3047` | `faker.string.numeric` + checksum mask |
| Credit card | `4111 1111 1111 1111` | `4539 8280 3821 5742` | `faker.finance.creditCardNumber('visa')` |
| IBAN | `GB29NWBK60161331926819` | `GB47BARC20040191003530` | `faker.finance.iban({ countryCode: 'GB' })` |
| IPv4 | `192.168.1.104` | `10.237.44.91` | `faker.internet.ipv4()` |
| IPv6 | `2001:db8::1` | `fe80::4ab1:c2d3:e4f5:6a7b` | `faker.internet.ipv6()` |
| Person name | `Alice Johnson` | `Marcus Okafor` | `faker.person.fullName()` |
| Street address | `123 Main St, Austin TX 78701` | `847 Larkspur Ave, Denver CO 80203` | `faker.location.streetAddress(true)` |
| Date of birth | `1987-03-22` | `1991-09-14` | `faker.date.birthdate()` — same decade bracket |

**Secrets and credentials**

For secrets, the synthesizer generates values that match the structural format of the original (prefix, length, character set) but are provably invalid — they will fail authentication at the service boundary. This is a critical safety property: synthetic secrets must never accidentally be valid.

| Category | Real example | Synthetic replacement | Strategy |
|---|---|---|---|
| OpenAI API key | `sk-abcdefghij1234567890` | `sk-SYNTHfaker7291kxmqpRtz` | Prefix preserved, body is `SYNTH` + random alphanumeric — structurally valid, checksum invalid |
| Anthropic API key | `sk-ant-api03-abc…` | `sk-ant-api03-SYNTHfkr92…` | Same — prefix + version preserved |
| AWS Access Key | `AKIAIOSFODNN7EXAMPLE` | `AKIASYNT3HFKR29QMXZB` | AKIA prefix + 16 random uppercase alphanumeric |
| GitHub PAT | `ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ` | `ghp_SYNTHfkr7291KXmqPrTzWbVn` | `ghp_` prefix + 36 random chars |
| Stripe secret key | `sk_live_abcdefghij1234567890` | `sk_live_SYNTHfkr7291kxmqpRtz` | Prefix preserved, body synthetic |
| JWT | `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_5NTkZBfQfRXNVIo` | Valid-structure JWT with synthetic claims and an invalid signature | `faker` generates sub/iat/exp claims, body is re-encoded, signature replaced with random bytes |
| PEM private key | `-----BEGIN RSA PRIVATE KEY-----\n…` | Fresh RSA-2048 key generated by `@noble/rsa` | A real but throwaway keypair — structurally indistinguishable from the original |

**Credentials in structured text**

Connection strings are synthesized preserving the driver/protocol prefix, port conventions, and path structure, while replacing user, password, host, and database name with Faker equivalents.

| Category | Real | Synthetic |
|---|---|---|
| Postgres DSN | `postgres://alice:s3cr3t@db.prod.acme.com:5432/users` | `postgres://marcus_svc:SYNTHpw49@db-staging.nexosoft.net:5432/appdata` |
| MongoDB | `mongodb+srv://admin:pass@cluster0.abcd1.mongodb.net/mydb` | `mongodb+srv://synth_user:SYNTHpw82@cluster0.xk9p2.mongodb.net/catalog` |
| Redis | `redis://:secretpassword@redis.acme.com:6379/0` | `redis://:SYNTHpw17@cache.nexosoft.net:6379/0` |
| Env var assignment | `DATABASE_URL=postgres://alice:s3cr3t@…` | `DATABASE_URL=postgres://marcus_svc:SYNTHpw49@…` — key name preserved, value synthesized |

The key name in an env var assignment is **always preserved** — it is not PII and removing it would destroy the prompt's meaning. Only the value is substituted.

#### 4.3.3 Consistency Guarantee

Within a session, the same original value always maps to the same synthetic value. This is critical: if `john.doe@acme.com` appears five times in a prompt, all five occurrences are replaced by the same synthetic email. The model sees a consistent identity throughout the conversation.

The vault stores the bidirectional mapping: `synthetic → original`. On response, DataCloak scans the model's output for known synthetic values and replaces them with originals before showing them to the user.

```typescript
// Vault entry structure
type VaultEntry = {
  original: string;       // the real value — never leaves the vault
  synthetic: string;      // what the model sees
  category: string;       // e.g. "EMAIL", "API_KEY_OPENAI"
  type: 'pii' | 'secret' | 'credential';
  synthesizedAt: number;  // timestamp
  confidence: 'high' | 'medium';
  fakerSeed?: number;     // reproducible synthesis (optional, for testing)
};
```

#### 4.3.4 Synthesis Safety Rules

1. **Synthetic secrets must be structurally valid but service-invalid.** A synthetic API key must look like an API key but must never authenticate. The `SYNTH` infix in the body ensures a human reading logs can identify synthetic values. Any service doing prefix-only validation will accept the format; any service doing full validation will reject it.

2. **Synthetic PII must not correspond to a real person.** Faker email domains default to `example.com`, `nexosoft.net`, and other non-existent or reserved domains. Names are drawn from Faker's diverse name pool and are statistically unlikely to match a real person by accident.

3. **Synthetic values must not appear in the user's existing text.** Before finalizing a synthetic value, DataCloak checks that it does not already appear anywhere in the input. Collision probability is negligible but the check is cheap.

4. **PEM key synthesis generates a real but throwaway keypair.** DataCloak uses `@noble/curves` (zero deps, audited) to generate a fresh keypair on the fly. The synthetic key is real and usable — it simply has no authorization anywhere. The private key is generated in ~2ms.

#### 4.3.5 Fallback to Opaque Token

When no structurally valid synthetic value can be generated for a detection (e.g., a novel proprietary format, or a custom pattern added by the user), DataCloak falls back to an opaque token: `[CUSTOM_PATTERN_7BFNX1K]`. Fallback is logged and surfaced in the session panel. Users are encouraged to add a custom synthesizer for their custom patterns via config.

```jsonc
// .opencode/datacloak.json — custom synthesizer example
{
  "customPatterns": [
    {
      "name": "Internal Employee ID",
      "pattern": "EMP-[0-9]{6}",
      "category": "EMPLOYEE_ID",
      "type": "pii",
      "synthesizer": "EMP-{{faker.number.int({min:100000,max:999999})}}"
    }
  ]
}
```

### 4.4 Vault

The vault is an in-memory bidirectional Map: `synthetic → VaultEntry` and `original → synthetic` (for deduplication). It is never written to disk by default. An optional encrypted-at-rest mode writes the vault to `~/.config/datacloak/vault.enc` using AES-256-GCM with a key derived from the OS keychain (Keytar on macOS/Linux/Windows). This enables vault persistence across sessions — useful when a developer works across multiple OpenCode sessions on the same project.

Vault capacity is bounded (default: 2000 entries, LRU eviction). The vault is cleared on process exit (OpenCode plugin) or tab close (browser extension).

**Reverse scan on response:** when the model returns a response, DataCloak scans the response text for any synthetic values currently in the vault and replaces them with originals. This works because Faker values are long and specific enough that accidental collisions with non-synthetic content in the response are negligible. The scan runs in O(n × m) where n is response length and m is vault size — fast enough for typical response sizes (<50ms for a 10KB response with 50 vault entries).

---

## 5. OpenCode Plugin

### 5.1 Architecture

The OpenCode plugin registers five hooks using the `@opencode-ai/plugin` SDK, forming a defense-in-depth chain. Each hook is independent — a failure in one does not disable the others.

```
User prompt
    │
    ▼
[hook: chat.message]          ← cloak user-typed prompts
    │
    ▼
[hook: experimental.chat.system.transform]  ← cloak system prompt (injected context, rules)
    │
    ▼
[hook: experimental.chat.messages.transform] ← cloak full message history before inference
    │
    ▼
[Model provider — only sees tokens, never originals]
    │
    ▼
[hook: tool.execute.before]   ← block dangerous tool calls (env dumps, secret file reads)
    │
    ▼
[hook: tool.execute.after]    ← redact tool output (file reads, bash stdout, MCP results)
    │
    ▼
Response rendered in OpenCode TUI
```

### 5.2 Hook Specifications

**`chat.message`**  
Intercepts the user's outgoing message before it is appended to history. Runs the detection engine on the message text. Replaces matched values with tokens. Returns the cloaked message. Emits a TUI notification listing categories detected (never the values themselves): `"DataCloak: replaced 2 secrets, 1 email"`.

**`experimental.chat.system.transform`**  
Intercepts the assembled system prompt (which may include injected file contents, memory summaries, and OpenCode rules). Runs detection and replaces matches. This is particularly important because system prompts often include automatically-injected context from tools like `@file`, `@git`, or MCP servers.

**`experimental.chat.messages.transform`**  
Last line of defense over the full message array sent to the inference provider. Scans all message parts: `text`, `system`, `summary`, `error`, `path`, `tool_result` content. Any token that slipped through earlier hooks is caught here.

**`tool.execute.before`**  
Receives the tool name and arguments before execution. Implements a blocklist of tool calls that are known to exfiltrate secrets:

- `bash` / `shell`: blocks commands matching patterns like `cat ~/.env`, `printenv`, `env | grep`, `echo $SECRET`, `export`, reads of `~/.ssh/`, `~/.aws/credentials`, `~/.config/` secrets directories. Configurable allow/block lists per project.
- `read_file` / `edit_file`: blocks reads of known sensitive paths (`.env`, `.env.local`, `*.pem`, `id_rsa`, `credentials`, `secrets.yaml`) unless the user has explicitly allowed them via `datacloak.allowPaths` in project config.
- MCP tool calls: scans the arguments object recursively for secrets before the call is dispatched.

In `warn` mode (default): shows a confirmation prompt in the TUI. In `block` mode: hard-blocks and logs. In `allow` mode: passes through (for trusted paths).

**`tool.execute.after`**  
Receives the tool result. Recursively traverses the result object (text, title, metadata, nested arrays) and replaces any detected secrets or PII with tokens. If the detection engine returns a high-confidence match, the substitution is silent. For medium-confidence matches, a comment is appended: `[DataCloak: 1 possible secret redacted from output]`. On detection failure or exception, the entire output is suppressed and replaced with a safe error message (fail-closed).

### 5.3 Configuration

Configuration is read from, in priority order:
1. Environment variables (`DATACLOAK_*`)
2. Project-level `.opencode/datacloak.json`
3. User-level `~/.config/datacloak/config.json`
4. Built-in defaults

```jsonc
// .opencode/datacloak.json
{
  "enabled": true,
  "mode": "warn",               // "warn" | "block" | "allow" (for tool.execute.before)
  "detection": {
    "secrets": true,
    "envVars": true,
    "pii": true,
    "entropy": true,
    "entropyThreshold": 4.5,
    "nerNames": false           // off by default; requires ONNX runtime
  },
  "allowPaths": [
    ".env.example",
    "fixtures/**"
  ],
  "blockPaths": [
    ".env",
    ".env.local",
    "**/*.pem",
    "~/.ssh/**"
  ],
  "customPatterns": [
    {
      "name": "Internal Employee ID",
      "pattern": "EMP-[0-9]{6}",
      "category": "EMPLOYEE_ID",
      "type": "pii"
    }
  ],
  "vault": {
    "persist": false,           // true = write encrypted vault to disk
    "maxEntries": 2000
  },
  "notifications": {
    "onDetection": true,        // TUI toast on detection
    "onBlock": true,            // TUI toast on blocked tool call
    "showCategories": true,     // show what was detected (not the values)
    "showCount": true
  }
}
```

### 5.4 Slash Command

DataCloak registers a `/datacloak` slash command in OpenCode with subcommands:

- `/datacloak status` — show enabled rules, vault size, detection counts for this session
- `/datacloak vault` — list synthetic↔original mappings (synthetic value shown, original blurred; categories shown)
- `/datacloak reveal <synthetic>` — reveal the original value behind a specific synthetic value (requires confirmation)
- `/datacloak restore <message>` — replace tokens in a pasted message with originals from vault
- `/datacloak clear` — clear the vault and reset session counts
- `/datacloak test <text>` — dry-run detection on arbitrary text, show what would be replaced
- `/datacloak config` — show active configuration

### 5.5 Installation

```bash
# Global install (recommended)
npm install -g @datacloak/opencode-plugin

# Or project-local
npm install --save-dev @datacloak/opencode-plugin
```

Add to `~/.config/opencode/opencode.json` or `.opencode/opencode.json`:

```json
{
  "plugins": [
    { "package": "@datacloak/opencode-plugin" }
  ]
}
```

No further setup required. On first run, DataCloak prints a startup banner listing active rules and the location of its project directory.

### 5.6 Differentiation from Existing Plugins

| Feature | DataCloak | opencode-security-guard | opencode-guard | opencode-secrets-protect |
|---|---|---|---|---|
| Secrets detection | ✓ (50+ patterns) | ✓ (53 rules) | ✓ | ✓ (40+ patterns) |
| PII detection | ✓ | ✗ | ✗ | ✗ |
| Env var / DSN detection | ✓ | ✓ | partial | partial |
| Entropy scanning | ✓ | ✓ | ✓ | ✓ |
| **Faker synthetic substitution** | **✓** | ✗ (HMAC tokens) | ✓ (format-preserving HMAC) | ✗ (opaque replace) |
| Prompt-layer hook | ✓ | ✓ | ✗ | ✗ |
| Tool output hook | ✓ | ✓ | ✗ | ✓ |
| Tool call blocking | ✓ | ✓ | ✗ | ✗ |
| System prompt hook | ✓ | ✓ | ✗ | ✗ |
| History transform hook | ✓ | ✓ | ✗ | ✗ |
| Bidirectional vault (restore) | ✓ | ✗ | ✓ | ✗ |
| Vault persistence option | ✓ | ✗ | ✗ | ✗ |
| Custom patterns + synthesizers | ✓ | ✓ | ✓ | ✗ |
| Slash command | ✓ | ✗ | ✗ | ✗ |
| Shared engine with browser ext | ✓ | ✗ | ✗ | ✗ |

---

## 6. Browser Extension

### 6.1 Architecture

The browser extension is a Manifest V3 Chrome/Edge/Firefox extension. It intercepts outgoing prompts and incoming responses on supported AI chat sites.

**Components:**

```
┌─────────────────────────────────────────────────────────┐
│ Extension                                               │
│                                                         │
│  manifest.json (MV3)                                    │
│  ├── background.js (Service Worker)                     │
│  │   ├── Detection engine (shared with OpenCode plugin) │
│  │   ├── Vault (chrome.storage.session, per-tab)        │
│  │   └── Config (chrome.storage.sync)                   │
│  ├── content_script.js (injected per supported domain)  │
│  │   ├── Prompt interceptor                             │
│  │   ├── Response scanner                               │
│  │   └── UI overlays (indicator badge, review panel)    │
│  └── popup.html / popup.js                              │
│      ├── Rule toggles                                   │
│      ├── Session stats                                  │
│      ├── Vault viewer                                   │
│      └── Custom patterns editor                         │
└─────────────────────────────────────────────────────────┘
```

**Supported sites (v1.0):**  
Claude.ai, ChatGPT (chat.openai.com), Gemini (gemini.google.com), Grok (x.ai/grok), Perplexity (perplexity.ai), Cowork (cowork.ai), DeepSeek (chat.deepseek.com)

### 6.2 Prompt Interception

The content script monitors the chat input textarea on each supported site. Interception fires when the user presses Enter or clicks the send button, before the site's own submit handler.

**Flow:**

1. Content script captures the prompt text from the textarea.
2. Sends the text to the background service worker via `chrome.runtime.sendMessage`.
3. Background runs the detection engine.
4. If detections exist:
   a. **Auto-cloak mode (default):** replaces values with tokens, returns cloaked text, content script rewrites the textarea value, allows submit to proceed. Shows a non-blocking badge: `"DataCloak: 3 items cloaked"`.
   b. **Review mode (optional):** blocks submit, shows an inline review panel listing each detection with category, a preview of the matched value (first 4 + last 2 chars, rest starred), and Accept/Skip buttons per item. User confirms and submit proceeds.
5. If no detections: submit proceeds normally with zero latency overhead.

**Latency target:** <20ms from keypress to textarea rewrite for typical prompts (≤10KB). Detection engine is warm after first use; cold start is <100ms.

### 6.3 Response Scanning

The content script uses a MutationObserver on the response container to detect when new text is streamed into the page. When streaming completes (detected via a stable DOM state), the response text is scanned for synthetic values from the current session's vault. Because the model received realistic synthetic data, it will often echo those values back in its response (e.g., "I see the database host is `db-staging.nexosoft.net` — try checking your firewall rules for that host"). DataCloak catches these echo-backs and replaces them with the original values in the local DOM, so the user reads the response with their real data restored.

Any synthetic values found are highlighted briefly with a subtle `↩ restored` indicator in the DOM. Clicking the indicator shows the synthetic value that was replaced. This is purely a local DOM operation — it does not modify what was sent to or stored by the AI service.

### 6.4 UI Components

**Inline badge**  
A small, non-intrusive pill appended to the chat input area when DataCloak is active. Shows green dot (active, nothing detected), yellow dot (active, recent detections), red dot (blocked). Clicking opens the session panel.

**Review panel** (Review mode only)  
An overlay that appears above the input area when a prompt contains detections. Lists each detection as a row: `[CATEGORY]  •••••••[last4]  [Category label]  [Accept] [Skip]`. Accepted items are cloaked; skipped items pass through. A "Cloak all" button accepts all at once.

**Session panel** (popup or slide-in)  
Accessible by clicking the badge or the extension icon. Shows:
- Session stats: prompts sent, items cloaked, tokens in vault
- Vault table: token ID, category, original value (blurred, click to reveal), detected-at timestamp
- Rule toggles: enable/disable detection categories
- Custom patterns editor: add/remove/test custom regex patterns
- Export audit log: download session log as JSON

**Extension popup**  
The standard browser extension popup (clicked from toolbar icon). Shows active site, enabled rules, session counts, and links to settings page and GitHub.

### 6.5 Vault Isolation

The vault is stored in `chrome.storage.session` which is:
- Cleared on browser restart
- Not accessible to web page scripts (unlike localStorage)
- Scoped to the extension

Each tab maintains its own vault namespace. A vault entry created in tab A is not accessible in tab B. This prevents cross-context token reuse while keeping the same session's tokens available across multiple prompts in the same chat tab.

For users who want vault persistence across sessions, an optional encrypted persistent vault is stored in `chrome.storage.local`, encrypted with a key derived from a user-set passphrase (AES-256-GCM). The passphrase is never stored; the user is prompted once per browser session to unlock it.

### 6.6 Permissions

The extension requests only the minimum required permissions:

```json
{
  "permissions": [
    "storage",
    "clipboardRead"
  ],
  "host_permissions": [
    "https://claude.ai/*",
    "https://chat.openai.com/*",
    "https://gemini.google.com/*",
    "https://x.ai/*",
    "https://www.perplexity.ai/*",
    "https://cowork.ai/*",
    "https://chat.deepseek.com/*"
  ]
}
```

No `tabs`, no `webRequest`, no `declarativeNetRequest`, no access to any site outside the supported list. The extension cannot read browsing history, cookies, or any data from non-AI-chat pages.

### 6.7 Differentiation from Existing Extensions

| Feature | DataCloak | PiiI | Blankit | PrivacyScrubber | pii-shield-extension |
|---|---|---|---|---|---|
| Secrets / API keys | ✓ | ✗ | ✗ | partial | ✗ |
| Env var / DSN detection | ✓ | ✗ | ✗ | ✗ | ✗ |
| PII detection | ✓ | ✓ | ✓ | ✓ | ✓ |
| Entropy scanning | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Faker synthetic substitution** | **✓** | ✗ (alias tokens) | ✗ (placeholders) | ✗ (placeholders) | ✗ (anonymization) |
| Review panel (per-item) | ✓ | ✓ | ✗ | ✗ | ✗ |
| Auto-cloak mode | ✓ | ✗ | ✓ | ✓ | ✓ |
| Bidirectional vault with restore | ✓ | ✓ | partial | ✓ | ✓ |
| Response synthetic scanning | ✓ | ✗ | ✗ | ✓ | ✓ |
| Vault persistence option | ✓ | ✗ | ✗ | ✗ | ✗ |
| Custom patterns + synthesizers | ✓ | ✗ | partial | ✗ | ✗ |
| Shared engine with OpenCode | ✓ | ✗ | ✗ | ✗ | ✗ |
| Firefox support | ✓ | ✗ | ✗ | ✗ | ✗ |
| Open source | ✓ | ✓ | partial | ✗ | ✓ |

---

## 7. Shared Detection Engine Package

The detection engine is published as a standalone npm package `@datacloak/detect` that both the OpenCode plugin and the browser extension depend on.

**Package structure:**
```
@datacloak/detect
├── src/
│   ├── engine.ts           // main entry: detect(), cloak(), restore()
│   ├── patterns/
│   │   ├── secrets.ts      // API keys, tokens, private keys
│   │   ├── credentials.ts  // env vars, DSNs, connection strings
│   │   ├── pii.ts          // emails, phones, SSNs, cards, IPs
│   │   └── index.ts        // compiled pattern registry
│   ├── entropy.ts          // Shannon entropy scanner
│   ├── synthesizers/
│   │   ├── pii.ts          // Faker-based PII synthesizers
│   │   ├── secrets.ts      // Format-preserving synthetic secret generators
│   │   ├── credentials.ts  // DSN / connection string synthesizers
│   │   ├── keypair.ts      // @noble/curves throwaway keypair generator
│   │   └── index.ts        // synthesizer registry: category → synthesizer fn
│   ├── vault.ts            // in-memory bidirectional vault
│   ├── tokens.ts           // opaque token fallback (for unrecognized formats)
│   └── types.ts            // Detection, CloakResult, VaultEntry, Config
└── dist/
    ├── engine.cjs.js       // CommonJS (OpenCode plugin)
    └── engine.esm.js       // ES Module (browser extension, tree-shaken faker)
```

**Runtime dependencies:** `@faker-js/faker` (MIT), `@noble/curves` (MIT, for PEM keypair synthesis). Both are zero-native-dependency packages safe for browser bundling.

**Public API:**
```typescript
import { DataCloakEngine } from '@datacloak/detect';

const engine = new DataCloakEngine(config);

// Cloak: detects sensitive values, replaces each with a Faker-generated
// synthetic equivalent, stores synthetic→original in vault.
// Returns the synthesized text and a list of substitutions made.
const result = engine.cloak(text);
// result: {
//   text: string,              // text with synthetics in place of originals
//   substitutions: Substitution[],  // [ { original, synthetic, category } ]
// }

// Restore: scan text for known synthetic values, replace with originals.
// Used on model responses to de-synthesize before showing to user.
const restored = engine.restore(text);
// restored: { text: string, restored: number }  // count of values restored

// Dry-run: detect without synthesizing or writing to vault
const detections = engine.detect(text);
// detections: Detection[]  // [ { value, category, type, start, end, confidence } ]

// Vault access
engine.vault.list();                    // all VaultEntry records
engine.vault.getBySynthetic(synthetic); // original for a known synthetic value
engine.vault.getByOriginal(original);   // synthetic for a known original value
engine.vault.clear();
```

**Dependencies:** `@faker-js/faker` (MIT) and `@noble/curves` (MIT). The optional NER module (`@datacloak/detect-ner`) adds ONNX Runtime as a peer dependency and is installed separately.

---

## 8. Functional Requirements

### 8.1 Detection (both surfaces)

| ID | Requirement |
|---|---|
| DET-01 | Engine MUST detect all patterns listed in §4.1 with ≥95% recall on the DataCloak test corpus |
| DET-02 | Engine MUST maintain ≤5% false positive rate on a representative developer text corpus |
| DET-03 | Same input value MUST always produce the same token within a session |
| DET-04 | Detection MUST complete in <20ms for inputs ≤10KB on a 2022-era laptop |
| DET-05 | Engine MUST de-overlap matches (no partial matches within a longer match) |
| DET-06 | Engine MUST be configurable to enable/disable individual detection categories |
| DET-07 | Engine MUST support user-defined custom regex patterns with named categories |
| DET-08 | Custom patterns MUST be validated at load time; invalid patterns MUST fail loudly |
| DET-09 | Each built-in detection category MUST have a corresponding Faker synthesizer |
| DET-10 | Synthetic API keys and tokens MUST include the `SYNTH` infix to be visually identifiable in logs |
| DET-11 | Synthetic secrets MUST be structurally valid (pass format checks) but cryptographically invalid (fail authentication) |
| DET-12 | The same original value MUST always produce the same synthetic value within a session (consistency guarantee) |
| DET-13 | Synthetic values MUST be checked for collision with existing text before being accepted |
| DET-14 | For unrecognized formats, engine MUST fall back to opaque token and log the fallback |
| DET-15 | User-defined custom patterns MUST support a `synthesizer` template string using Faker API expressions |

### 8.2 OpenCode Plugin

| ID | Requirement |
|---|---|
| OC-01 | Plugin MUST register all five hooks defined in §5.2 |
| OC-02 | `tool.execute.before` MUST fail-closed: on exception, the tool call MUST be blocked |
| OC-03 | `tool.execute.after` MUST fail-closed: on exception, the full output MUST be suppressed |
| OC-04 | Plugin MUST NOT write original values to disk or to OpenCode's session log |
| OC-05 | Plugin MUST emit a startup summary listing active rule categories and vault capacity |
| OC-06 | Plugin MUST register the `/datacloak` slash command with all subcommands in §5.4 |
| OC-07 | Plugin MUST load config from all three config locations in priority order (§5.3) |
| OC-08 | Plugin MUST support zero-config operation with safe defaults |
| OC-09 | Plugin MUST be compatible with `@opencode-ai/plugin` SDK ≥1.15.0 |

### 8.3 Browser Extension

| ID | Requirement |
|---|---|
| BR-01 | Extension MUST intercept prompts before submission on all supported sites |
| BR-02 | Extension MUST NOT block or delay submission when no detections are found |
| BR-03 | Extension MUST store vault in `chrome.storage.session` (cleared on browser restart) |
| BR-04 | Extension MUST NOT request host permissions beyond the supported site list |
| BR-05 | Extension MUST support both auto-cloak and review modes, user-selectable |
| BR-06 | Extension MUST work with no network connection (fully offline operation) |
| BR-07 | Extension MUST be compatible with Chrome MV3, Edge MV3, and Firefox MV3 |
| BR-08 | Extension MUST NOT log prompt text or original values to `console` in production builds |
| BR-09 | Vault viewer in popup MUST blur original values by default (reveal on click) |
| BR-10 | Audit log export MUST be available as a local JSON download; MUST NOT be sent to any server |

---

## 9. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | Detection <20ms for ≤10KB; vault lookup O(1); no blocking of OpenCode's main event loop |
| **Security** | Vault never written to disk in default mode; no original values in logs or console output; tokens are non-deterministic across sessions |
| **Privacy** | Zero telemetry by default; no network calls from either surface except to the AI provider the user is already using |
| **Reliability** | Both hooks and content scripts fail-closed: a DataCloak error MUST NOT crash OpenCode or break a chat interface (fail-closed for tool hooks; fail-open for prompt hooks with logged warning) |
| **Compatibility** | OpenCode plugin: Node.js ≥18, OpenCode ≥1.14; Browser extension: Chrome ≥120, Edge ≥120, Firefox ≥121 |
| **Bundle size** | Browser extension: detection engine + tree-shaken Faker ≤250KB uncompressed; full extension ≤600KB |
| **Accessibility** | Extension popup and review panel MUST meet WCAG 2.1 AA |
| **Internationalization** | UI strings externalized; English only in v1.0; i18n-ready structure |
| **Auditability** | Session log available as structured JSON export; every redaction recorded with timestamp, category, token, and confidence |

---

## 10. Technical Architecture

### 10.1 Repository Structure

```
datacloak/
├── packages/
│   ├── detect/              @datacloak/detect — shared detection engine
│   ├── opencode-plugin/     @datacloak/opencode-plugin
│   └── browser-extension/   @datacloak/browser-extension
├── apps/
│   └── demo/                The DataCloak web demo (the HTML artifact built in session)
├── tools/
│   ├── corpus/              Test corpus: real-world samples with ground truth
│   └── bench/               Performance benchmarks
├── docs/
│   ├── patterns.md          Pattern documentation and test cases
│   ├── configuration.md
│   └── threat-model.md
└── CONTRIBUTING.md
```

**Build:** pnpm workspaces + Turborepo. TypeScript throughout. Biome for linting and formatting.

### 10.2 Detection Engine Build

The `@datacloak/detect` package is built with `tsup`, producing:
- `dist/engine.cjs.js` — CommonJS for OpenCode plugin (Node.js)
- `dist/engine.esm.js` — ES Module for browser extension (bundled with Rollup)
- `dist/engine.d.ts` — TypeScript declarations

No dynamic imports. No `eval`. Content-Security-Policy safe.

### 10.3 Browser Extension Build

Built with Vite + CRXJS (for Chrome) and web-ext (for Firefox). Single build produces outputs for both targets. The shared `@datacloak/detect` package is bundled inline — no CDN fetches at runtime.

---

## 11. Threat Model and Limitations

**What DataCloak protects against:**
- Accidental exposure of secrets typed or pasted into AI agent prompts
- AI agents reading sensitive files and passing content to the model provider
- Tool output (file reads, bash stdout, MCP results) containing credentials flowing into model context
- Browser users inadvertently submitting PII to hosted AI chat services

**What DataCloak does NOT protect against:**
- A network call made by a shell command (`curl`, `aws`, etc.) that exfiltrates secrets out-of-band
- A compromised AI provider that stores or leaks model inputs after receiving them
- Prompt injection attacks that instruct the model to request the vault's contents (the vault is not accessible to the model)
- A malicious OpenCode plugin loaded alongside DataCloak that captures prompts at a different hook position
- Physical access to the machine
- An OS-level keylogger or memory reader

These limitations are documented explicitly in `docs/threat-model.md` and shown in a summary in the startup banner.

---

## 12. Phased Roadmap

### Phase 1 — Core (v0.1, target: 8 weeks)
- `@datacloak/detect` package with secrets + credentials + PII detection
- Faker synthesizer library: all built-in categories covered, `SYNTH`-infixed secret formats, DSN template engine, PEM keypair pool
- OpenCode plugin: all 5 hooks, `/datacloak` slash command, JSON config including custom synthesizer templates
- Browser extension: Chrome/Edge MV3, auto-cloak mode, session vault, response synthetic scanning, popup
- Demo web app updated with Faker synthesis mode (already built as opaque token version)
- Test corpus with ≥500 labeled samples: ≥95% detection recall, synthesis correctness verified per category
- MIT license, public GitHub repo, npm publish (`@datacloak/detect`, `@datacloak/opencode-plugin`)

### Phase 2 — Quality and Firefox (v0.2, target: 4 weeks post v0.1)
- Firefox MV3 support (using WebExtensions polyfill)
- Review mode in browser extension (per-item accept/skip panel)
- Encrypted vault persistence option (both surfaces)
- Audit log export (JSON)
- False-positive suppression improvements (base64 image data, UUIDs, hashes in git commits)
- Expanded pattern library: 20+ additional service-specific API key formats

### Phase 3 — NER and Advanced Patterns (v0.3, target: 6 weeks post v0.2)
- Optional `@datacloak/detect-ner` package (ONNX Runtime, ~150MB, opt-in install)
- Person name detection (NER-based)
- Address detection (US/UK/DE)
- Date-of-birth detection with co-location context
- Structured data support: detect PII in JSON/CSV content passed to tools
- Claude Code integration (parallel to OpenCode; uses OpenCode plugin as reference)

### Phase 4 — Teams and CI/CD (v1.0, target: 3 months post v0.3)
- CLI mode: `datacloak scan <file>` for pre-commit hooks and CI pipelines
- Shared team config via `.datacloak.json` committed to repo (patterns only, never vault)
- VS Code extension (sidebar vault viewer + status bar indicator)
- Integration guide for LiteLLM proxy deployment
- Community pattern registry: curated contributed patterns, reviewed before merge

---

## 13. Open Questions

1. **~~Token format collision~~** *(resolved)*: DataCloak uses Faker-generated synthetic values as the primary substitution strategy. Opaque tokens (`[CATEGORY_XXXXXXX]`) are retained only as a fallback for custom patterns without a synthesizer. This decision is final for v0.1.

2. **Synthetic value detectability by the model**: There is a small risk that a well-calibrated model notices that certain values are suspiciously "stock" (e.g., `faker.internet.email()` tends to produce predictable-looking domains). Should we add more entropy to synthetic values (random TLDs, mixed-case names, numeric suffixes) to make them less uniform? Or is this a non-issue in practice?

3. **Faker locale for non-English codebases**: Faker defaults to `en` locale (US conventions). A developer working in German will have German-language comments, and a synthetic name like `John Smith` alongside German text may look odd. Should locale auto-detect from the system locale, or should it always default to `en` for consistency and let users override?

4. **Multi-occurrence consistency across turns**: Within a single session, the same original always maps to the same synthetic. But if a developer clears the vault and reuses a project, a new session will generate a different synthetic for the same original. This is intentional (fresh session = fresh synthetics) but could be surprising in long-lived projects. Should vault persistence be on by default for project-level vaults?

5. **PEM keypair synthesis cost**: Generating a throwaway RSA-2048 keypair takes ~2ms. For most prompts this is fine, but if a file contains 20 PEM blocks, that's 40ms of synthesis. Should we pre-generate a pool of 10 throwaway keypairs at startup (amortized to ~0ms per use) or generate on demand?

6. **NER dependency size**: The ONNX model for name/address detection is ~150MB. Is that acceptable as an opt-in install for v0.3, or should we explore a smaller distilled model (<20MB) at the cost of recall?

7. **Claude Code surface**: Claude Code uses a different plugin API than OpenCode. Should Claude Code support be in Phase 3 as a separate package, or should we abstract a common hook interface that both plugins implement?

8. **Persistent vault UX**: Encrypted vault persistence requires a passphrase or OS keychain. What is the right UX for passphrase entry in the OpenCode TUI vs the browser extension popup? Should we use the OS keychain exclusively (Keytar) and avoid a user-facing passphrase entirely?

9. **Pattern registry governance**: If we open a community pattern registry, who reviews contributed patterns and synthesizers for false-positive rate and safety? Should contributed patterns be sandboxed (regex-only, no lookaheads above a complexity threshold) to prevent ReDoS?

10. **MCP proxy mode**: A future architecture option is running DataCloak as a local MCP proxy server (like hoop.dev but lighter-weight) that any MCP client can point to, synthesizing PII in MCP tool results before they reach the agent. Is this in scope for v1.0 or a separate project?

---

## 14. Success Metrics

| Metric | Target |
|---|---|
| Detection recall on test corpus | ≥95% |
| False positive rate on developer text | ≤5% |
| Prompt interception latency (p99) | <20ms for ≤10KB |
| OpenCode plugin startup time overhead | <100ms |
| Browser extension bundle size | <500KB |
| GitHub stars at 3 months | 500+ |
| npm weekly downloads at 3 months | 1,000+ |
| Community-contributed patterns at 6 months | 20+ |
| Known false-negative incidents reported | 0 critical (secrets bypassing detection) |

---

## Appendix A — Key References

- [opencode-security-guard](https://github.com/marioalexandreantunes/opencode-security-guard) — most complete existing OpenCode secret guard; DataCloak extends with PII and bidirectional vault
- [jscheel/opencode-secrets-protect](https://github.com/jscheel/opencode-secrets-protect) — output-only secrets detection
- [SteamedFish/opencode-guard](https://github.com/SteamedFish/opencode-guard) — format-preserving masking; useful reference for vault design
- [JaySmith502/PiiI](https://github.com/JaySmith502/PiiI) — best existing OSS browser extension for PII; DataCloak adds secrets and shared engine
- [kaispriestersbach/pii-shield-extension](https://github.com/kaispriestersbach/pii-shield-extension) — good reference for MV3 architecture and reversible anonymization modes
- [data-privacy-stack/presidio](https://github.com/data-privacy-stack/presidio) — gold standard for PII detection; DataCloak's NER phase will use Presidio's recognizer patterns as a reference, not as a runtime dependency
- [GrowthSpace MCP proxy](https://medium.com/growthspace-internals/redacting-with-confidence-building-a-generic-privacy-first-mcp-proxy-for-ai-agents-075a8d9b5d1d) — architecture reference for MCP-layer redaction
- [hoop.dev](https://hoop.dev) — reference for gateway-layer redaction; DataCloak targets a lighter-weight local deployment model
- OWASP Top 10 for LLM Applications 2025 — LLM01 Sensitive Information Disclosure
- Truto: [PII Redaction for MCP](https://truto.one/blog/how-to-implement-pii-redaction-when-passing-saas-data-to-llms-via-mcp/) — architecture guidance

---

*DataCloak is an open-source project. Contributions, issue reports, and pattern submissions are welcome. Nothing in this PRD constitutes a legal compliance guarantee.*
