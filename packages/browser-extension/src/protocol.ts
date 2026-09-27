import type { CustomPattern } from '@pratikw/detect';

export interface CloakRequest { kind: 'cloak'; text: string; }
export interface RestoreRequest { kind: 'restore'; text: string; }
export interface StatsRequest { kind: 'stats'; }
export interface SettingsGetRequest { kind: 'settings.get'; }
export interface SettingsSetRequest { kind: 'settings.set'; flags: { secrets: boolean; envVars: boolean; pii: boolean; entropy: boolean }; }
export interface CloakResponse { text: string; count: number; categories: string[]; }
export interface RestoreResponse { text: string; restored: number; hits?: { synthetic: string; original: string }[]; }
export interface StatsResponse { counts: { cloaked: number; restored: number }; byCategory: Record<string, number>; oplog: { ts: number; tabId: number; kind: string; ms: number; count: number; categories: string[]; origin?: string }[]; }
export interface SettingsGetResponse { flags: { secrets: boolean; envVars: boolean; pii: boolean; entropy: boolean }; }
export interface SettingsSetResponse { flags: { secrets: boolean; envVars: boolean; pii: boolean; entropy: boolean }; }
export interface PatternsGetRequest { kind: 'patterns.get'; }
export interface PatternsSetRequest { kind: 'patterns.set'; patterns: CustomPattern[]; }
export interface LastCloakRequest { kind: 'lastCloak.get'; }
export interface CloakSpan { original: string; synthetic: string; category: string; start: number; end: number; }
export interface LastCloakResponse { record: { original: string; cloaked: string; subs: CloakSpan[]; ts: number } | null; }
export interface PatternsGetResponse { patterns: CustomPattern[]; }
export interface PatternsSetResponse { patterns: CustomPattern[]; error?: string; }
export type BgRequest = CloakRequest | RestoreRequest | StatsRequest | SettingsGetRequest | SettingsSetRequest | PatternsGetRequest | PatternsSetRequest | LastCloakRequest;
export type BgResponse = CloakResponse | RestoreResponse | StatsResponse | SettingsGetResponse | SettingsSetResponse | PatternsGetResponse | PatternsSetResponse | LastCloakResponse;
