// Platform digital seal (Ed25519). Zero dependencies (node:crypto).
// Purpose: the platform signs the canonical text of an official record (committee decision / coordination referral) and of every audit record
// that goes to the external mirror. Anyone holding the PUBLIC key can verify the record was not altered after sealing.
// Not: a qualified electronic signature issued by a certification authority (UAE PASS / government PKI). That integration is an external
// dependency listed in docs/handover/APPROVALS.md. The signer's identity inside the sealed text comes from the authenticated session.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const keyIdOf = (pem) => crypto.createHash('sha256').update(pem).digest('hex').slice(0, 16);
export function createSealer(dataDir, keyFile = process.env.MIHWAR_SEAL_KEY_FILE) {
  const file = keyFile || path.join(dataDir, 'seal-key.json');
  let rec = null;
  try {
    rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* generate below */
  }
  if (!rec?.private_pem) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    rec = {
      alg: 'Ed25519',
      created: new Date().toISOString(),
      private_pem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      public_pem: publicKey.export({ type: 'spki', format: 'pem' }),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rec, null, 2), { mode: 0o600 });
  }
  const priv = crypto.createPrivateKey(rec.private_pem);
  const keyId = keyIdOf(rec.public_pem);
  return {
    algorithm: 'Ed25519',
    keyId,
    publicKeyPem: rec.public_pem,
    created: rec.created,
    verify: (text, sigB64, keyId) => keyId === keyIdOf(rec.public_pem) && verifySeal(text, sigB64, rec.public_pem),
    sign: (text) => crypto.sign(null, Buffer.from(String(text), 'utf8'), priv).toString('base64'),
  };
}
export function verifySeal(text, sigB64, publicPem) {
  try {
    return crypto.verify(
      null,
      Buffer.from(String(text), 'utf8'),
      crypto.createPublicKey(publicPem),
      Buffer.from(String(sigB64), 'base64'),
    );
  } catch {
    return false;
  }
}
