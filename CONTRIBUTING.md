# Contributing to DataCloak

## Setup

```bash
npm ci
npm test --workspaces   # detect 82 + extension 160 must pass
```

Docs site: `mkdocs build --strict` must pass with zero warnings.

## What to change

- Detector patterns/synthesizers: `packages/detect/src/`
- Extension UI/background: `packages/browser-extension/src/`
- New files need tests next to them (`test/` in each package, vitest).

## Rules

- Minimum viable diff. Match existing style, even if suboptimal.
- No new dependencies without asking in the PR first.
- `*.zip` build artifacts are gitignored — never commit them.
- Release train is manual (Actions → `publish` → Run workflow); don't
  push version tags from feature branches.

## Pull requests

Fill in `.github/pull_request_template.md`: what changed, how verified
(tests, `tsc --noEmit`, `mkdocs build --strict` where relevant).
One concern per PR; keep it small enough to review in one sitting.
