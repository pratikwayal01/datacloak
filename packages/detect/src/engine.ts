import { faker } from '@faker-js/faker';
import type { CloakResult, CustomPattern, DataCloakConfig, Detection, RestoreResult, Substitution, VaultEntry } from './types.js';
import { defaultConfig } from './types.js';
import { detectPass1 } from './patterns/index.js';
import { scanEntropy } from './entropy.js';
import { synthesize } from './synthesizers/index.js';
import { synthesizeDsn } from './synthesizers/credentials.js';
import { opaqueToken } from './tokens.js';
import { Vault } from './vault.js';
import { exportVaultJson, importVaultJson } from './vault-crypto.js';

export class DataCloakEngine {
  readonly vault: Vault;
  private config: DataCloakConfig;
  constructor(config: Partial<DataCloakConfig> = {}) {
    this.config = { ...defaultConfig, ...config, detection: { ...defaultConfig.detection, ...config.detection }, vault: { ...defaultConfig.vault, ...config.vault } };
    // Validate custom patterns loudly at construction (DET-08)
    for (const c of this.config.customPatterns ?? []) {
      try { new RegExp(c.pattern); } catch { throw new Error(`datacloak: invalid custom pattern "${c.name}"`); }
    }
    this.vault = new Vault(this.config.vault.maxEntries);
  }
  detect(text: string): Detection[] {
    const d = this.config.detection;
    const pass1 = detectPass1(text, { secrets: d.secrets, envVars: d.envVars, pii: d.pii }, this.config.customPatterns ?? []);
    const out = [...pass1];
    if (d.entropy) {
      for (const h of scanEntropy(text, d.entropyThreshold)) {
        if (out.some((x) => h.start < x.end && x.start < h.end)) continue;
        out.push({ value: h.value, category: 'HIGH_ENTROPY_STRING', type: 'secret', start: h.start, end: h.end, confidence: 'medium' });
      }
    }
    if (this.config.ner) {
      const cats = new Set(out.map((x) => x.category));
      const context = { hasEmail: cats.has('EMAIL'), hasPhone: [...cats].some((c) => c.startsWith('PHONE')), hasId: false };
      const push = (spans: { value: string; start: number; end: number; confidence: 'high' | 'medium' }[], category: string) => {
        for (const s of spans) {
          if (out.some((x) => s.start < x.end && x.start < s.end)) continue;
          out.push({ value: s.value, category, type: 'pii', start: s.start, end: s.end, confidence: s.confidence });
        }
      };
      const ner = this.config.ner;
      push(ner.detectNames(text), 'PERSON_NAME');
      push(ner.detectAddresses(text), 'STREET_ADDRESS');
      push(ner.detectDob(text, context), 'DATE_OF_BIRTH');
    }
    out.sort((a, b) => a.start - b.start || b.end - a.end);
    return out;
  }
  cloak(text: string): CloakResult {
    const detections = this.detect(text);
    const substitutions: CloakResult['substitutions'] = [];
    let result = text;
    for (let i = detections.length - 1; i >= 0; i--) {
      const det = detections[i];
      // Invariant: a known synthetic is never cloaked again — leave it as-is.
      if (this.vault.getBySynthetic(det.value)) continue;
      const existing = this.vault.getByOriginal(det.value);
      let synthetic = existing;
      if (!synthetic) {
        synthetic = this.makeSynthetic(det, text);
        this.vault.set({ original: det.value, synthetic, category: det.category, type: det.type, synthesizedAt: Date.now(), confidence: det.confidence });
      }
      result = result.slice(0, det.start) + synthetic + result.slice(det.end);
      substitutions.unshift({ original: det.value, synthetic, category: det.category });
    }
    return { text: result, substitutions };
  }
  private makeSynthetic(det: Detection, fullText: string): string {
    if (det.category === 'ENV_VAR') return this.synthEnvValue(det.value);
    for (let attempt = 0; attempt < 3; attempt++) {
      const s = synthesize(det.category, det.value) ?? opaqueToken(det.category);
      if (!fullText.includes(s)) return s;
    }
    return opaqueToken(det.category);
  }
  private synthEnvValue(value: string): string {
    const trimmed = value.replace(/^["']|["']$/g, '');
    const quote = value.startsWith('"') || value.startsWith("'") ? value[0] : '';
    const inner = this.cloakInner(trimmed);
    return `${quote}${inner}${quote}`;
  }
  private cloakInner(value: string): string {
    // DSN-aware: synthesize whole DSN so protocol/port survive
    const dsnCats = ['DSN_POSTGRES', 'DSN_MONGO', 'DSN_REDIS', 'DSN_MYSQL', 'DSN_AMQP'];
    const asDsn = detectPass1(value, { secrets: false, envVars: true, pii: false }).find((x) => dsnCats.includes(x.category));
    if (asDsn && asDsn.value === value) {
      const existing = this.vault.getByOriginal(value);
      if (existing) return existing;
      const s = synthesizeDsn(value);
      this.vault.set({ original: value, synthetic: s, category: asDsn.category, type: 'credential', synthesizedAt: Date.now(), confidence: 'high' });
      return s;
    }
    // Otherwise cloak secrets/pii/entropy inside the value, offset by quote (handled by caller via full-string replace below)
    const inner = new DataCloakEngine({ detection: { secrets: true, envVars: false, pii: true, entropy: true, entropyThreshold: this.config.detection.entropyThreshold }, vault: { maxEntries: this.config.vault.maxEntries } });
    inner.vaultImport(this.vault);
    const r = inner.cloak(value);
    this.vaultAbsorb(inner.vault);
    return r.text === value ? `SYNTH${faker.string.alphanumeric(16)}` : r.text;
  }
  private vaultImport(other: Vault): void {
    for (const e of other.list()) this.vault.set(e);
  }
  private vaultAbsorb(other: Vault): void {
    for (const e of other.list()) this.vault.set(e);
  }
  audit(text: string): { detections: Detection[]; preview: string } {
    const detections = this.detect(text);
    let preview = text;
    const sorted = [...detections].sort((a, b) => b.start - a.start);
    sorted.forEach((d) => {
      const n = detections.indexOf(d) + 1;
      preview = preview.slice(0, d.start) + `[${d.category}_${n}]` + preview.slice(d.end);
    });
    return { detections, preview };
  }
  cloakJson(value: unknown, seen = new Set<unknown>()): { value: unknown; substitutions: Substitution[] } {
    const subs: Substitution[] = [];
    const walk = (v: unknown): unknown => {
      if (typeof v === 'string') {
        const r = this.cloak(v);
        subs.push(...r.substitutions);
        return r.text;
      }
      if (Array.isArray(v)) {
        if (seen.has(v)) return v;
        seen.add(v);
        return v.map(walk);
      }
      if (v !== null && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
        if (seen.has(v)) return v;
        seen.add(v);
        const o: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v)) o[k] = walk(val);
        return o;
      }
      return v;
    };
    return { value: walk(value), substitutions: subs };
  }
  restore(text: string): RestoreResult {
    const entries = this.vault.list().sort((a, b) => b.synthetic.length - a.synthetic.length);
    let result = text;
    let restored = 0;
    for (const e of entries) {
      if (!result.includes(e.synthetic)) continue;
      result = result.split(e.synthetic).join(e.original);
      restored++;
    }
    return { text: result, restored };
  }
  async exportVault(pass: string): Promise<string> {
    return exportVaultJson(JSON.stringify(this.vault.list()), pass);
  }
  async importVault(blob: string, pass: string): Promise<number> {
    const json = await importVaultJson(blob, pass);
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error('datacloak: wrong passphrase or corrupt vault export');
    for (const e of parsed) {
      if (typeof e !== 'object' || e === null || typeof (e as Record<string, unknown>).original !== 'string' || typeof (e as Record<string, unknown>).synthetic !== 'string' || typeof (e as Record<string, unknown>).category !== 'string') {
        throw new Error('datacloak: wrong passphrase or corrupt vault export');
      }
    }
    for (const e of parsed) this.vault.set(e as VaultEntry);
    return parsed.length;
  }
}
export type { CustomPattern };
export { defaultConfig } from './types.js';
