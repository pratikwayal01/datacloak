export type Confidence = 'high' | 'medium';
export type EntryType = 'pii' | 'secret' | 'credential';
export interface Detection { value: string; category: string; type: EntryType; start: number; end: number; confidence: Confidence; }
export interface Substitution { original: string; synthetic: string; category: string; start: number; end: number; }
export interface CloakResult { text: string; substitutions: Substitution[]; }
export interface RestoreResult { text: string; restored: number; }
export interface VaultEntry { original: string; synthetic: string; category: string; type: EntryType; synthesizedAt: number; confidence: Confidence; }
export interface CustomPattern { name: string; pattern: string; category: string; type: EntryType; synthesizer?: string; kind?: EntityKind; literal?: boolean; }
/** Typed custom-entity kinds. `literal` is a legacy marker written by pre-kind versions — read once during migration. */
export type EntityKind = 'name' | 'employee_id' | 'email' | 'phone' | 'other';
export interface NerLike {
  detectNames(text: string): { value: string; start: number; end: number; confidence: 'high' | 'medium' }[];
  detectAddresses(text: string): { value: string; start: number; end: number; confidence: 'high' | 'medium' }[];
  detectDob(text: string, context: { hasEmail: boolean; hasPhone: boolean; hasId: boolean }): { value: string; start: number; end: number; confidence: 'high' | 'medium' }[];
}
export interface DataCloakConfig {
  detection: { secrets: boolean; envVars: boolean; pii: boolean; entropy: boolean; entropyThreshold: number };
  vault: { maxEntries: number };
  locale?: string;
  customPatterns?: CustomPattern[];
  ner?: NerLike;
}
export const defaultConfig: DataCloakConfig = {
  detection: { secrets: true, envVars: true, pii: true, entropy: true, entropyThreshold: 4.5 },
  vault: { maxEntries: 2000 },
};
