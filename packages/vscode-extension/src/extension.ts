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
    // R1 (ledger): commands.ts calls b.replace(undefined, text) on the
    // mock-tested path; adapt here so the live edit targets the real
    // editor.selection range instead of undefined.
    const adapted = {
      ...editor,
      edit: (fn2: (b: { replace(r: unknown, t: string): void }) => void) =>
        (editor as unknown as { edit(f: (b: { replace(r: unknown, t: string): void }) => void): Promise<boolean> }).edit((b) =>
          fn2({ replace: (r: unknown, t: string) => b.replace(r ?? (editor as unknown as { selection: unknown }).selection, t) }),
        ),
    };
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
