export interface ConsoleCtx { version: string; vaultCount: number; settings: Record<string, unknown>; }

export function runConsoleCmd(input: string, ctx: ConsoleCtx): string {
  const cmd = input.trim();
  if (cmd === 'help') return 'commands: help, vault.list, settings.dump, version';
  if (cmd === 'vault.list') return `vault: ${ctx.vaultCount} entries`;
  if (cmd === 'settings.dump') return JSON.stringify(ctx.settings, null, 2);
  if (cmd === 'version') return `datacloak ${ctx.version}`;
  return `unknown command "${cmd}" — try help`;
}
