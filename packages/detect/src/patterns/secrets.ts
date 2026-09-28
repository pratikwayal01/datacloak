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
  // Cloud resource IDs: distinctive prefixes, no key context needed.
  // Bare AWS secret keys intentionally omitted: ENV_VAR/INLINE_CONFIG +
  // entropy already cover keyed occurrences; a bare 40-char pattern FPs.
  s('aws-instance', 'AWS_INSTANCE_ID', /\bi-[0-9a-f]{8}(?:[0-9a-f]{9})?\b/g),
  s('aws-arn', 'AWS_ARN', /\barn:aws:[a-z0-9-]+:[a-z0-9-]*:[0-9]*:[^\s"'`,;).]+/g),
  s('gcp-key', 'GCP_API_KEY', /\bAIza[0-9A-Za-z\-_]{35}\b/g),
  s('gcp-sa', 'GCP_SERVICE_ACCOUNT', /\b[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com\b/g),
  s('azure-conn', 'AZURE_CONN_STRING', /\bDefaultEndpointsProtocol=https?;[^\s"'`]+/g),
  { name: 's3-uri', category: 'S3_BUCKET', type: 'secret', regex: /\bs3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])/g, confidence: 'high', valueGroup: 1 },
  { name: 's3-host', category: 'S3_BUCKET', type: 'secret', regex: /\b([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\.s3[.-][a-z0-9-]+\.amazonaws\.com/g, confidence: 'high', valueGroup: 1 },
];
