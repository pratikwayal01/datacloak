import { describe, expect, it, vi } from 'vitest';
import { DataCloakEngine } from '@pratikw/detect';
import { cloakSelection, restoreSelection } from '../src/commands.js';
import * as vs from 'vscode';

const editor = (text: string, empty = false) => {
  let value = text;
  return {
    state: () => value,
    document: { getText: (_r?: unknown) => value },
    selection: { isEmpty: empty },
    edit: (fn: (b: { replace: (_r: unknown, t: string) => void }) => void) => {
      fn({ replace: (_r: unknown, t: string) => { value = t; } });
      return Promise.resolve(true);
    },
  };
};

describe('commands', () => {
  it('cloak replaces selection and returns count', async () => {
    const e = new DataCloakEngine();
    const ed = editor('mail john.doe@acme.com');
    expect(await cloakSelection(e, ed as never, vs as never)).toBe(1);
    expect(ed.state()).not.toContain('john.doe@acme.com');
  });
  it('restore round-trips', async () => {
    const e = new DataCloakEngine();
    const ed = editor('mail john.doe@acme.com');
    await cloakSelection(e, ed as never, vs as never);
    const n = await restoreSelection(e, ed as never, vs as never);
    expect(n).toBe(1);
    expect(ed.state()).toContain('john.doe@acme.com');
  });
  it('empty selection shows info, changes nothing', async () => {
    const e = new DataCloakEngine();
    const ed = editor('clean', true);
    const info = vi.spyOn(vs.window, 'showInformationMessage');
    expect(await cloakSelection(e, ed as never, vs as never)).toBe(0);
    expect(ed.state()).toBe('clean');
    expect(info).toHaveBeenCalled();
  });
});
