import type { PatternEntry } from './secrets.js';
export const CREDENTIAL_KEY_NAMES = ['PASSWORD','PASSWD','SECRET','API_KEY','APIKEY','API_SECRET','ACCESS_KEY','ACCESS_TOKEN','AUTH_TOKEN','PRIVATE_KEY','CLIENT_SECRET','DB_PASSWORD','DATABASE_URL','CONNECTION_STRING','AWS_SECRET_ACCESS_KEY','GITHUB_TOKEN','STRIPE_SECRET_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','SLACK_TOKEN','SENDGRID_API_KEY','TWILIO_AUTH_TOKEN','SUPABASE_KEY','VERCEL_TOKEN','SHOPIFY_TOKEN','GITLAB_TOKEN','HUGGINGFACE_TOKEN','JWT_SECRET','SESSION_SECRET','ENCRYPTION_KEY'];
export const isCredentialKey = (key: string): boolean => {
  const k = key.toUpperCase();
  if (CREDENTIAL_KEY_NAMES.includes(k)) return true;
  return /(PASSWORD|PASSWD|SECRET|TOKEN|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|API[_-]?KEY|CONNECTION|DATABASE[_-]?URL|DSN)/.test(k);
};
export const credentialPatterns: PatternEntry[] = [
  // Contextual matches first: on identical spans de-overlap keeps the earliest,
  // so ENV_VAR wins over the bare DSN inside its value (test: env value span).
  { name: 'env-var', category: 'ENV_VAR', type: 'credential', regex: /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("[^"\n]*"|'[^'\n]*'|[^\s"'`#;]+)/gm, confidence: 'high', valueGroup: 2 },
  { name: 'inline-config', category: 'INLINE_CONFIG', type: 'credential', regex: /["']?(?:api[_-]?key|secret|password|token|access[_-]?key)["']?\s*[:=]\s*["']([^"'`\s]+)["']?/gi, confidence: 'high', valueGroup: 1 },
  { name: 'dsn-postgres', category: 'DSN_POSTGRES', type: 'credential', regex: /postgres(?:ql)?:\/\/[^\s"'`]+/g, confidence: 'high' },
  { name: 'dsn-mongo', category: 'DSN_MONGO', type: 'credential', regex: /mongodb(?:\+srv)?:\/\/[^\s"'`]+/g, confidence: 'high' },
  { name: 'dsn-redis', category: 'DSN_REDIS', type: 'credential', regex: /redis:\/\/(?::[^\s@]+@)?[^\s"'`]+/g, confidence: 'high' },
  { name: 'dsn-mysql', category: 'DSN_MYSQL', type: 'credential', regex: /mysql:\/\/[^\s"'`]+/g, confidence: 'high' },
  { name: 'dsn-amqp', category: 'DSN_AMQP', type: 'credential', regex: /amqp:\/\/(?:[^:\s@]+(?::[^\s@]*)?@)?[^\s"'`]+/g, confidence: 'high' },
];
