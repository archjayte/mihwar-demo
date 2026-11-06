// Outbound delivery of the e-mail / SMS queue. Off unless configured by environment variables (nothing is sent in the default local demo):
//   MIHWAR_SMTP_HOST [MIHWAR_SMTP_PORT=25] [MIHWAR_SMTP_FROM] [MIHWAR_SMTP_USER MIHWAR_SMTP_PASS] [MIHWAR_SMTP_STARTTLS=1]
//   MIHWAR_SMS_WEBHOOK_URL [MIHWAR_SMS_WEBHOOK_TOKEN]   (HTTP POST {to,text,id} — the SMS gateway is whatever receives it)
// Messages carry generic text only (see the content policy in extras.mjs). Failures retry with back-off and end as FAILED after 5 attempts.
import net from 'node:net';
import tls from 'node:tls';
import { readSecret, redactor, maskRecipient } from './secrets.mjs';

export const configFromEnv = (env = process.env) => {
  const strict = env.MIHWAR_DEMO === '0';
  return {
    smtp: env.MIHWAR_SMTP_HOST
      ? {
          host: env.MIHWAR_SMTP_HOST,
          port: Number(env.MIHWAR_SMTP_PORT) || 25,
          from: env.MIHWAR_SMTP_FROM || 'mihwar@localhost',
          user: env.MIHWAR_SMTP_USER || '',
          pass: readSecret('MIHWAR_SMTP_PASS', env, { strict }),
          starttls: env.MIHWAR_SMTP_STARTTLS === '1',
        }
      : null,
    sms: env.MIHWAR_SMS_WEBHOOK_URL
      ? { url: env.MIHWAR_SMS_WEBHOOK_URL, token: readSecret('MIHWAR_SMS_WEBHOOK_TOKEN', env, { strict }) }
      : null,
  };
};

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap = (s) => s.replace(/(.{76})/g, '$1\r\n');

/** Minimal SMTP client (RFC 5321): EHLO, optional STARTTLS, AUTH PLAIN, MAIL/RCPT/DATA. */
export function sendMail(cfg, { to, subject, text }, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let sock = net.connect(cfg.port, cfg.host);
    let buf = '';
    let waiter = null;
    let done = false;
    let tlsOn = false;
    const fail = (e) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    const timer = setTimeout(() => fail(new Error('SMTP timeout')), timeoutMs);
    const attach = () => {
      sock.setEncoding('utf8');
      sock.on('data', (d) => {
        buf += d;
        check();
      });
      sock.on('error', fail);
      sock.on('close', () => {
        if (!done && !waiter?.quit) fail(new Error('SMTP connection closed'));
      });
    };
    const check = () => {
      const lines = buf.split('\r\n');
      if (lines.length < 2) return;
      const last = lines[lines.length - 2];
      if (/^\d{3} /.test(last) && waiter) {
        const w = waiter;
        waiter = null;
        const out = buf;
        buf = '';
        w.resolve({ code: Number(last.slice(0, 3)), text: out });
      }
    };
    const read = () =>
      new Promise((res) => {
        waiter = { resolve: res };
        check();
      });
    const cmd = async (line, expect) => {
      if (line) sock.write(line + '\r\n');
      const r = await read();
      if (!expect.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.text.trim().slice(0, 120)}`);
      return r;
    };
    attach();
    (async () => {
      await cmd(null, [220]);
      let ehlo = await cmd('EHLO mihwar.local', [250]);
      if (cfg.starttls && /STARTTLS/i.test(ehlo.text) && !tlsOn) {
        await cmd('STARTTLS', [220]);
        sock.removeAllListeners('data');
        sock = tls.connect({ socket: sock, servername: cfg.host });
        tlsOn = true;
        attach();
        ehlo = await cmd('EHLO mihwar.local', [250]);
      }
      if (cfg.user) await cmd(`AUTH PLAIN ${b64(`\0${cfg.user}\0${cfg.pass}`)}`, [235]);
      await cmd(`MAIL FROM:<${cfg.from}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd('DATA', [354]);
      const msg = [
        `From: ${cfg.from}`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${b64(subject)}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        `Date: ${new Date().toUTCString()}`,
        '',
        wrap(b64(text)),
        '.',
      ].join('\r\n');
      await cmd(msg, [250]);
      waiter = { quit: true, resolve() {} };
      sock.write('QUIT\r\n');
      done = true;
      clearTimeout(timer);
      sock.end();
      resolve(true);
    })().catch((e) => {
      clearTimeout(timer);
      fail(e);
    });
  });
}

export async function postSms(cfg, item) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}) },
    body: JSON.stringify({ id: item.id, to: item.to, text: item.text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`SMS gateway ${res.status}`);
  return true;
}

/** Processes due items once. Returns {sent, failed, retried}. */
export async function processQueue(engine, cfg, now = Date.now()) {
  const out = { sent: 0, failed: 0, retried: 0 };
  for (const item of engine.state.outbound || []) {
    if (item.status !== 'PENDING' || item.next_at > now) continue;
    const ch = item.channel === 'email' ? cfg.smtp : cfg.sms;
    if (!ch) continue; // channel not configured: item waits
    try {
      if (item.channel === 'email') await sendMail(ch, item);
      else await postSms(ch, item);
      item.status = 'SENT';
      item.sent_at = new Date(now).toISOString();
      out.sent++;
    } catch (e) {
      item.attempts++;
      const red = redactor([ch.pass, ch.token, ch.user]);
      item.last_error = red(e.message).slice(0, 160);
      // INT-011: a failure record carries the channel, a masked recipient and a redacted reason — never the payload text or any credential
      const log = (engine.state.integrationFailures ||= []);
      log.push({
        at: new Date(now).toISOString(),
        channel: item.channel,
        item_id: item.id,
        to: maskRecipient(item.to),
        attempt: item.attempts,
        final: item.attempts >= 5,
        error: item.last_error,
      });
      if (log.length > 300) log.splice(0, log.length - 200);
      if (item.attempts >= 5) {
        item.status = 'FAILED';
        out.failed++;
      } else {
        item.next_at = now + Math.min(3600000, 30000 * 2 ** item.attempts);
        out.retried++;
      }
    }
  }
  if (out.sent || out.failed || out.retried) engine.persist(engine.state);
  return out;
}

export function startRelay(engine, cfg) {
  engine.integrations.email = cfg.smtp
    ? { configured: true, host: cfg.smtp.host, port: cfg.smtp.port, starttls: cfg.smtp.starttls, auth: !!cfg.smtp.user }
    : { configured: false };
  engine.integrations.sms = cfg.sms
    ? { configured: true, gateway_host: new URL(cfg.sms.url).host }
    : { configured: false };
  if (!cfg.smtp && !cfg.sms) return null;
  const t = setInterval(() => {
    processQueue(engine, cfg).catch(() => {});
  }, 5000);
  t.unref?.();
  return t;
}
