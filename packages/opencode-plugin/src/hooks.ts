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
        const r = engine.cloak(event.system);
        event.system = r.text;
        sessionStats.cloaked += r.substitutions.length;
      }
      if (Array.isArray(event.messages)) {
        for (const parts of asTextParts(event.messages)) {
          for (const part of parts) {
            if (part.type === 'text' && typeof part.text === 'string') {
              const r = engine.cloak(part.text);
              part.text = r.text;
              sessionStats.cloaked += r.substitutions.length;
            }
          }
        }
      }
    } catch (err) {
      console.error(`[datacloak] request cloak failed open: ${(err as Error).message}`);
    }
  });

  ctx.tool.hook('execute.before', (event) => {
    if (!config.enabled || config.mode === 'allow') return;
    try {
      // TASK-4 EXTENSION POINT: applyWriteRestore(event.input, engine) goes here, before shouldBlock.
      const reason = shouldBlock(String(event.tool ?? ''), event.input, config);
      if (reason !== null) {
        sessionStats.blocked += 1;
        throw new Error(reason);
      }
    } catch (err) {
      throw err instanceof Error ? err : new Error('DataCloak: blocked tool call');
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
    } catch {
      event.result = '[DataCloak: output suppressed after detection failure]';
      event.output = '';
    }
  });

  return engine;
}
