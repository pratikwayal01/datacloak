import type { EntryType, Confidence } from '../types.js';
export interface PatternEntry { name: string; category: string; type: EntryType; regex: RegExp; confidence: Confidence; valueGroup?: number; }
const s = (name: string, category: string, regex: RegExp): PatternEntry => ({ name, category, type: 'secret', regex, confidence: 'high' });
export const secretPatterns: PatternEntry[] = [
  s('anthropic', 'API_KEY_ANTHROPIC', /sk-ant-api03-[A-Za-z0-9\-_]{20,}/g),
  s('openai-proj', 'API_KEY_OPENAI', /sk-proj-[A-Za-z0-9\-_]{20,}/g),
  s('openai-svcacct', 'API_KEY_OPENAI', /sk-svcacct-[A-Za-z0-9\-_]{20,}/g),
  s('openai', 'API_KEY_OPENAI', /sk-[A-Za-z0-9]{20,}/g),
  s('aws', 'AWS_ACCESS_KEY', /AKIA[0-9A-Z]{16}/g),
  s('github-classic', 'GITHUB_PAT', /ghp_[A-Za-z0-9]{36}/g),
  s('github-fine', 'GITHUB_PAT', /github_pat_[A-Za-z0-9_]{22,}/g),
  s('stripe-sk', 'STRIPE_KEY', /sk_live_[A-Za-z0-9]{16,}/g),
  s('stripe-rk', 'STRIPE_KEY', /rk_live_[A-Za-z0-9]{16,}/g),
  s('jwt', 'JWT', /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_=.]+/g),
  s('pem', 'PEM_KEY', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g),
];
