// External audit mirror (spec §13.5: audit copies outside the operator's path).
// Every audit record is appended, with an Ed25519 seal over its hash, to day-files in MIHWAR_AUDIT_MIRROR. Point that folder at a separate volume or an
// append-only / WORM share that the platform operator cannot rewrite; this code then lets anyone holding the public key detect any rewrite of the
// operational database (or of the mirror itself). Without a separate target the mirror is still written but gives no independence — the CHECK output says so.
import fs from 'node:fs';
import path from 'node:path';
import { verifySeal } from './sealer.mjs';
import { auditDigest } from './engine/core.mjs';

export function createAuditMirror(dir, sealer) {
  fs.mkdirSync(dir, { recursive: true });
  const append = (rec) => {
    const day = String(rec.at).slice(0, 10);
    const line = JSON.stringify({ rec, key_id: sealer.keyId, sig: sealer.sign(rec.hash) }) + '\n';
    fs.appendFileSync(path.join(dir, `audit-${day}.jsonl`), line, { mode: 0o640 });
  };
  const lastSeq = () => {
    // records of one day can be written out of day order (seeded history), so take the maximum over all files
    let max = 0;
    for (const f of fs.readdirSync(dir).filter((x) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(x)))
      for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        if (!l) continue;
        try {
          max = Math.max(max, JSON.parse(l).rec.seq);
        } catch {
          /* skip damaged line */
        }
      }
    return max;
  };
  const sink = (rec) => append(rec);
  /** Mirrors records the live log has but the mirror lacks (first start, or a crash between a write and its mirror line). */
  sink.catchUp = (audit) => {
    const last = lastSeq();
    let n = 0;
    for (const r of audit)
      if (r.seq > last) {
        append(r);
        n++;
      }
    return { mirrored_now: n, mirror_last_seq: last, live_last_seq: audit.at(-1)?.seq || 0 };
  };
  /** Demo reset only: the old chain is archived (never deleted) and a new chain starts. */
  sink.rotate = () => {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('audit-'));
    if (!files.length) return;
    const arch = path.join(dir, `archive-${Date.now()}`);
    fs.mkdirSync(arch);
    for (const f of files) fs.renameSync(path.join(dir, f), path.join(arch, f));
  };
  return sink;
}

/** Verifies the mirror: seals valid, chain continuous from GENESIS, hashes recomputed, and (optionally) identical to the live audit log. */
export function verifyMirror(dir, publicPem, liveAudit = null) {
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        .sort()
    : [];
  const recs = [];
  const problems = [];
  for (const f of files)
    for (const [i, line] of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').entries()) {
      if (!line) continue;
      try {
        recs.push(JSON.parse(line));
      } catch {
        problems.push(`${f}:${i + 1} unreadable line`);
      }
    }
  recs.sort((a, b) => a.rec.seq - b.rec.seq);
  let prev = 'GENESIS';
  let expectSeq = 1;
  for (const { rec, sig } of recs) {
    if (rec.seq !== expectSeq) {
      problems.push(`seq gap or reorder at ${rec.seq} (expected ${expectSeq})`);
      expectSeq = rec.seq;
    }
    if (rec.prev !== prev) problems.push(`chain break at seq ${rec.seq}`);
    if (auditDigest(rec.prev, rec) !== rec.hash) problems.push(`hash mismatch at seq ${rec.seq}`);
    if (!verifySeal(rec.hash, sig, publicPem)) problems.push(`bad seal at seq ${rec.seq}`);
    prev = rec.hash;
    expectSeq++;
  }
  let compared = null;
  if (liveAudit) {
    const byseq = new Map(recs.map((r) => [r.rec.seq, r.rec.hash]));
    let missing = 0,
      differ = 0;
    for (const r of liveAudit) {
      const h = byseq.get(r.seq);
      if (h === undefined) missing++;
      else if (h !== r.hash) {
        differ++;
        problems.push(`live record ${r.seq} differs from the mirror`);
      }
    }
    compared = { live: liveAudit.length, mirrored: recs.length, live_not_in_mirror: missing, differing: differ };
  }
  return {
    ok: problems.length === 0,
    records: recs.length,
    files: files.length,
    head: prev === 'GENESIS' ? null : prev.slice(0, 16),
    problems: problems.slice(0, 20),
    compared,
  };
}
