import { describe, expect, it, vi, beforeEach } from 'vitest';
import { activate } from '../src/extension.js';
import { VaultViewProvider } from '../src/vault-view.js';
import * as vs from 'vscode';

const ctx = () => ({ subscriptions: [] as { dispose(): void }[] });

const fakeEditor = (text: string) => {
  let value = text;
  const selection = { start: 0, end: text.length, isEmpty: false };
  return {
    state: () => value,
    document: { getText: () => value },
    selection,
    edit: (fn: (b: { replace: (r: unknown, t: string) => void }) => void) => {
      fn({ replace: (_r: unknown, t: string) => { value = t; } });
      return Promise.resolve(true);
    },
  };
};

describe('extension wrap', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('no activeTextEditor: no crash, no refresh', async () => {
    (vs.window as unknown as { activeTextEditor: unknown }).activeTextEditor = undefined;
    const refresh = vi.spyOn(VaultViewProvider.prototype, 'refresh');
    const handlers = new Map<string, () => Promise<void>>();
    vi.spyOn(vs.commands, 'registerCommand').mockImplementation(((c: string, f: () => Promise<void>) => {
      handlers.set(c, f);
      return { dispose: () => {} };
    }) as never);
    activate(ctx() as never);
    await expect(handlers.get('datacloak.cloakSelection')!()).resolves.toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('with editor: count bumps (status bar), provider refresh called', async () => {
    const bar = { text: '', show: vi.fn(), dispose: () => {} };
    vi.spyOn(vs.window, 'createStatusBarItem').mockReturnValue(bar as never);
    (vs.window as unknown as { activeTextEditor: unknown }).activeTextEditor = fakeEditor('call john.doe@acme.com');
    const refresh = vi.spyOn(VaultViewProvider.prototype, 'refresh');
    const handlers = new Map<string, () => Promise<void>>();
    vi.spyOn(vs.commands, 'registerCommand').mockImplementation(((c: string, f: () => Promise<void>) => {
      handlers.set(c, f);
      return { dispose: () => {} };
    }) as never);
    activate(ctx() as never);
    expect(bar.text).toContain('0 cloaked');
    await handlers.get('datacloak.cloakSelection')!();
    expect(bar.text).toContain('1 cloaked');
    expect(refresh).toHaveBeenCalled();
  });

  it('refresh notifies onDidChangeTreeData listeners (mock EventEmitter fidelity)', async () => {
    const { DataCloakEngine } = await import('@pratikw/detect');
    const p = new VaultViewProvider(new DataCloakEngine());
    const seen: void[] = [];
    p.onDidChangeTreeData(() => { seen.push(undefined); });
    p.refresh();
    expect(seen.length).toBe(1);
  });
});
