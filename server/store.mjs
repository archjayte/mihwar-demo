// MIHWAR runtime stores. Zero npm dependencies.
//  - SqliteStore: node:sqlite (built into Node >= 22.13), WAL, row-level diff. Only changed rows are written, in ONE transaction per flush,
//    so a crash leaves the previous or the next consistent snapshot, never a mix. This is the default runtime store.
//  - JsonStore: the original whole-state atomic file (kept for portability and as the import source).
// Both expose: load() -> state|null, save(state), close(). Debouncing lives in createPersister().
import fs from 'node:fs';
import path from 'node:path';
import { isEncText, CryptError } from './crypt.mjs';

const pad = (n) => String(n).padStart(9, '0');

export async function openSqlite(file) {
  const realEmit = process.emitWarning;
  process.emitWarning = (w, ...a) => {
    if (String(w?.message || w).includes('SQLite')) return;
    return realEmit.call(process, w, ...a);
  };
  let mod;
  try {
    mod = await import('node:sqlite');
  } finally {
    process.emitWarning = realEmit;
  }
  const db = new mod.DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;');
  db.exec(`CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, k TEXT NOT NULL, kind TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, PRIMARY KEY (coll, k)) WITHOUT ROWID;
           CREATE TABLE IF NOT EXISTS store_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  return db;
}

export class SqliteStore {
  constructor(db, crypt = null) {
    this.db = db;
    this.crypt = crypt; // crypt: optional AES-256-GCM (server/crypt.mjs); rows are encrypted on write and decrypted on read
    this.cache = new Map(); // coll -> Map(key -> json string)
    this.shape = new Map(); // coll -> 'array' | 'map' | 'value'
    this.auditLen = new Map(); // append-only arrays: how many rows are already persisted
    this.stmts = {
      up: db.prepare(
        'INSERT INTO docs (coll,k,kind,pos,body) VALUES (?,?,?,?,?) ON CONFLICT(coll,k) DO UPDATE SET body=excluded.body, kind=excluded.kind, pos=excluded.pos',
      ),
      del: db.prepare('DELETE FROM docs WHERE coll=? AND k=?'),
      all: db.prepare('SELECT coll,k,kind,pos,body FROM docs ORDER BY coll,pos,k'),
      count: db.prepare('SELECT COUNT(*) AS n FROM docs'),
    };
    this.stats = { flushes: 0, lastMs: 0, maxMs: 0, lastRowsWritten: 0 };
  }
  isEmpty() {
    return this.stmts.count.get().n === 0;
  }
  load() {
    if (this.isEmpty()) return null;
    const state = {};
    const kinds = {};
    this.plaintextRows = 0;
    for (const r of this.stmts.all.all()) {
      kinds[r.coll] = r.kind;
      let body = r.body;
      let stale = false;
      if (isEncText(body)) {
        if (!this.crypt)
          throw new CryptError(
            'STORE_ENCRYPTED_NO_KEY',
            'the database is encrypted: set MIHWAR_STORE_KEY (or MIHWAR_STORE_KEY_FILE) to the key it was created with',
          );
        body = this.crypt.dec(body);
      } else if (this.crypt) {
        stale = true;
        this.plaintextRows++;
      } // legacy plaintext row: left out of the cache so the next save rewrites it encrypted
      let c = this.cache.get(r.coll);
      if (!c) {
        c = new Map();
        this.cache.set(r.coll, c);
      }
      c.set(r.k, stale ? '' : r.pos + '|' + body);
      if (r.kind === 'value') state[r.coll] = JSON.parse(body);
      else if (r.kind === 'array') (state[r.coll] ||= []).push(JSON.parse(body));
      else (state[r.coll] ||= {})[r.k] = JSON.parse(body);
    }
    for (const [c, k] of Object.entries(kinds)) this.shape.set(c, k);
    for (const [c, k] of Object.entries(kinds)) if (k === 'array') this.auditLen.set(c, state[c].length);
    if (this.plaintextRows) this.auditLen.clear(); // append-only collections normally re-check only their tail; after enabling encryption every legacy row must be rewritten
    // empty arrays/objects have no rows: restore them from the shape table
    for (const row of this.db.prepare("SELECT name,value FROM store_meta WHERE name LIKE 'empty:%'").all()) {
      const c = row.name.slice(6);
      if (!(c in state)) {
        state[c] = row.value === 'array' ? [] : {};
        this.shape.set(c, row.value);
      }
    }
    return state;
  }
  // Rows are keyed: arrays by id (or zero-padded index when rows have no id), maps by key, scalars/objects without shape as one 'value' row.
  save(state) {
    const t0 = performance.now();
    let written = 0;
    const db = this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const coll of Object.keys(state)) {
        const v = state[coll];
        const kind = Array.isArray(v) ? 'array' : coll === 'meta' ? 'value' : 'map';
        let cache = this.cache.get(coll);
        if (!cache) {
          cache = new Map();
          this.cache.set(coll, cache);
        }
        if (this.shape.get(coll) !== kind) {
          this.shape.set(coll, kind);
        }
        const seen = new Set();
        const put = (k, obj, pos = 0) => {
          const body = pos + '|' + JSON.stringify(obj);
          if (cache.get(k) !== body) {
            {
              const plain = body.slice(body.indexOf('|') + 1);
              this.stmts.up.run(coll, k, kind, pos, this.crypt ? this.crypt.enc(plain) : plain);
            }
            cache.set(k, body);
            written++;
          }
          seen.add(k);
        };
        if (kind === 'value') put('_', v);
        else if (kind === 'array') {
          const append = coll === 'audit' || coll === 'outbound' || coll === 'breakGlass';
          const from = append ? Math.max(0, Math.min(this.auditLen.get(coll) ?? 0, v.length) - 3) : 0; // append-only: re-check only the tail
          if (append) for (let i = 0; i < from; i++) seen.add(pad(i));
          for (let i = from; i < v.length; i++) {
            const r = v[i];
            put(r && typeof r === 'object' && r.id != null && !append ? String(r.id) : pad(i), r, i);
          }
          this.auditLen.set(coll, v.length);
        } else for (const k of Object.keys(v)) put(k, v[k]);
        for (const k of cache.keys())
          if (!seen.has(k)) {
            this.stmts.del.run(coll, k);
            cache.delete(k);
            written++;
          }
        if ((kind === 'array' && v.length === 0) || (kind === 'map' && Object.keys(v).length === 0))
          db.prepare('INSERT OR REPLACE INTO store_meta (name,value) VALUES (?,?)').run('empty:' + coll, kind);
        else db.prepare('DELETE FROM store_meta WHERE name=?').run('empty:' + coll);
      }
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      this.cache.clear();
      this.auditLen.clear();
      throw e;
    }
    const ms = performance.now() - t0;
    this.stats = {
      flushes: this.stats.flushes + 1,
      lastMs: +ms.toFixed(1),
      maxMs: +Math.max(this.stats.maxMs, ms).toFixed(1),
      lastRowsWritten: written,
    };
  }
  clearAll() {
    this.db.exec('DELETE FROM docs; DELETE FROM store_meta;');
    this.cache.clear();
    this.auditLen.clear();
    this.shape.clear();
  }
  close() {
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      this.db.close();
    } catch {
      /* closed */
    }
  }
}

export class JsonStore {
  constructor(file, crypt = null) {
    this.file = file;
    this.crypt = crypt;
    this.stats = { flushes: 0, lastMs: 0, maxMs: 0, lastRowsWritten: 0 };
  }
  load() {
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch {
      return null;
    }
    if (isEncText(raw)) {
      if (!this.crypt)
        throw new CryptError('STORE_ENCRYPTED_NO_KEY', 'the JSON database is encrypted: set MIHWAR_STORE_KEY');
      raw = this.crypt.dec(raw);
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  save(state) {
    const t0 = performance.now();
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, this.crypt ? this.crypt.enc(JSON.stringify(state)) : JSON.stringify(state));
    fs.renameSync(tmp, this.file);
    const ms = performance.now() - t0;
    this.stats = {
      flushes: this.stats.flushes + 1,
      lastMs: +ms.toFixed(1),
      maxMs: +Math.max(this.stats.maxMs, ms).toFixed(1),
      lastRowsWritten: -1,
    };
  }
  clearAll() {
    try {
      fs.unlinkSync(this.file);
    } catch {
      /* none */
    }
  }
  close() {}
}

// Debounce with a hard upper bound so continuous writes cannot postpone persistence indefinitely.
export function createPersister(flush, { wait = 150, maxWait = 1000 } = {}) {
  let timer = null,
    first = 0;
  const run = () => {
    clearTimeout(timer);
    timer = null;
    first = 0;
    flush();
  };
  return {
    schedule() {
      const now = Date.now();
      if (!first) first = now;
      clearTimeout(timer);
      timer = setTimeout(run, Math.max(0, Math.min(wait, first + maxWait - now)));
    },
    flushNow() {
      if (timer) run();
      else flush();
    },
  };
}

export async function openStore(dataDir, kind = process.env.MIHWAR_STORE || 'sqlite', crypt = null) {
  const jsonFile = path.join(dataDir, 'mihwar-db.json');
  if (kind === 'json') return { store: new JsonStore(jsonFile, crypt), kind: 'json' };
  try {
    const store = new SqliteStore(await openSqlite(path.join(dataDir, 'mihwar.sqlite')), crypt);
    return { store, kind: 'sqlite', jsonFile };
  } catch (e) {
    console.error('SQLite store unavailable (' + (e.code || e.message) + '); falling back to the JSON file store.');
    return { store: new JsonStore(jsonFile, crypt), kind: 'json' };
  }
}
