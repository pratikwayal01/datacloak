import { describe, expect, it, vi } from 'vitest';
import { DataCloakEngine } from '@pratikw/detect';
import { cloakSelection, restoreSelection } from '../src/commands.js';
import * as vs from 'vscode';

interface Range { start: number; end: number; isEmpty: boolean; }

// Faithful mock: document honors {start,end} offset ranges, edit splices them.
const editor = (text: string, sel?: { start: number; end: number }) => {
  let value = text;
  const selection: Range = sel
    ? { ...sel, isEmpty: sel.start === sel.end }
    : { start: 0, end: 0, isEmpty: true };
  const slice = (r?: unknown) => {
    const o = r as Partial<Range> | undefined;
    if (o && typeof o.start === 'number' && typeof o.end === 'number') return value.slice(o.start, o.end);
    return value;
  };
  return {
    state: () => value,
    document: { getText: (r?: unknown) => slice(r) },
    selection,
    edit: (fn: (b: { replace: (r: unknown, t: string) => void }) => void) => {
      fn({ replace: (r: unknown, t: string) => {
        const o = r as Partial<Range> | undefined;
        if (o && typeof o.start === 'number' && typeof o.end === 'number') {
          value = value.slice(0, o.start) + t + value.slice(o.end);
        } else {
          value = t;
        }
      } });
      return Promise.resolve(true);
    },
  };
};

// 'mail john.doe@acme.com': canary starts at offset 5
const CANARY = { start: 5, end: 22 };

describe('commands', () => {
  it('cloak replaces selection and returns count', async () => {
    const e = new DataCloakEngine();
    const ed = editor('mail john.doe@acme.com', CANARY);
    expect(await cloakSelection(e, ed as never, vs as never)).toBe(1);
    expect(ed.state()).not.toContain('john.doe@acme.com');
    expect(ed.state().startsWith('mail ')).toBe(true);
  });
  it('restore round-trips', async () => {
    const e = new DataCloakEngine();
    const ed = editor('mail john.doe@acme.com', CANARY);
    await cloakSelection(e, ed as never, vs as never);
    ed.selection.end = ed.state().length; // re-select cloaked region (length changed)
    const n = await restoreSelection(e, ed as never, vs as never);
    expect(n).toBe(1);
    expect(ed.state()).toContain('john.doe@acme.com');
  });
  it('scopes to selection, leaves rest of doc intact', async () => {
    const e = new DataCloakEngine();
    const ed = editor('mail john.doe@acme.com tail', CANARY);
    await cloakSelection(e, ed as never, vs as never);
    expect(ed.state().endsWith(' tail')).toBe(true);
  });
  it('empty selection shows info, changes nothing', async () => {
    const e = new DataCloakEngine();
    const ed = editor('clean');
    const info = vi.spyOn(vs.window, 'showInformationMessage');
    expect(await cloakSelection(e, ed as never, vs as never)).toBe(0);
    expect(ed.state()).toBe('clean');
    expect(info).toHaveBeenCalled();
  });
});
