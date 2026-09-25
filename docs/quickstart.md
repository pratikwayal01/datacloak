# Quick Start

## 1. Cloak a prompt

```js
import { DataCloakEngine } from '@pratikw/detect';

const cloak = new DataCloakEngine();
const out = cloak.cloak(
  'DATABASE_URL=postgres://alice:s3cr3t@db.prod.acme.com:5432/users'
);
// → 'DATABASE_URL=postgres://Kaelyn_Torp80:SYNTHpw53@hefty-curl.com:5432/users'
```

Key name preserved, protocol/port/path intact, secrets faked.

## 2. Restore the reply

```js
const back = cloak.restore(modelReply);
// → { text: '...db.prod.acme.com...', restored: 2 }
```

## 3. From the shell

```bash
echo 'key sk-abcdefghij1234567890' | datacloak cloak
datacloak scan < prompt.txt || echo "secrets found"
```

## 4. Guardrails that hold every call

- Same original → same synthetic within a session
- Synthetic secrets carry a `SYNTH` infix (valid shape, invalid auth)
- Unknown formats fall back to opaque `[CATEGORY_XXXXXX]` tokens
- Custom regex patterns with loud load-time validation
- Vault is in-memory (library) or 600-perm file (CLI) — never leaves disk
