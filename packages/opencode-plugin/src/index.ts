import type { Plugin } from '@opencode-ai/plugin';
import { loadConfig } from './config.js';
import { createHooks } from './hooks.js';

type AnyEvent = Record<string, unknown>;

// Adapter: createHooks registers against a session/tool hook registry;
// here we capture those handlers and delegate from the real v1 hook slots.
export const DatacloakPlugin: Plugin = async (input) => {
  const config = loadConfig(input.directory);
  if (!config.enabled) return {};
  const handlers: Record<string, ((e: AnyEvent) => void)[]> = {};
  const hook = (name: string, fn: (e: AnyEvent) => void) => {
    (handlers[name] ??= []).push(fn);
  };
  createHooks({ session: { hook }, tool: { hook } }, config);
  const run = (name: string, event: AnyEvent) => {
    for (const fn of handlers[name] ?? []) fn(event);
  };
  console.error(`[datacloak] active: secrets=${config.detection.secrets} pii=${config.detection.pii} entropy=${config.detection.entropy} vault=${config.vault.maxEntries}`);
  return {
    'experimental.chat.system.transform': async (_in, out) => {
      for (let i = 0; i < out.system.length; i++) {
        const event: AnyEvent = { system: out.system[i] };
        run('request', event);
        out.system[i] = event.system as string;
      }
    },
    'experimental.chat.messages.transform': async (_in, out) => {
      run('request', { messages: out.messages.map((m) => ({ parts: m.parts })) });
    },
    'tool.execute.before': async (in_, out) => {
      run('execute.before', { tool: in_.tool, input: out.args });
    },
    'tool.execute.after': async (in_, out) => {
      const event: AnyEvent = { tool: in_.tool, result: out.output, output: '' };
      run('execute.after', event);
      out.output = event.result as string;
    },
  };
};

export default DatacloakPlugin;
