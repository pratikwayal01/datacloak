export interface CloakRequest { kind: 'cloak'; text: string; }
export interface RestoreRequest { kind: 'restore'; text: string; }
export type BgRequest = CloakRequest | RestoreRequest;
export interface CloakResponse { text: string; count: number; categories: string[]; }
export interface RestoreResponse { text: string; restored: number; }
export type BgResponse = CloakResponse | RestoreResponse;
