// SEC-012 / OPS-002: pushes the platform's security signals to the organisation's monitoring. Two sinks, both optional and independent:
//   - a JSON-lines file (DATA_DIR/alerts.log, or MIHWAR_ALERT_LOG) that any log shipper can tail;
//   - an HTTP webhook (MIHWAR_ALERT_WEBHOOK_URL [+ MIHWAR_ALERT_WEBHOOK_TOKEN / _FILE]) that a pager/SIEM receives.
// Each distinct alert is sent once per cool-down (default 30 min). Paging and on-call rotation stay with the receiving system.
import fs from 'node:fs';
import { redactor } from './secrets.mjs';

export function createAlerter(
  engine,
  { logFile, url = '', token = '', coolDownMs = 30 * 60000, fetchImpl = fetch } = {},
) {
  const sent = new Map();
  const stats = { evaluated: 0, delivered: 0, failed: 0, suppressed: 0, last_at: null, last_error: null };
  const red = redactor([token]);
  const keyOf = (a) => `${a.kind}|${a.subject || ''}`;
  async function deliver(a) {
    const rec = {
      at: new Date().toISOString(),
      service: 'mihwar',
      level: a.level,
      kind: a.kind,
      subject: a.subject || null,
      count: a.count ?? null,
      text: a.text,
    };
    if (logFile) {
      try {
        fs.appendFileSync(logFile, JSON.stringify(rec) + '\n');
      } catch (e) {
        stats.last_error = red(e.message);
      }
    }
    if (url) {
      try {
        const r = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(rec),
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) throw new Error(`webhook answered ${r.status}`);
      } catch (e) {
        stats.failed++;
        stats.last_error = red(e.message);
        sent.delete(keyOf(a));
        return false;
      }
    }
    stats.delivered++;
    stats.last_at = rec.at;
    return true;
  }
  async function tick(now = Date.now()) {
    const sig = engine.securitySignals();
    stats.evaluated++;
    for (const a of sig.alerts) {
      const k = keyOf(a);
      const prev = sent.get(k);
      if (prev && now - prev < coolDownMs) {
        stats.suppressed++;
        continue;
      }
      sent.set(k, now);
      await deliver(a);
    }
    for (const [k, t] of sent) if (now - t > coolDownMs * 4) sent.delete(k);
    return sig.alerts.length;
  }
  return { tick, stats, enabled: !!(logFile || url), sinks: { file: !!logFile, webhook: !!url } };
}
