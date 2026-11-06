// Encryption at rest (DATA-012). AES-256-GCM via node:crypto; zero dependencies.
// WHAT IT PROTECTS: the content of every database row and every uploaded file on disk (and therefore the SQLite WAL, which only ever receives ciphertext).
// WHAT IT DOES NOT PROTECT: collection names, row keys and sizes; the signing key file (use MIHWAR_SEAL_KEY_FILE on a protected volume); memory while running;
// the optional audit mirror (it holds hashes and signatures, not record text). It is not a substitute for disk/volume encryption in production.
// KEY: MIHWAR_STORE_KEY (64 hex chars = 32 raw bytes, or a passphrase of 16+ chars stretched with scrypt) or MIHWAR_STORE_KEY_FILE (same formats, first line).
import crypto from 'node:crypto';
import fs from 'node:fs';

const PREFIX = 'enc1:';
const MAGIC = Buffer.from('MWENC1\0');
export class CryptError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function deriveKey(secret) {
  const s = String(secret).trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, 'hex');
  if (s.length < 16)
    throw new CryptError(
      'STORE_KEY_WEAK',
      'MIHWAR_STORE_KEY must be 64 hex characters or a passphrase of at least 16 characters',
    );
  return crypto.scryptSync(s, 'mihwar-store-v1', 32);
}
export function keyFromEnv(env = process.env) {
  let secret = env.MIHWAR_STORE_KEY || '';
  if (!secret && env.MIHWAR_STORE_KEY_FILE) {
    try {
      secret = fs.readFileSync(env.MIHWAR_STORE_KEY_FILE, 'utf8').split(/\r?\n/)[0];
    } catch (e) {
      throw new CryptError('STORE_KEY_UNREADABLE', `cannot read MIHWAR_STORE_KEY_FILE (${e.code || e.message})`);
    }
  }
  return secret ? deriveKey(secret) : null;
}

export function createCrypt(key) {
  if (!key) return null;
  const seal = (buf) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  };
  const open = (buf) => {
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
    } catch {
      throw new CryptError('STORE_KEY_WRONG', 'wrong MIHWAR_STORE_KEY, or the stored data was altered');
    }
  };
  return {
    algorithm: 'AES-256-GCM',
    isEnc: (s) => typeof s === 'string' && s.startsWith(PREFIX),
    enc: (s) => PREFIX + seal(Buffer.from(String(s), 'utf8')).toString('base64'),
    dec: (s) => open(Buffer.from(s.slice(PREFIX.length), 'base64')).toString('utf8'),
    encBytes: (u8) => Buffer.concat([MAGIC, seal(Buffer.from(u8))]),
    decBytes: (buf) => new Uint8Array(open(Buffer.from(buf).subarray(MAGIC.length))),
  };
}
export const isEncBytes = (buf) => buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
export const isEncText = (s) => typeof s === 'string' && s.startsWith(PREFIX);
