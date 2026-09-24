import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../adapters/', import.meta.url).pathname;
const read = (p: string) => readFileSync(ROOT + p, 'utf8');

// collect every hook command string from a parsed hooks/settings JSON
const commands = (j: any): string[] => {
  const out: string[] = [];
  const walk = (v: any) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      if (typeof (v as any).command === 'string') out.push((v as any).command);
      Object.values(v).forEach(walk);
    }
  };
  walk(j?.hooks ?? j);
  return out;
};

const CASES: Record<string, string[]> = {
  'claude/settings.json': ['UserPromptSubmit', 'PreToolUse'],
  'codex/hooks.json': ['UserPromptSubmit', 'PreToolUse'],
  'gemini/settings.json': ['BeforeAgent', 'BeforeTool'],
  'qwen/settings.json': ['UserPromptSubmit', 'PreToolUse'],
};

describe('adapters-a', () => {
  for (const [file, events] of Object.entries(CASES)) {
    it(`${file} parses with events and guard.sh hook commands`, () => {
      const raw = read(file);
      const j = JSON.parse(raw);
      expect(j.hooks).toBeDefined();
      for (const e of events) expect(JSON.stringify(raw)).toContain(e);
      const cmds = commands(j);
      expect(cmds.length).toBeGreaterThan(0);
      for (const c of cmds) expect(c.endsWith('guard.sh')).toBe(true);
    });
  }
  for (const h of ['claude', 'codex', 'gemini', 'qwen']) {
    it(`${h}/guard.sh passes bash -n and calls datacloak from PATH`, () => {
      const p = ROOT + `${h}/guard.sh`;
      execFileSync('bash', ['-n', p]);
      const s = read(`${h}/guard.sh`);
      expect(s).toContain('datacloak guard');
      expect(s).not.toMatch(/\/[a-z]+\/datacloak/);
    });
    it(`${h}/README.md mentions vault env`, () => {
      expect(read(`${h}/README.md`)).toContain('DATACLOAK_VAULT');
    });
  }
  it('guard.sh shims are identical across harnesses', () => {
    const shims = ['claude', 'codex', 'gemini', 'qwen'].map((h) => read(`${h}/guard.sh`));
    for (const s of shims) expect(s).toBe(shims[0]);
  });
});
