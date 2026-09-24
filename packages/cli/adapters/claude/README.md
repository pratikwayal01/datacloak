Copy this dir's contents into your project's `.claude/` dir (`cp adapters/claude/* .claude/`).
Trust/allow `.claude/guard.sh` when Claude Code prompts — it only pipes prompts/tool calls to `datacloak guard`.
Set `DATACLOAK_VAULT` per session to share one vault file across prompts and tool calls.
