Copy this dir's contents into your project's `.gemini/` dir (`cp adapters/gemini/* .gemini/`).
Trust/allow `.gemini/guard.sh` when Gemini prompts — it only pipes prompts/tool calls to `datacloak guard`.
Set `DATACLOAK_VAULT` per session to share one vault file across prompts and tool calls.
