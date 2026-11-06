// Thin fetch wrapper. Two session modes (IAM-008):
//  - cookie mode (production): the server keeps the session in an HttpOnly cookie and answers login with token "cookie"; the page never holds a credential,
//    and every request carries X-Requested-With so the server can refuse cross-site writes;
//  - header mode (demo build): the token lives in sessionStorage (cleared when the tab closes) and is sent as x-session.
const KEY = 'mihwar.session';
let token = null;
try {
  token = sessionStorage.getItem(KEY);
} catch {
  /* storage may be blocked */
}

export const COOKIE = 'cookie';
/** Headers every authenticated request needs. In cookie mode the browser attaches the cookie itself. */
export const authHeaders = () => ({
  'X-Requested-With': 'mihwar',
  ...(token && token !== COOKIE ? { 'x-session': token } : {}),
});
export const session = {
  get token() {
    return token;
  },
  set(t) {
    token = t;
    try {
      t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
let onUnauth = () => {};
export const setUnauthHandler = (fn) => {
  onUnauth = fn;
};
let onReauth = null;
export const setReauthHandler = (fn) => {
  onReauth = fn;
};

export class ApiFail extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function call(method, path, body, query, idemKey, retried = false) {
  const qs = query
    ? '?' +
      new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()
    : '';
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, authHeaders());
  if (method === 'POST')
    headers['Idempotency-Key'] = idemKey || crypto.randomUUID?.() || String(Date.now() + Math.random());
  // FORM-014: a dropped connection is retried twice with back-off. Safe for GET, and for POST because the same Idempotency-Key is reused (the server returns the first result instead of writing twice).
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch('/api/v1' + path + qs, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      break;
    } catch {
      if (attempt >= 2 || !['GET', 'POST'].includes(method))
        throw new ApiFail(0, 'NETWORK', 'تعذّر الاتصال بالخادم. تأكد أنه يعمل ثم أعد المحاولة.');
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1) ** 2));
    }
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const e = data.error || {};
    if (res.status === 401 && token) {
      session.set(null);
      onUnauth(e);
    }
    if (e.code === 'REAUTH_REQUIRED' && onReauth && !retried && (await onReauth()))
      return call(method, path, body, query, idemKey, true);
    throw new ApiFail(res.status, e.code || 'ERROR', e.message || 'تعذّر تنفيذ الطلب', e.details);
  }
  return data;
}
export const api = {
  get: (p, q) => call('GET', p, undefined, q),
  post: (p, b = {}, key) => call('POST', p, b, undefined, key),
  patch: (p, b = {}) => call('PATCH', p, b),
  put: (p, b = {}) => call('PUT', p, b),
};
