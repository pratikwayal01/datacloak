import type { DataCloakEngine } from '@pratikw/detect';
import * as vscode from 'vscode';

export interface Channel { appendLine(s: string): void; show(): void; }

export async function revealOriginal(engine: DataCloakEngine, synthetic: string, channel: Channel): Promise<void> {
  const entry = engine.vault.getBySynthetic(synthetic);
  channel.appendLine(entry ? `${entry.synthetic} → ${entry.original} [${entry.category}]` : 'datacloak: unknown value');
  channel.show();
}

export class VaultViewProvider {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(private engine: DataCloakEngine) {}
  refresh(): void { this.changed.fire(); }
  async getChildren(): Promise<vscode.TreeItem[]> {
    const entries = this.engine.vault.list();
    if (entries.length === 0) return [new vscode.TreeItem('vault empty')];
    return entries.map((e) => {
      const item = new vscode.TreeItem(`${e.synthetic} [${e.category}]`);
      item.description = `••••${e.original.slice(-4)}`;
      item.tooltip = 'click to reveal in output';
      item.command = { command: 'datacloak.reveal', title: 'Reveal', arguments: [e.synthetic] };
      return item;
    });
  }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
}
