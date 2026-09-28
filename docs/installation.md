# Installation

## Library (npm)

```bash
curl -fsSL https://raw.githubusercontent.com/pratikwayal01/datacloak/master/install.sh | bash
# or: npm install -g @pratikw/detect
```

Needs node ≥ 18. If the global prefix isn't writable the installer falls
back to `~/.local` automatically (no sudo needed).

## From source

```bash
git clone https://github.com/pratikwayal01/datacloak.git && cd datacloak
npm install
npm run build --workspace packages/detect
npm test --workspace packages/detect
```

## Browser extension (unpacked, Chrome/Edge)

Prebuilt (recommended): download `datacloak-extension-<version>.zip` from
[releases](https://github.com/pratikwayal01/datacloak/releases), unzip,
then load the folder below.

From source:

```bash
npm install
npm run build --workspace packages/browser-extension
```

Open `chrome://extensions` → **Developer mode** → **Load unpacked** →
select `packages/browser-extension`. Covers claude.ai, ChatGPT, Gemini,
Grok, Perplexity, Cowork, DeepSeek. Firefox 109+: `about:debugging` →
Load Temporary Add-on (MV3-compatible: gecko ID, background-scripts
fallback).

## Coding agents

One binary + per-agent adapters — full matrix in [Coding Agents](harnesses.md).
Fastest backstop for any terminal:

```bash
eval "$(datacloak install-shell --shell bash)"  # bash/zsh/fish
```
