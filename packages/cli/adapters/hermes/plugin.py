"""Hermes datacloak adapter: every check shells out to `datacloak` from PATH."""
import json
import subprocess


def _guard(payload):
    try:
        r = subprocess.run(['datacloak', 'guard'], input=json.dumps(payload),
                           capture_output=True, text=True, timeout=10)
        return json.loads(r.stdout or '{"decision": "allow"}')
    except Exception:
        return {'decision': 'allow'}  # ponytail: fail-open, never break the agent


def _cloak(text, vault=None):
    if not isinstance(text, str):
        return text  # ponytail: non-string results pass through unchanged
    try:
        import os
        env = dict(os.environ)
        if vault:
            env['DATACLOAK_VAULT'] = vault
        r = subprocess.run(['datacloak', 'cloak'], input=text,
                           capture_output=True, text=True, timeout=10, env=env)
        return r.stdout if r.returncode == 0 else text
    except Exception:
        return text  # ponytail: fail-open, never break the agent


def register(ctx):
    ctx.register_hook('pre_llm_call', lambda user_message, **k:
                      {'context': '[datacloak] prompt contains a possible secret; do not repeat it'}
                      if _guard({'event': 'prompt', 'text': user_message}).get('decision') == 'deny' else None)
    def pre_tool(tool_name, args, **k):
        d = _guard({'event': 'tool', 'tool': tool_name, 'args': args})
        if d.get('decision') == 'deny':
            return {'action': 'block', 'message': d.get('reason', 'denied by datacloak')}
        if d.get('decision') == 'rewrite':
            return {'action': 'modify', 'args': d.get('args', args)}
        return None
    ctx.register_hook('pre_tool_call', pre_tool)
    ctx.register_hook('transform_tool_result', lambda tool_name, args, result, **k: _cloak(result))
