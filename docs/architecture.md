# Architecture & how it works

![DataCloak flow: you → surfaces → detection engine → Faker vault → AI model, restore on return](architecture.svg)

## The loop in 30 seconds

1. **You** type or paste something containing secrets into an AI surface —
   an OpenCode prompt, a browser chat box, a terminal agent.
2. **The surface adapter** intercepts the text *before* it leaves your
   machine (OpenCode hook, content-script rewrite, CLI pipe, harness hook).
3. **The detection engine** runs two passes: a compiled regex registry
   (~40 patterns: API keys, JWTs, PEMs, env vars, DSNs, emails, phones,
   IPs) with longest-match de-overlap, then a Shannon-entropy sweep for
   unknown random tokens. The opt-in NER layer adds names, addresses and
   gated DOB.
4. **The Faker vault** substitutes every hit with a structurally identical
   synthetic (same shape, same meaning, zero real data) and remembers the
   bidirectional mapping. The same original always maps to the same
   synthetic within a session.
5. **The AI model** reasons over realistic fakes and never sees your data.
6. **On return**, responses are scanned for known synthetics and the
   originals are swapped back — locally, before you read them.

## Why fakes instead of `[REDACTED]`

Opaque tokens break the model's reasoning (`"my DB URL is [X], why
timeout?"` gives it nothing to work with). A structurally real synthetic
lets it reason about host, port, format and validity exactly as with the
real value. Synthetic secrets carry a `SYNTH` infix: valid shape, invalid
auth — identifiable in logs, useless to attackers.

## What it does NOT do

- Cannot stop a shell command (`curl`, `aws`) exfiltrating secrets out-of-band.
- Cannot protect against a compromised provider, plugin, or machine.
- Your local session files still contain what you typed — the boundary
  guarded is provider-bound traffic, not your disk.
- Weak human passwords (`ramesh@123`) are indistinguishable from ordinary
  words — no detector catches those without drowning you in false
  positives. High-entropy and patterned secrets are the target.

See the [privacy policy](privacy.md) for data handling, and
[packages](packages.md) for what's inside each surface.
