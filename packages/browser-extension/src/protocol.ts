export interface CloakRequest { kind: 'cloak'; text: string; }
export interface RestoreRequest { kind: 'restore'; text: string; }
export interface StatsRequest { kind: 'stats'; }
export interface SettingsGetRequest { kind: 'settings.get'; }
export interface SettingsSetRequest { kind: 'settings.set'; flags: { secrets: boolean; envVars: boolean; pii: boolean; entropy: boolean }; }
export interface CloakResponse { text: string; count: number; categories: string[]; }
export interface RestoreResponse { text: string; restored: number; }
export interface StatsResponse { counts: { cloaked: number; restored: number }; byCategory: Record<string, number>; oplog: { ts: number; tabId: number; kind: string; ms: number; count: number; categories: string[] }[]; }
export interface SettingsGetResponse { flags: { secrets: boolean; envVars: boolean; pii: boolean; entropy: boolean }; }
export interface SettingsSetResponse { flags: { secrets: boolean; envVars: boolean; pii: boolean; entropy: boolean }; }
export type BgRequest = CloakRequest | RestoreRequest | StatsRequest | SettingsGetRequest | SettingsSetRequest;
export type BgResponse = CloakResponse | RestoreResponse | StatsResponse | SettingsGetResponse | SettingsSetResponse;
