import { DataCloakEngine } from '@pratikw/detect';
import * as vscode from 'vscode';
import { cloakSelection, restoreSelection } from './commands.js';
import { VaultViewProvider, revealOriginal } from './vault-view.js';

export function activate(context: { subscriptions: { dispose(): void }[] }): void {
  const engine = new DataCloakEngine();
  let cloaked = 0;
  const status = { text: '', show: () => {}, dispose: () => {} };
  const bar = (vscode.window as unknown as { createStatusBarItem(a: number): typeof status }).createStatusBarItem(vscode.StatusBarAlignment.Left);
  const paint = () => { bar.text = `$(shield) DataCloak: ${cloaked} cloaked`; bar.show(); };
  const channel = vscode.window.createOutputChannel('DataCloak');
  const provider = new VaultViewProvider(engine);
  const ed = () => vscode.window.activeTextEditor;
  const wrap = (fn: (e: DataCloakEngine, ed: never, v: never) => Promise<number>) => async () => {
    const editor = ed();
    if (!editor) return;
    const typed = editor as unknown as {
      document: unknown;
      selection: unknown;
      edit(f: (b: { replace(r: unknown, t: string): void }) => void): Promise<boolean>;
    };
    const adapted = { document: typed.document, selection: typed.selection, edit: typed.edit.bind(typed) };
    cloaked += await fn(engine, adapted as never, vscode as never);
    paint();
    provider.refresh();
  };
  context.subscriptions.push(
    (vscode.commands as unknown as { registerCommand(c: string, f: () => void): { dispose(): void } }).registerCommand('datacloak.cloakSelection', wrap(cloakSelection)),
    (vscode.commands as unknown as { registerCommand(c: string, f: () => void): { dispose(): void } }).registerCommand('datacloak.restoreSelection', wrap(restoreSelection)),
    (vscode.commands as unknown as { registerCommand(c: string, f: (s: string) => void): { dispose(): void } }).registerCommand('datacloak.reveal', (s: string) => revealOriginal(engine, s, channel)),
    (vscode.window as unknown as { registerTreeDataProvider(v: string, p: unknown): { dispose(): void } }).registerTreeDataProvider('datacloak.vault', provider),
    bar,
  );
  paint();
}

export function deactivate(): void {}
