# Configuration

## `datacloak.json` (OpenCode plugin)

Four levels, first wins: `DATACLOAK_*` env → `<project>/.opencode/datacloak.json`
→ `~/.config/datacloak/config.json` → built-in defaults.

```jsonc
{
  "enabled": true,
  "mode": "warn",               // "warn" | "block" | "allow"
  "detection": {
    "secrets": true,
    "envVars": true,
    "pii": true,
    "entropy": true,
    "entropyThreshold": 4.5,
    "nerNames": false
  },
  "allowPaths": [".env.example", "fixtures/**"],
  "blockPaths": [".env", ".env.local", "**/*.pem", "~/.ssh/**"],
  "customPatterns": [
    { "name": "Employee ID", "pattern": "EMP-[0-9]{6}",
      "category": "EMPLOYEE_ID", "type": "pii" }
  ],
  "vault": { "maxEntries": 2000 }
}
```

Env overrides: `DATACLOAK_ENABLED`, `DATACLOAK_MODE`,
`DATACLOAK_ENTROPY_THRESHOLD`, `DATACLOAK_MAX_ENTRIES`.

## CLI vault

`--vault PATH`, or `$DATACLOAK_VAULT`, or
`~/.config/datacloak/vault-<DATACLOAK_SESSION|default>.json`.
Export one `DATACLOAK_VAULT` per shell session to share cloak/restore state
across prompts, hooks and tool calls. Files are chmod 600; session-scoped.

## `DATACLOAK_OFF=1`

Escape hatch: disables shell-preexec scanning for one session when you need
raw control.
