import type { VaultEntry } from './types.js';

export class Vault {
  private bySynthetic = new Map<string, VaultEntry>();
  private origToSynth = new Map<string, string>();
  constructor(private maxEntries = 2000) {}
  get size(): number { return this.bySynthetic.size; }
  set(entry: VaultEntry): void {
    if (this.bySynthetic.has(entry.synthetic)) return;
    const prev = this.origToSynth.get(entry.original);
    if (prev !== undefined && prev !== entry.synthetic) this.bySynthetic.delete(prev);
    this.bySynthetic.set(entry.synthetic, entry);
    this.origToSynth.set(entry.original, entry.synthetic);
    while (this.bySynthetic.size > this.maxEntries) {
      const oldest = this.bySynthetic.keys().next().value as string;
      const evicted = this.bySynthetic.get(oldest);
      this.bySynthetic.delete(oldest);
      if (evicted && this.origToSynth.get(evicted.original) === oldest) this.origToSynth.delete(evicted.original);
    }
  }
  getBySynthetic(s: string): VaultEntry | undefined { return this.bySynthetic.get(s); }
  getByOriginal(o: string): string | undefined { return this.origToSynth.get(o); }
  list(): VaultEntry[] { return [...this.bySynthetic.values()]; }
  clear(): void { this.bySynthetic.clear(); this.origToSynth.clear(); }
}
