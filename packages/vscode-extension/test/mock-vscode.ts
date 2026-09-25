export class EventEmitter<T> {
  private fns: ((e: T) => void)[] = [];
  event = (fn: (e: T) => void) => ({ dispose: () => {} });
  fire(e: T): void { for (const f of this.fns) f(e); }
}
export const commands = {
  registerCommand: (..._a: unknown[]) => ({ dispose: () => {} }),
};
export const window = {
  showInformationMessage: (..._a: unknown[]) => Promise.resolve(undefined),
  createOutputChannel: (_n: string) => ({ appendLine: (..._a: unknown[]) => {}, show: () => {} }),
  activeTextEditor: undefined as unknown,
  registerTreeDataProvider: (..._a: unknown[]) => ({ dispose: () => {} }),
  createStatusBarItem: (..._a: unknown[]) => ({ text: '', show: () => {}, dispose: () => {} }),
};
export class TreeItem {
  constructor(public label: string, public collapsibleState?: number) {}
  description?: string;
  tooltip?: string;
  command?: unknown;
}
export const TreeItemCollapsibleState = { None: 0 };
export const StatusBarAlignment = { Left: 0 };
