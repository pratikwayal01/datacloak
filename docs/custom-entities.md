# Custom entity mapping

Teach DataCloak your own secrets: employee IDs, project codes, ticket
numbers, internal hostnames. Three levels, pick one.

## 1. Library: `customPatterns`

```ts
import { DataCloakEngine } from '@pratikw/detect';

const cloak = new DataCloakEngine({
  customPatterns: [
    { name: 'Employee ID', pattern: 'EMP-[0-9]{6}', category: 'EMPLOYEE_ID', type: 'pii' },
    { name: 'Project code', pattern: 'PROJ-[A-Z]{3}-[0-9]{3}', category: 'PROJECT_CODE', type: 'secret' },
  ],
});

cloak.cloak('owner EMP-482913 on PROJ-ABC-123');
// → 'owner EMP-710294 on PROJ-XQZ-041'  (same shape, fake values)
```

Patterns are validated at load (invalid regex throws loudly). Without a
`synthesizer`, matches fall back to opaque `[CATEGORY_XXXXXX]` tokens; with
one, you get realistic fakes that keep their shape.

### Synthesizer expressions

A template is literal text plus `{{expression}}` placeholders:

| Expression | Output |
|---|---|
| `{{string.numeric(n)}}` | n digits, e.g. `{{string.numeric(6)}}` |
| `{{string.alphanumeric(n)}}` | n letters+digits |
| `{{number.int(min, max)}}` | integer in range |
| `{{person.firstName()}}` / `{{person.lastName()}}` | realistic names |

Unknown expressions fail open: the value is cloaked with an opaque token
and a warning goes to stderr. Templates honor the engine `locale`.

## 2. OpenCode plugin: `datacloak.json`

```jsonc
// .opencode/datacloak.json
{
  "customPatterns": [
    { "name": "Employee ID", "pattern": "EMP-[0-9]{6}",
      "category": "EMPLOYEE_ID", "type": "pii" }
  ]
}
```

Cloak, block, redact and restore all honor them automatically — no restart
needed beyond OpenCode's config reload.

## 3. CLI: `--config`

```bash
datacloak cloak --config ./datacloak.json < prompt.txt
datacloak scan --config ./datacloak.json < prompt.txt || echo "secrets found"
```

Same file shape as above. Hooks (`guard`) read `DATACLOAK_CONFIG` or
`./datacloak.json` in the project root, so adapters pick your entities up
with zero extra flags.
