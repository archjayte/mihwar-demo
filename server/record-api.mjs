// ARCH-002: preloaded with `node --import server/record-api.mjs` and MIHWAR_RECORD_API=<dir>. Samples a few successful responses per route while the
// test suites run, so the OpenAPI response schemas come from observed behaviour (scripts/record-api.sh). Not loaded in normal operation.
import fs from 'node:fs';
const dir = process.env.MIHWAR_RECORD_API;
if (dir) {
  const seen = new Map();
  let hooked = false;
  const flush = () => {
    try {
      if (!seen.size) return;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}/samples-${process.pid}.json`, JSON.stringify(Object.fromEntries(seen)));
      seen.clear();
    } catch {
      /* ignore */
    }
  };
  globalThis.__MIHWAR_RECORDER__ = (E) => {
    const inner = E.handle;
    E.handle = (req) => {
      const r = inner(req);
      try {
        if (r && r.status < 300 && r.body && typeof r.body === 'object' && !r.body.__binary) {
          const p = (req.path || '/').replace(/^\/api\/v1/, '') || '/';
          const method = req.method || 'GET';
          const route = E.routes.find((x) => x.method === method && x.re.test(p));
          if (route) {
            const k = `${route.method} ${route.pattern}`;
            const a = seen.get(k) || [];
            if (a.length < 8) {
              a.push(JSON.parse(JSON.stringify(r.body)));
              seen.set(k, a);
            }
          }
        }
      } catch {
        /* recording must never affect a request */
      }
      return r;
    };
    if (!hooked) {
      hooked = true;
      process.on('exit', flush);
      for (const sig of ['SIGTERM', 'SIGINT'])
        process.on(sig, () => {
          flush();
          process.exit(0);
        });
    }
  };
}
