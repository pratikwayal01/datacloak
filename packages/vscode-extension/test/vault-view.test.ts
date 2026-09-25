// packages/vscode-extension/test/vault-view.test.ts
import { describe, expect, it, vi } from 'vitest';
import { DataCloakEngine } from '@pratikw/detect';
import { VaultViewProvider, revealOriginal } from '../src/vault-view.js';
import * as vs from 'vscode';

describe('vault view', () => {
  it('rows mirror engine vault with blurred originals', async () => {
    const e = new DataCloakEngine();
    e.cloak('john.doe@acme.com key sk-abcdefghij1234567890');
    const p = new VaultViewProvider(e);
    const rows = await p.getChildren();
    expect(rows.length).toBe(2);
    expect(rows[0].description).not.toContain('john.doe@acme.com');
    expect(rows[0].tooltip).toContain('click to reveal');
  });
  it('reveal writes to output channel, never edits', async () => {
    const e = new DataCloakEngine();
    const c = e.cloak('john.doe@acme.com');
    const lines: string[] = [];
    const channel = { appendLine: (s: string) => { lines.push(s); }, show: () => {} };
    await revealOriginal(e, c.substitutions[0].synthetic, { appendLine: channel.appendLine, show: channel.show } as never);
    expect(lines.join('\n')).toContain('john.doe@acme.com');
  });
  it('empty vault shows placeholder', async () => {
    const rows = await new VaultViewProvider(new DataCloakEngine()).getChildren();
    expect(rows.length).toBe(1);
    expect(rows[0].label).toMatch(/empty/i);
  });
});
