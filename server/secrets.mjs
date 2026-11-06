// INT-002 / INT-011: credentials come from the environment or from a file (Docker/Kubernetes secrets, systemd LoadCredential) — never from the repository,
// the database or API responses. A secret file readable by group/others is refused in production mode. `redact()` scrubs every known secret value
// (and common credential shapes) from anything that is logged or returned.
import fs from 'node:fs';

/** Reads NAME, or the file named by NAME_FILE. Returns '' when unset. Throws when a file secret is too widely readable and `strict` is on. */
export function readSecret(name, env = process.env, { strict = false } = {}) {
  const file = env[`${name}_FILE`];
  if (file) {
    const st = fs.statSync(file);
    if (strict && process.platform !== 'win32' && st.mode & 0o077)
      throw new Error(`${name}_FILE (${file}) is readable by group/others; use mode 0600 or 0400`);
    return fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  }
  return env[name] || '';
}

const SHAPES = [
  [/(authorization:\s*)(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1$2 [redacted]'],
  [/(AUTH PLAIN\s+)[A-Za-z0-9+/=]{8,}/gi, '$1[redacted]'],
  [/(https?:\/\/)([^\s/:@]+):([^\s/@]+)@/gi, '$1[redacted]@'],
  [/((?:password|passwd|pass|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;&"']+/gi, '$1[redacted]'],
];
/** Returns a function that removes the given secret values and common credential shapes from text. */
export function redactor(values = []) {
  const known = values.filter((v) => typeof v === 'string' && v.length >= 4).sort((a, b) => b.length - a.length);
  return (text) => {
    let s = String(text ?? '');
    for (const v of known) s = s.split(v).join('[redacted]');
    for (const [re, to] of SHAPES) s = s.replace(re, to);
    return s;
  };
}
export const maskRecipient = (to) => {
  const s = String(to || '');
  const at = s.indexOf('@');
  if (at > 0) return `${s[0]}***${s.slice(at)}`;
  return s.length > 4 ? `${s.slice(0, 2)}***${s.slice(-2)}` : '***';
};
