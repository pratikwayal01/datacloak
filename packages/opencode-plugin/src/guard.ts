import type { ResolvedConfig } from './config.js';

const BASH_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /cat\s+[^\n]*\.env\b/, reason: 'reads .env file' },
  { re: /(^|[;&|]\s*)printenv\b/, reason: 'dumps environment' },
  { re: /(^|[;&|]\s*)env\s*\|/, reason: 'pipes environment' },
  { re: /echo\s+\$[A-Za-z_][A-Za-z0-9_]*/, reason: 'echoes secret variable' },
  { re: /~\/\.ssh\//, reason: 'reads ssh directory' },
  { re: /~\/\.aws\/credentials/, reason: 'reads aws credentials' },
  { re: /export\s+[A-Za-z_]+=/, reason: 'exports secret to environment' },
];

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}$`);
}

function pathBlocked(filePath: string, config: ResolvedConfig): boolean {
  if (config.allowPaths.some((g) => globToRegExp(g).test(filePath))) return false;
  return config.blockPaths.some((g) => globToRegExp(g).test(filePath));
}

export function shouldBlock(tool: string, args: unknown, config: ResolvedConfig): string | null {
  const a = (args ?? {}) as Record<string, unknown>;
  if ((tool === 'bash' || tool === 'shell') && typeof a.command === 'string') {
    for (const p of BASH_PATTERNS) {
      if (p.re.test(a.command)) return `DataCloak: blocked bash (${p.reason})`;
    }
    return null;
  }
  if ((tool === 'read' || tool === 'read_file') && typeof a.filePath === 'string') {
    return pathBlocked(a.filePath, config) ? `DataCloak: blocked read of ${a.filePath}` : null;
  }
  return null;
}
