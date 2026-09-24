import { DataCloakEngine } from '@pratikw/detect';
import type { ResolvedConfig } from './config.js';
import { shouldBlock } from './guard.js';

export interface SessionStats { cloaked: number; blocked: number; restored: number; }
export const sessionStats: SessionStats = { cloaked: 0, blocked: 0, restored: 0 };

type AnyEvent = Record<string, unknown>;
interface HookCtx {
  session: { hook: (name: string, fn: (e: AnyEvent) => void) => void };
  tool: { hook: (name: string, fn: (e: AnyEvent) => void) => void };
}

const asTextParts = (messages: unknown): { type?: string; text?: string }[][] => {
  if (!Array.isArray(messages)) return [];
  return (messages as { parts?: { type?: string; text?: string }[] }[]).map((m) => m.parts ?? []);
};

const cloakCounted = (engine: DataCloakEngine, text: string): string => {
  const r = engine.cloak(text);
  sessionStats.cloaked += r.substitutions.length;
  return r.text;
};

const cloakDeep = (engine: DataCloakEngine, value: unknown, seen: Set<object>): unknown => {
  if (typeof value === 'string') return value.length > 0 ? cloakCounted(engine, value) : value;
  if (Array.isArray(value)) {
    if (seen.has(value)) return value;
    seen.add(value);
    for (let i = 0; i < value.length; i++) value[i] = cloakDeep(engine, value[i], seen);
    return value;
  }
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const [k, v] of Object.entries(value)) (value as Record<string, unknown>)[k] = cloakDeep(engine, v, seen);
    return value;
  }
  return value;
};

const WRITE_TOOLS = new Set(['write', 'edit', 'create', 'write_file', 'edit_file', 'apply_patch']);
const RESTORABLE_KEYS = new Set(['content', 'text', 'old_string', 'new_string', 'oldString', 'newString', 'prefix', 'suffix', 'patchText']);

export function applyWriteRestore(engine: DataCloakEngine, tool: string, args: Record<string, unknown>): number {
  if (!args || typeof args !== 'object') return 0;
  if (!WRITE_TOOLS.has(tool)) return 0;
  let total = 0;
  for (const key of RESTORABLE_KEYS) {
    const value = args[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    try {
      const r = engine.restore(value);
      if (r.restored > 0) {
        args[key] = r.text;
        total += r.restored;
      }
    } catch (err) {
      console.error(`[datacloak] write restore failed open: ${(err as Error).message}`);
    }
  }
  sessionStats.restored += total;
  return total;
}

export function createHooks(ctx: HookCtx, config: ResolvedConfig): DataCloakEngine {
  const engine = new DataCloakEngine({
    detection: config.detection,
    vault: config.vault,
    customPatterns: config.customPatterns,
  });

  ctx.session.hook('request', (event) => {
    if (!config.enabled) return;
    try {
      if (typeof event.system === 'string') {
        event.system = cloakCounted(engine, event.system);
      } else if (Array.isArray(event.system)) {
        event.system = (event.system as unknown[]).map((s) =>
          typeof s === 'string' ? cloakCounted(engine, s) : s,
        );
      }
      if (Array.isArray(event.messages)) {
        for (const parts of asTextParts(event.messages)) {
          for (const part of parts) {
            if (part.type === 'text' && typeof part.text === 'string') {
              part.text = cloakCounted(engine, part.text);
            }
          }
        }
      }
    } catch (err) {
      console.error(`[datacloak] request cloak failed open: ${(err as Error).message}`);
    }
  });

  ctx.tool.hook('execute.before', (event) => {
    if (config.enabled && config.mode !== 'allow') {
      const reason = shouldBlock(String(event.tool ?? ''), event.input, config);
      if (reason !== null) {
        sessionStats.blocked += 1;
        throw new Error(reason);
      }
    }
    if (config.enabled) {
      applyWriteRestore(engine, String(event.tool ?? ''), event.input as Record<string, unknown>);
    }
  });

  ctx.tool.hook('execute.after', (event) => {
    if (!config.enabled) return;
    try {
      for (const key of ['result', 'output'] as const) {
        const value = event[key];
        if (typeof value === 'string' && value.length > 0) {
          const before = engine.detect(value).length;
          const r = engine.cloak(value);
          event[key] = r.text;
          sessionStats.cloaked += r.substitutions.length;
          if (r.substitutions.length === 0 && before > 0) {
            event[key] = `${r.text}\n[DataCloak: ${before} possible secrets redacted from output]`;
          }
        }
      }
      if (typeof event.title === 'string' && event.title.length > 0) {
        event.title = cloakCounted(engine, event.title);
      }
      if (event.metadata !== undefined) {
        event.metadata = cloakDeep(engine, event.metadata, new Set());
      }
    } catch {
      event.result = '[DataCloak: output suppressed after detection failure]';
      event.output = '';
      event.title = '';
      event.metadata = {};
    }
  });

  return engine;
}
