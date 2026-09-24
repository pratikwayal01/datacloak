# datacloak + aider (shell-wrapper only)

Aider has no hook API, so policy lives in git-layer wrappers:

1. Copy `pre-commit` to `.git/hooks/pre-commit` (or wire via `pre-commit` config).
2. The hook pipes staged content through `datacloak scan` (from PATH); exit 2 blocks the commit.
3. Set `DATACLOAK_VAULT` if you share one vault file across sessions.
4. Optional `.aider.conf.yml` feedback loop: `test-cmd: pre-commit run --files {files}`.
