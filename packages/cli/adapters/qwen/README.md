Copy this dir's contents into your project's `.qwen/` dir (`cp adapters/qwen/* .qwen/`).
Trust/allow `.qwen/guard.sh` when Qwen prompts — it only pipes prompts/tool calls to `datacloak guard`.
Set `DATACLOAK_VAULT` per session to share one vault file across prompts and tool calls.
