export type NerConfidence = 'high' | 'medium';
export interface Span { value: string; start: number; end: number; confidence: NerConfidence; }
export interface PiiContext { hasEmail: boolean; hasPhone: boolean; hasId: boolean; }
export interface NerProvider {
  name: string;
  detectNames(text: string): Span[];
  detectAddresses(text: string): Span[];
  detectDob(text: string, context: PiiContext): Span[];
}
