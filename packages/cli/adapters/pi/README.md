# datacloak + pi (`~/.pi/agent`)

1. Copy `guard.sh` + `observe.sh` to the hook dir — global `~/.pi/agent/hook/`
   (all projects) or project `<root>/.pi/hook/` (this repo only) — and `chmod +x` both.
2. Copy `hooks.yaml` entries into your pi hooks config, adjusting the `bash:` paths
   to wherever you put the scripts.
3. Trust the hooks: run `/hooks-trust` in pi, or set `PI_YAML_HOOKS_TRUST_PROJECT=1`.
4. Both shims call `datacloak` from PATH. Set `DATACLOAK_VAULT` if you share one
   vault file across sessions.

Limitations: `user.prompt.submit` output is prompt context-only (cannot block);
`tool.after` observe is observe-only — it notes a possible secret but always exits 0.
