// Optional external antivirus: uses clamscan/clamdscan when installed (or MIHWAR_SCANNER=<command>). Returns null when none exists,
// in which case only the built-in heuristic scan runs. Fails CLOSED (throws) when a scanner is configured but errors.
// MIHWAR_SCANNER_DB=<dir> points clamscan at a specific signature directory (-d); otherwise the system default database is used.
import { spawnSync } from 'node:child_process';

export function makeScanner(cmd, db = '') {
  const args = ['--no-summary', '--stdout', ...(db && /clamscan/.test(cmd) ? ['-d', db] : []), '-'];
  return (name, bytes) => {
    const r = spawnSync(cmd, args, { input: Buffer.from(bytes), timeout: 30000, maxBuffer: 1 << 20 });
    if (r.status === 0) return { infected: false };
    if (r.status === 1)
      return {
        infected: true,
        signature: String(r.stdout || '')
          .replace(/^stream:\s*/, '')
          .replace(/\s*FOUND\s*$/, '')
          .trim(),
      };
    throw new Error('scanner error');
  };
}
const explicit = !!process.env.MIHWAR_SCANNER;
const candidates = explicit ? [process.env.MIHWAR_SCANNER] : ['clamdscan', 'clamscan'];
const usable = (c) => {
  try {
    return spawnSync(c, ['--version'], { timeout: 5000 }).status === 0;
  } catch {
    return false;
  }
};
let found = null;
export let scannerNote = '';
for (const c of candidates) {
  if (!usable(c)) continue;
  // A scanner chosen explicitly (MIHWAR_SCANNER) is trusted and fails CLOSED. An auto-detected one must first prove it can scan a clean sample
  // (a clamscan without a signature database exits with an error); otherwise the built-in heuristic is used and the reason is reported.
  if (!explicit) {
    try {
      makeScanner(c, process.env.MIHWAR_SCANNER_DB || '')('selftest.txt', Buffer.from('clean sample'));
    } catch {
      scannerNote = `${c} found but cannot scan (no signature database?) — using the built-in heuristic`;
      continue;
    }
  }
  found = c;
  break;
}
export const scannerName = found || null;
export const scanner = found ? makeScanner(found, process.env.MIHWAR_SCANNER_DB || '') : null;
