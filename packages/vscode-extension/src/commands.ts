import type { DataCloakEngine } from '@pratikw/detect';
import * as vscode from 'vscode';

interface Editorish {
  document: { getText(range?: unknown): string };
  selection: { isEmpty: boolean };
  edit(fn: (b: { replace(range: unknown, text: string): void }) => void): Promise<boolean>;
}

export async function cloakSelection(engine: DataCloakEngine, editor: Editorish, vs: typeof vscode): Promise<number> {
  if (editor.selection.isEmpty) {
    await vs.window.showInformationMessage('DataCloak: select text first');
    return 0;
  }
  const r = engine.cloak(editor.document.getText(editor.selection));
  await editor.edit((b) => b.replace(editor.selection, r.text));
  return r.substitutions.length;
}

export async function restoreSelection(engine: DataCloakEngine, editor: Editorish, _vs: typeof vscode): Promise<number> {
  if (editor.selection.isEmpty) return 0;
  const r = engine.restore(editor.document.getText(editor.selection));
  if (r.restored > 0) await editor.edit((b) => b.replace(editor.selection, r.text));
  return r.restored;
}
