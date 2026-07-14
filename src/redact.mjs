// High-confidence secret redaction. Applied to rendered output when enabled.
// Order matters: more specific patterns first (sk-ant before sk-, jwt before kv).

const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, 'anthropic-key'],
  [/sk-[A-Za-z0-9]{20,}/g, 'openai-key'],
  [/AKIA[0-9A-Z]{16}/g, 'aws-akia'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, 'github-token'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'slack-token'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'jwt'],
];

// key:"value" / key=value style secrets (keeps the key, masks the value).
const KV = /((?:api[_-]?key|secret|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret)"?\s*[:=]\s*"?)([A-Za-z0-9_\-./+]{12,})/gi;

export function redactSecrets(str) {
  if (!str) return str;
  let out = String(str);
  for (const [re, kind] of PATTERNS) {
    out = out.replace(re, `«redacted:${kind}»`);
  }
  out = out.replace(KV, (_m, k) => `${k}«redacted:secret»`);
  return out;
}
