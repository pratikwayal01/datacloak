import type { PatternEntry } from './secrets.js';
const p = (name: string, category: string, regex: RegExp): PatternEntry => ({ name, category, type: 'pii', regex, confidence: 'high' });
export const piiPatterns: PatternEntry[] = [
  p('email', 'EMAIL', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g),
  p('phone-e164', 'PHONE_E164', /\+[1-9]\d{7,14}/g),
  p('ipv4', 'IPV4', /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g),
  p('phone-us', 'PHONE_US', /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g),
];
