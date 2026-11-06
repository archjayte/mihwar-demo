// MIHWAR local server — zero npm dependencies. Binds to 127.0.0.1 only. Synthetic data only.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createEngine } from './engine/core.mjs';
import { loadTemplateCatalog } from './templates-catalog.mjs';
import { buildState } from './engine/seed.mjs';
import { kit } from './auth-kit.mjs';
import { scanner, scannerName, scannerNote } from './scanner.mjs';
import { startRelay, configFromEnv } from './relay.mjs';
import { openStore, createPersister } from './store.mjs';
import { createSealer } from './sealer.mjs';
import { createCrypt, keyFromEnv, isEncBytes } from './crypt.mjs';
import { createAuditMirror } from './audit-mirror.mjs';
import { readSecret } from './secrets.mjs';
import { createAlerter } from './alerts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.MIHWAR_DATA || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 4177);
const HOST = process.env.MIHWAR_HOST || '127.0.0.1'; // local-first; set MIHWAR_HOST=0.0.0.0 only inside a container or behind a reverse proxy
const MAX_BODY = 1_000_000;
const MAX_UPLOAD_BODY = 4_500_000; // 3 MB file as base64 + JSON envelope
const BLOB_DIR = path.join(DATA_DIR, 'blobs');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BLOB_DIR, { recursive: true });
// Encryption at rest (DATA-012): enabled by MIHWAR_STORE_KEY / MIHWAR_STORE_KEY_FILE. A bad or missing key stops the server; it never falls back to seeding an empty database.
let crypt = null;
try {
  crypt = createCrypt(keyFromEnv());
} catch (e) {
  console.error('FATAL: ' + e.message);
  process.exit(1);
}
const diskBlobs = {
  put: (k, d) => fs.writeFileSync(path.join(BLOB_DIR, k.replace(/[^a-f0-9]/gi, '')), crypt ? crypt.encBytes(d) : d),
  get: (k) => {
    try {
      const raw = fs.readFileSync(path.join(BLOB_DIR, String(k).replace(/[^a-f0-9]/gi, '')));
      if (isEncBytes(raw)) {
        if (!crypt) return null;
        return crypt.decBytes(raw);
      }
      return new Uint8Array(raw);
    } catch {
      return null;
    }
  },
  del: (k) => {
    try {
      fs.unlinkSync(path.join(BLOB_DIR, String(k).replace(/[^a-f0-9]/gi, '')));
    } catch {
      /* already gone */
    }
  },
};

const { store, kind: STORE_KIND, jsonFile } = await openStore(DATA_DIR, undefined, crypt);
function loadState() {
  let s = null;
  try {
    s = store.load();
  } catch (e) {
    if (String(e.code || '').startsWith('STORE_')) {
      console.error('FATAL: ' + e.message);
      process.exit(1);
    }
    console.error('store load failed:', e.message);
  }
  if (s?.meta?.seeded) return s;
  // First run on SQLite with an existing JSON file from an earlier version: import it once (the JSON file is left untouched).
  if (STORE_KIND === 'sqlite') {
    try {
      const j = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      if (j?.meta?.seeded) {
        console.log('Imported existing mihwar-db.json into SQLite store.');
        return j;
      }
    } catch {
      /* nothing to import */
    }
  }
  freshDb = true;
  return buildState(Date.now(), diskBlobs);
}
let freshDb = false;

const sealer = createSealer(DATA_DIR);
const MIRROR_DIR = process.env.MIHWAR_AUDIT_MIRROR || path.join(DATA_DIR, 'audit-mirror');
const auditMirror = createAuditMirror(MIRROR_DIR, sealer);
let engine;
const persister = createPersister(() => flush(), { wait: 150, maxWait: 1000 });
const persist = () => persister.schedule();
function flush(state = engine.state) {
  store.save(state);
}

// DATA-010: test (demo) and production datasets are never mixed. The dataset kind is stamped in the database on first start.
//  - demo mode on a production database is refused (it would publish the user list and allow password-less sign-in);
//  - production mode on a demo/synthetic database is refused unless the operator acknowledges it with MIHWAR_ACCEPT_DEMO_DATA=1.
const MODE = process.env.MIHWAR_DEMO === '0' ? 'production' : 'demo';
function guardDataset(state) {
  const kind = state.meta.dataset || 'demo'; // databases created before this check were always demo-seeded
  if (!freshDb && MODE === 'demo' && kind === 'production') {
    console.error(
      'FATAL: this database was created in production mode; refusing to start it with MIHWAR_DEMO enabled. Use a separate MIHWAR_DATA for demonstrations.',
    );
    process.exit(1);
  }
  if (!freshDb && MODE === 'production' && kind === 'demo') {
    if (process.env.MIHWAR_ACCEPT_DEMO_DATA !== '1') {
      console.error(
        'FATAL: this database holds synthetic demo data; refusing to start it in production mode. Use a new MIHWAR_DATA, or set MIHWAR_ACCEPT_DEMO_DATA=1 to convert it knowingly.',
      );
      process.exit(1);
    }
    console.error(
      'WARNING: converting a demo database to production on operator instruction (MIHWAR_ACCEPT_DEMO_DATA=1).',
    );
  }
  state.meta.dataset = MODE;
}
function boot() {
  const state = loadState();
  guardDataset(state);
  engine = createEngine({
    state,
    persist,
    token: () => crypto.randomBytes(24).toString('hex'),
    demo: process.env.MIHWAR_DEMO !== '0',
    blobs: diskBlobs,
    authKit: kit,
    scanner,
    sealer,
    templateCatalog: loadTemplateCatalog(),
  });
  engine.auditSink = auditMirror;
  engine.reset = () => {
    const fresh = buildState(Date.now(), diskBlobs);
    for (const k of Object.keys(engine.state)) delete engine.state[k];
    Object.assign(engine.state, fresh);
    engine.lastTick = 0;
    store.clearAll();
    auditMirror.rotate();
    auditMirror.catchUp(engine.state.audit);
    flush();
  };
  engine.store = { kind: STORE_KIND, stats: () => store.stats };
  engine.atRest = crypt
    ? { enabled: true, algorithm: crypt.algorithm, legacy_plaintext_rows: store.plaintextRows || 0 }
    : { enabled: false };
  engine.dataset = MODE;
  engine.mirror = { dir: MIRROR_DIR, independent: !!process.env.MIHWAR_AUDIT_MIRROR };
  engine.integrations.scanner = scannerName
    ? { configured: true, engine: scannerName }
    : { configured: false, note: scannerNote || 'built-in heuristic scan only' };
  startRelay(engine, configFromEnv());
  const caught = auditMirror.catchUp(engine.state.audit);
  if (caught.mirror_last_seq > caught.live_last_seq)
    console.error(
      `WARNING: audit mirror (seq ${caught.mirror_last_seq}) is ahead of the database (seq ${caught.live_last_seq}) — the database may have been restored from an older copy or rewound. Run: node scripts/verify-audit-mirror.mjs`,
    );
  flush();
}
boot();

// IAM-008: session in an HttpOnly cookie. On by default in production mode, optional elsewhere (MIHWAR_SESSION_COOKIE=1/0).
//  - login responses set `mihwar_sid` (HttpOnly, SameSite=Strict, Path=/api/v1, Secure behind TLS) and the JSON body carries the literal "cookie" instead of the token,
//    so page scripts (and any injected script) never hold a credential;
//  - a request authenticated only by that cookie must also carry `X-Requested-With: mihwar` and, when the browser sends one, a same-host Origin (CSRF defence in depth).
// A request that supplies the x-session header itself (API clients, tests) is unaffected.
const COOKIE_MODE = process.env.MIHWAR_SESSION_COOKIE
  ? process.env.MIHWAR_SESSION_COOKIE === '1'
  : MODE === 'production';
const SID = 'mihwar_sid';
const readSid = (req) =>
  (/(?:^|;\s*)mihwar_sid=([a-f0-9]{16,128})(?:;|$)/.exec(req.headers.cookie || '') || [])[1] || null;
const secureFlag = (req) =>
  (process.env.MIHWAR_TLS_CERT && process.env.MIHWAR_TLS_KEY) ||
  process.env.MIHWAR_HTTPS === '1' ||
  req.headers['x-forwarded-proto'] === 'https'
    ? '; Secure'
    : '';
const setSid = (req, token) =>
  `${SID}=${token}; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=${12 * 3600}${secureFlag(req)}`;
const clearSid = (req) => `${SID}=; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=0${secureFlag(req)}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const SEC = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
};
// HSTS only makes sense on HTTPS: set MIHWAR_HTTPS=1 when this server sits behind a TLS terminator, or it is added when the proxy sends X-Forwarded-Proto: https.
const TLS_CERT = process.env.MIHWAR_TLS_CERT || '';
const TLS_KEY = process.env.MIHWAR_TLS_KEY || '';
const TLS_ON = !!(TLS_CERT && TLS_KEY);
const hsts = (req) =>
  TLS_ON || process.env.MIHWAR_HTTPS === '1' || req.headers['x-forwarded-proto'] === 'https'
    ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
    : {};
// Abuse protection: per-session (or per-address when anonymous) request budget per minute for /api. MIHWAR_RATE_LIMIT=0 disables it (used by the load test).
const RATE = process.env.MIHWAR_RATE_LIMIT === undefined ? 1200 : Number(process.env.MIHWAR_RATE_LIMIT);
const buckets = new Map();
const limited = (req) => {
  if (!RATE) return false;
  const now = Date.now();
  const key = req.headers['x-session'] || req.socket.remoteAddress || 'anon';
  let b = buckets.get(key);
  if (!b || now - b.t0 > 60000) {
    b = { t0: now, n: 0 };
    buckets.set(key, b);
  }
  b.n++;
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.t0 > 60000) buckets.delete(k);
  return b.n > RATE;
};

function sendBinary(res, status, b) {
  const buf = Buffer.from(b.data);
  const fname = encodeURIComponent(b.filename).replace(/['()]/g, escape);
  res.writeHead(status, {
    'Content-Type': b.mime,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${fname}`,
    ...SEC,
    'Content-Security-Policy': "sandbox; default-src 'none'",
  });
  res.end(buf);
}

function sendJson(res, status, body, extra = {}) {
  let buf = Buffer.from(JSON.stringify(body));
  const zip = buf.length > 1024 && /\bgzip\b/.test(res.req?.headers?.['accept-encoding'] || '');
  if (zip) buf = zlib.gzipSync(buf, { level: 4 });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    ...(zip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
    ...SEC,
    ...extra,
  });
  res.end(buf);
}

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.webmanifest', '.txt']);
const ZCACHE = new Map();
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SEC });
      return res.end('Not found');
    }
    const ext = path.extname(file);
    const long = ext === '.woff2';
    const hdr = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': long ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...SEC,
    };
    // Text assets are compressed (brotli, else gzip) and cached in memory per file version; fonts/images are already compressed.
    const enc = COMPRESSIBLE.has(ext)
      ? (req.headers['accept-encoding'] || '').includes('br')
        ? 'br'
        : (req.headers['accept-encoding'] || '').includes('gzip')
          ? 'gzip'
          : null
      : null;
    if (enc) {
      const key = `${file}|${st.mtimeMs}|${enc}`;
      let body = ZCACHE.get(key);
      if (!body) {
        const raw = fs.readFileSync(file);
        body =
          enc === 'br'
            ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
            : zlib.gzipSync(raw, { level: 6 });
        ZCACHE.set(key, body);
      }
      res.writeHead(200, { ...hdr, 'Content-Encoding': enc, Vary: 'Accept-Encoding', 'Content-Length': body.length });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    res.writeHead(200, { ...hdr, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// OPS-002: Prometheus-format metrics at /metrics. Bearer token (MIHWAR_METRICS_TOKEN[_FILE]) when set; otherwise loopback callers only; absent in production without a token.
const METRICS_TOKEN = readSecret('MIHWAR_METRICS_TOKEN', process.env, { strict: MODE === 'production' });
const M = {
  start: Date.now(),
  byClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  hist: [0, 0, 0, 0, 0, 0, 0],
  inf: 0,
  sum: 0,
  count: 0,
};
const observe = (status, sec) => {
  const c = `${Math.floor(status / 100)}xx`;
  if (c in M.byClass) M.byClass[c]++;
  M.count++;
  M.sum += sec;
  let placed = false;
  M.buckets.forEach((b, i) => {
    if (sec <= b) {
      M.hist[i]++;
      placed = true;
    }
  });
  if (!placed) M.inf++;
};
function metricsText() {
  const sig = engine.securitySignals();
  const ver = engine.verifyAudit();
  const L = [];
  const g = (name, help, val, labels = '') => {
    L.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name}${labels} ${val}`);
  };
  g('mihwar_up', 'Server is running', 1);
  g('mihwar_uptime_seconds', 'Seconds since start', Math.round((Date.now() - M.start) / 1000));
  L.push('# HELP mihwar_http_requests_total API requests by status class', '# TYPE mihwar_http_requests_total counter');
  for (const [k, v] of Object.entries(M.byClass)) L.push(`mihwar_http_requests_total{class="${k}"} ${v}`);
  L.push(
    '# HELP mihwar_http_request_duration_seconds API request duration',
    '# TYPE mihwar_http_request_duration_seconds histogram',
  );
  let acc = 0;
  M.buckets.forEach((b, i) => {
    acc += M.hist[i];
    L.push(`mihwar_http_request_duration_seconds_bucket{le="${b}"} ${acc}`);
  });
  L.push(
    `mihwar_http_request_duration_seconds_bucket{le="+Inf"} ${M.count}`,
    `mihwar_http_request_duration_seconds_sum ${M.sum.toFixed(4)}`,
    `mihwar_http_request_duration_seconds_count ${M.count}`,
  );
  g('mihwar_audit_chain_valid', '1 when the audit hash chain verifies', ver.ok ? 1 : 0);
  g('mihwar_audit_records', 'Audit records', engine.state.audit.length);
  g('mihwar_sessions_active', 'Open sessions', Object.keys(engine.state.sessions).length);
  L.push('# HELP mihwar_security_alerts Active security alerts by level', '# TYPE mihwar_security_alerts gauge');
  for (const lv of ['high', 'medium', 'low'])
    L.push(`mihwar_security_alerts{level="${lv}"} ${sig.alerts.filter((a) => a.level === lv).length}`);
  const ob = engine.state.outbound || [];
  L.push('# HELP mihwar_outbound_queue E-mail/SMS queue by status', '# TYPE mihwar_outbound_queue gauge');
  for (const st of ['PENDING', 'SENT', 'FAILED'])
    L.push(`mihwar_outbound_queue{status="${st}"} ${ob.filter((o) => o.status === st).length}`);
  const mem = process.memoryUsage();
  g('mihwar_process_rss_bytes', 'Resident memory', mem.rss);
  g('mihwar_process_heap_used_bytes', 'Heap used', mem.heapUsed);
  const ss = engine.store?.stats?.() || {};
  if (typeof ss.lastSaveMs === 'number') g('mihwar_store_last_save_ms', 'Last store save duration', ss.lastSaveMs);
  g('mihwar_dataset_info', 'Dataset kind (label)', 1, `{kind="${MODE}"}`);
  g('mihwar_at_rest_encryption', '1 when store encryption is on', crypt ? 1 : 0);
  return L.join('\n') + '\n';
}
function handleMetrics(req, res) {
  const auth = req.headers.authorization || '';
  const loop = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const ok = METRICS_TOKEN ? auth === `Bearer ${METRICS_TOKEN}` : MODE !== 'production' && loop;
  if (!ok) {
    res.writeHead(METRICS_TOKEN ? 401 : 404, { 'Content-Type': 'text/plain; charset=utf-8', ...SEC });
    return res.end(METRICS_TOKEN ? 'unauthorized' : 'not found');
  }
  const body = metricsText();
  res.writeHead(200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SEC,
  });
  res.end(body);
}

const handler = (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  const H = hsts(req);
  const w = res.writeHead.bind(res);
  res.writeHead = (st, hd) => w(st, { ...hd, ...H });
  if (url.pathname === '/metrics') return handleMetrics(req, res);
  if (!url.pathname.startsWith('/api/v1/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    return serveStatic(req, res, url.pathname);
  }
  if (limited(req)) {
    res.writeHead(429, {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': '30',
      'Cache-Control': 'no-store',
      ...SEC,
    });
    return res.end(
      JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'طلبات كثيرة خلال دقيقة؛ حاول بعد قليل' } }),
    );
  }
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > (url.pathname === '/api/v1/files' ? MAX_UPLOAD_BODY : MAX_BODY)) {
      sendJson(res, 413, { error: { code: 'TOO_LARGE', message: 'حجم الطلب أكبر من المسموح' } });
      req.destroy();
    } else chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    let body = {};
    if (chunks.length) {
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return sendJson(res, 400, { error: { code: 'BAD_JSON', message: 'صيغة الطلب غير صالحة' } });
      }
    }
    const query = Object.fromEntries(url.searchParams);
    const headers = { ...req.headers };
    let viaCookie = false;
    if (COOKIE_MODE && !headers['x-session']) {
      const sid = readSid(req);
      if (sid) {
        headers['x-session'] = sid;
        viaCookie = true;
      }
    }
    if (viaCookie && req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      let sameOrigin = true;
      if (origin) {
        try {
          sameOrigin = new URL(origin).host === req.headers.host;
        } catch {
          sameOrigin = false;
        }
      }
      if (req.headers['x-requested-with'] !== 'mihwar' || !sameOrigin)
        return sendJson(res, 403, {
          error: { code: 'CSRF_BLOCKED', message: 'طلب غير موثوق المصدر؛ أعد تحميل الصفحة وحاول مجددًا' },
        });
    }
    const t0 = process.hrtime.bigint();
    const r = engine.handle({ method: req.method, path: url.pathname, query, body, headers });
    observe(r.status, Number(process.hrtime.bigint() - t0) / 1e9);
    if (r.body && r.body.__binary) return sendBinary(res, r.status, r.body.__binary);
    const extra = {};
    const p = url.pathname.replace('/api/v1', '');
    if (COOKIE_MODE && r.status < 300 && req.method === 'POST') {
      if ((p === '/auth/login' || p === '/auth/password') && typeof r.body?.token === 'string') {
        extra['Set-Cookie'] = setSid(req, r.body.token);
        r.body = { ...r.body, token: 'cookie' };
      } else if (p === '/auth/logout') extra['Set-Cookie'] = clearSid(req);
    }
    if (COOKIE_MODE && r.status === 401 && viaCookie) extra['Set-Cookie'] = clearSid(req); // dead session: drop the cookie so the login page starts clean
    sendJson(res, r.status, r.body, extra);
  });
};

const tlsOptions = TLS_ON
  ? { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY), minVersion: 'TLSv1.2' }
  : null;
const server = TLS_ON ? https.createServer(tlsOptions, handler) : http.createServer(handler);
server.listen(PORT, HOST, () =>
  console.log(
    `MIHWAR listening on ${TLS_ON ? 'https' : 'http'}://${HOST}:${PORT}  (demo data: synthetic, store: ${STORE_KIND}${TLS_ON ? ', TLS on' : ''})`,
  ),
);
// SEC-002: with TLS on, an optional plain-HTTP listener only redirects to HTTPS (permanent, method preserved). Nothing else is served over HTTP.
const REDIRECT_PORT = Number(process.env.MIHWAR_HTTP_REDIRECT_PORT || 0);
if (TLS_ON && REDIRECT_PORT)
  http
    .createServer((req, res) => {
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      res.writeHead(308, { Location: `https://${host}${PORT === 443 ? '' : ':' + PORT}${req.url}` });
      res.end();
    })
    .listen(REDIRECT_PORT, HOST);
// SEC-012: security signals are pushed to a log file and/or webhook (MIHWAR_ALERT_WEBHOOK_URL), evaluated once a minute.
const alerter = createAlerter(engine, {
  logFile:
    process.env.MIHWAR_ALERT_LOG ||
    (process.env.MIHWAR_ALERT_WEBHOOK_URL || process.env.MIHWAR_ALERT_LOG_ON === '1'
      ? path.join(DATA_DIR, 'alerts.log')
      : ''),
  url: process.env.MIHWAR_ALERT_WEBHOOK_URL || '',
  token: readSecret('MIHWAR_ALERT_WEBHOOK_TOKEN', process.env, { strict: MODE === 'production' }),
  coolDownMs: Number(process.env.MIHWAR_ALERT_COOLDOWN_MIN || 30) * 60000,
});
engine.alerting = alerter;
if (alerter.enabled) {
  const t = setInterval(() => {
    alerter.tick().catch(() => {});
  }, 60000);
  t.unref?.();
}
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    try {
      flush();
      store.close();
    } catch {}
    process.exit(0);
  });
