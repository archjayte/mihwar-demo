// Node-only crypto helpers for password + TOTP sign-in (scrypt, RFC 6238). The engine receives this as an injected "authKit"
// so the isomorphic engine itself never imports node:crypto.
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32encode = (buf) => {
  let bits = 0;
  let v = 0;
  let out = '';
  for (const b of buf) {
    v = (v << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(v >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(v << (5 - bits)) & 31];
  return out;
};
const b32decode = (s) => {
  let bits = 0;
  let v = 0;
  const out = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    v = (v << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const kit = {
  hashPassword(pw) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(pw, salt, 64, SCRYPT);
    return { salt: salt.toString('hex'), hash: hash.toString('hex') };
  },
  verifyPassword(pw, rec) {
    if (!rec?.salt) {
      crypto.scryptSync(String(pw), Buffer.alloc(16), 64, SCRYPT);
      return false;
    } // equalise timing for unknown accounts
    const h = crypto.scryptSync(String(pw), Buffer.from(rec.salt, 'hex'), 64, SCRYPT);
    const want = Buffer.from(rec.hash, 'hex');
    return h.length === want.length && crypto.timingSafeEqual(h, want);
  },
  randomPassword() {
    const a = 'abcdefghjkmnpqrstuvwxyz';
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const d = '23456789';
    const s = '#$%&*+?';
    const pick = (set) => set[crypto.randomInt(set.length)];
    const all = a + A + d;
    let out = pick(a) + pick(A) + pick(d) + pick(s);
    for (let i = 0; i < 12; i++) out += pick(all);
    return out
      .split('')
      .sort(() => crypto.randomInt(3) - 1)
      .join('');
  },
  totpSecret() {
    return b32encode(crypto.randomBytes(20));
  },
  totpAt(secret, ms) {
    const counter = Math.floor(ms / 30000);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const h = crypto.createHmac('sha1', b32decode(secret)).update(buf).digest();
    const o = h[h.length - 1] & 15;
    const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(n % 1000000).padStart(6, '0');
  },
  totpVerify(secret, code, ms, window = 1) {
    const c = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(c)) return false;
    for (let w = -window; w <= window; w++) if (kit.totpAt(secret, ms + w * 30000) === c) return true;
    return false;
  },
  otpauthUri(secret, account, issuer = 'MIHWAR') {
    return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  },
};
