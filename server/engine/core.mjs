// MIHWAR engine core: routing, sessions, authorization primitives, audit chain, notifications, chat, admin, search.
// Isomorphic: the same module is the authoritative engine in Node and powers the single-file browser demo.
import { validateBody } from './schemas.mjs';
import { ApiError, fail, sha256, dayStr, uniq, clean, isDay } from './util.mjs';
import * as M from './model.mjs';
import { registerProjects } from './projects.mjs';
import { registerRequests } from './requests.mjs';
import { registerInsights } from './insights.mjs';
import { registerExtras, memoryBlobs } from './extras.mjs';
import { registerTemplates } from './templates.mjs';
import { registerAuth } from './auth.mjs';
import { registerRegisters } from './registers.mjs';

/** Single definition of the audit-chain digest (used by the engine, the mirror verifier and the tests). */
export const auditDigest = (prev, r) =>
  sha256(
    prev +
      JSON.stringify([
        r.seq,
        r.at,
        r.actor_id,
        r.action,
        r.object_type,
        r.object_id,
        r.project_id,
        r.from,
        r.to,
        r.reason,
        r.outcome,
        r.delegation_id,
        r.correlation_id || null,
      ]),
  );

const SESSION_TTL = 12 * 3600 * 1000;
const LOGGED_CONFLICTS = [
  'NOT_READY_FOR_RELEASE',
  'FORMAL_APPROVAL_REQUIRED',
  'BASELINE_FROZEN',
  'OPEN_COMMITMENTS',
  'EVIDENCE_REQUIRED',
];

export function emptyState() {
  return {
    meta: { seq: {}, version: 1, createdAt: null },
    orgs: [],
    users: [],
    projects: [],
    workPackages: [],
    requests: [],
    commitments: [],
    tasks: [],
    changeRequests: [],
    issues: [],
    delegations: [],
    competencies: [],
    threads: [],
    messages: [],
    notifications: [],
    audit: [],
    sessions: {},
    idem: {},
    prefs: {},
    files: [],
    fileGrants: [],
    decisions: [],
    breakGlass: [],
    outbox: [],
    orgUnits: [],
    templatesCustom: [],
    templateDrafts: [],
    templateInstances: [],
    templateImports: [],
    templateUse: {},
  };
}

const fnv = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16) + ':' + str.length;
};
export function createEngine({
  state,
  now = () => Date.now(),
  persist = () => {},
  token = null,
  demo = true,
  blobs = null,
  authKit = null,
  scanner = null,
  sealer = null,
  templateCatalog = null,
}) {
  const E = {
    sealer,
    state,
    persist,
    demo,
    _now: now,
    routes: [],
    lastTick: 0,
    loginHits: {},
    blobs: blobs || memoryBlobs(),
    corr: null,
  };
  E.now = () => E._now();
  E.setClock = (fn) => {
    E._now = fn;
  };
  E.iso = () => new Date(E.now()).toISOString();
  E.today = () => dayStr(E.now());
  E.token = token || (() => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join(''));
  E.id = (p) => {
    const s = state.meta.seq;
    s[p] = (s[p] || 0) + 1;
    return `${p}_${s[p]}`;
  };
  E.refNo = (prefix, scope) => {
    const k = `ref_${prefix}_${scope}`;
    const s = state.meta.seq;
    s[k] = (s[k] || 0) + 1;
    return `${prefix}-${scope}-${String(s[k]).padStart(4, '0')}`;
  };

  const find = (arr, id) => arr.find((x) => x.id === id);
  E.user = (id) => find(state.users, id);
  E.org = (id) => find(state.orgs, id);
  E.project = (id) => find(state.projects, id);
  E.wp = (id) => find(state.workPackages, id);
  /** Lets the UI show «who can read this file» only to the owning organisation's supervisors (the server re-checks on every grant call). */
  E.fileGrantInfo = (u, e) => {
    const f = e.file_id ? state.files.find((x) => x.id === e.file_id) : null;
    if (!f || f.owner_org_id !== u.org_id || !E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN')) return { can_grant: false };
    return {
      can_grant: true,
      file_meta: {
        id: f.id,
        project_id: f.project_id,
        name: f.name,
        size: f.size,
        version: f.version,
        sha256: f.sha256,
      },
    };
  };
  E.req = (id) => find(state.requests, id);
  E.task = (id) => find(state.tasks, id);
  E.commitment = (id) => find(state.commitments, id);
  E.uname = (id) => E.user(id)?.name || '—';
  E.oname = (id) => E.org(id)?.name || '—';
  E.orgUsers = (orgId) => state.users.filter((u) => u.org_id === orgId && u.active !== false);
  E.hasRole = (u, ...roles) => roles.some((r) => u.roles.includes(r));

  // ------------------------------------------------------------------ audit (append-only, hash-chained)
  E.audit = (a) => {
    const arr = state.audit;
    const prev = arr.length ? arr[arr.length - 1].hash : 'GENESIS';
    const actor = a.actor_id ? E.user(a.actor_id) : null;
    const rec = {
      seq: arr.length + 1,
      at: E.iso(),
      outcome: 'ok',
      actor_name: actor?.name || a.actor_name || 'النظام',
      org_id: actor?.org_id || a.org_id || null,
      correlation_id: E.corr || null,
      ...a,
      prev,
    };
    rec.hash = auditDigest(prev, rec);
    arr.push(rec);
    E.afterAudit?.(rec);
    try {
      E.auditSink?.(rec);
    } catch (e) {
      console.error('audit sink failed:', e.message);
    }
    return rec;
  };
  E.verifyAudit = () => {
    let prev = 'GENESIS';
    for (const r of state.audit) {
      const h = auditDigest(prev, r);
      if (r.prev !== prev || r.hash !== h) return { ok: false, broken_at: r.seq, total: state.audit.length };
      prev = r.hash;
    }
    return { ok: true, total: state.audit.length, head: prev.slice(0, 16) };
  };

  // ------------------------------------------------------------------ notifications
  E.notify = (userIds, n, exceptId) => {
    for (const uid of uniq(userIds).filter((x) => x && x !== exceptId)) {
      if (!E.user(uid)) continue;
      const rec = {
        id: E.id('ntf'),
        user_id: uid,
        at: E.iso(),
        read: false,
        kind: n.kind || 'info',
        title: n.title,
        body: n.body || '',
        link: n.link || '',
        project_id: n.project_id || null,
      };
      state.notifications.push(rec);
      E.enqueueOutbound?.(uid, rec);
    }
  };

  // ------------------------------------------------------------------ delegations & project access
  E.findDelegation = (user, action, projectId, serviceTypes = null, amount = null) => {
    const t = E.today();
    return (
      state.delegations.find(
        (d) =>
          d.user_id === user.id &&
          d.action === action &&
          !d.revoked &&
          d.org_id === user.org_id &&
          (!d.valid_from || d.valid_from <= t) &&
          (!d.valid_to || d.valid_to >= t) &&
          (d.project_ids.includes('*') || d.project_ids.includes(projectId)) &&
          (!serviceTypes || d.service_types.includes('*') || serviceTypes.every((s) => d.service_types.includes(s))) &&
          (!(amount > 0) || d.max_amount == null || d.max_amount >= amount),
      ) || null
    );
  };
  E.committeeRole = (user, p) => {
    if (!p?.committee) return null;
    if (p.committee.chair_id === user.id) return 'chair';
    if (p.committee.deputy_id && p.committee.deputy_id === user.id) return 'deputy';
    if (p.committee.secretary_id === user.id) return 'secretary';
    if (p.committee.member_ids.includes(user.id)) return 'member';
    return null;
  };
  E.orgParticipates = (orgId, p) => p.org_ids.includes(orgId) || p.lead_org_id === orgId;
  E.access = (user, p) => {
    if (!p) return 'none';
    if (E.hasRole(user, 'SUPER_ADMIN')) return E.breakGlassOk?.(user, p.id) ? 'viewer' : 'none'; // read-only, only while an approved break-glass window is open
    if (E.committeeRole(user, p) || E.orgParticipates(user.org_id, p)) return 'member';
    if (E.hasRole(user, 'FINAL_AUDITOR')) return 'viewer';
    if (E.hasRole(user, 'PLATFORM_OWNER_ADMIN')) return 'meta';
    return 'none';
  };
  E.needProject = (user, id, min = 'member') => {
    const p = E.project(id);
    const lvl = E.access(user, p);
    if (lvl === 'none') fail(404, 'NOT_FOUND', 'المشروع غير موجود أو لا تملك صلاحية الاطلاع عليه');
    if (lvl === 'viewer' && E.hasRole(user, 'SUPER_ADMIN'))
      E.audit({
        actor_id: user.id,
        action: 'break_glass.read',
        object_type: 'project',
        object_id: p.id,
        project_id: p.id,
        detail: 'قراءة ضمن نافذة وصول استثنائي',
      });
    const rank = { meta: 1, viewer: 2, member: 3 };
    if (rank[lvl] < rank[min]) fail(403, 'READ_ONLY_ROLE', 'صفتك الحالية لا تتيح هذا الإجراء أو هذا المحتوى');
    return p;
  };
  E.caps = (user, p) => {
    const lvl = E.access(user, p);
    const cr = E.committeeRole(user, p);
    const lead = user.org_id === p.lead_org_id;
    const org = E.orgParticipates(user.org_id, p);
    const coord = lead && E.hasRole(user, 'COORDINATING_ADMIN');
    const sup = org && E.hasRole(user, 'ORG_SUPERVISOR', 'ORG_ADMIN');
    return {
      level: lvl,
      committee_role: cr,
      lead,
      org_member: org,
      manage_project: coord,
      create_wp: coord && p.status !== 'CLOSED',
      create_request: lvl === 'member' && org && !E.hasRole(user, 'SCOPED_VIEWER') && p.status !== 'CLOSED',
      triage: cr === 'chair' || cr === 'secretary',
      refer: !!E.findDelegation(user, 'route', p.id),
      release: !!E.findDelegation(user, 'release', p.id),
      review_deliverable: !!E.findDelegation(user, 'accept_deliverable', p.id),
      approve_change: !!E.findDelegation(user, 'approve_change', p.id),
      create_task: sup,
      submit_request: !!E.findDelegation(user, 'submit_request', p.id),
      commit: !!E.findDelegation(user, 'commit', p.id),
    };
  };
  E.projectsFor = (user) => state.projects.filter((p) => E.access(user, p) !== 'none');
  E.projectMembers = (p) =>
    uniq(
      [
        ...state.users.filter((u) => E.orgParticipates(u.org_id, p)).map((u) => u.id),
        p.committee.chair_id,
        p.committee.deputy_id,
        p.committee.secretary_id,
        ...p.committee.member_ids,
      ].filter(Boolean),
    );

  // ------------------------------------------------------------------ routing
  E.route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/:([a-z_]+)/g, (_, k) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '/?$',
    );
    E.routes.push({ method, pattern, re, keys, handler, opts });
  };

  E.handle = ({ method = 'GET', path = '/', query = {}, body = {}, headers = {} }) => {
    let ctx = null;
    try {
      const p = path.replace(/^\/api\/v1/, '') || '/';
      let route = null;
      const params = {};
      for (const r of E.routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(p);
        if (m) {
          route = r;
          r.keys.forEach((k, i) => {
            params[k] = decodeURIComponent(m[i + 1]);
          });
          break;
        }
      }
      if (!route) fail(404, 'NOT_FOUND', 'المسار غير موجود');
      let user = null;
      const tok = headers['x-session'];
      if (!route.opts.public) {
        const s = tok && state.sessions[tok];
        if (!s) fail(401, 'UNAUTHENTICATED', 'سجّل الدخول للمتابعة');
        if (E.now() - s.last > SESSION_TTL) {
          delete state.sessions[tok];
          fail(401, 'SESSION_EXPIRED', 'انتهت الجلسة، سجّل الدخول من جديد');
        }
        s.last = E.now();
        if (s.limited && !route.opts.limitedOk)
          fail(
            403,
            s.limited,
            s.limited === 'MFA_SETUP_REQUIRED'
              ? 'دورك الإداري يتطلب تفعيل التحقق الثنائي قبل المتابعة'
              : 'غيّر كلمة المرور المؤقتة قبل المتابعة',
          );
        user = E.user(s.user_id);
        if (!user || user.active === false) fail(401, 'UNAUTHENTICATED', 'الحساب غير نشط');
      }
      ctx = {
        user,
        params,
        query,
        body: body && typeof body === 'object' ? body : {},
        headers,
        E,
        token: tok,
        status: 200,
        route,
      };
      E.corr =
        (headers['x-correlation-id'] && String(headers['x-correlation-id']).slice(0, 40)) ||
        'c-' + E.token().slice(0, 10);
      E.maybeTick();
      if (method !== 'GET' && method !== 'DELETE') {
        const bad = validateBody(`${method} ${route.pattern}`, ctx.body);
        if (Object.keys(bad).length) fail(422, 'VALIDATION', 'راجع الحقول المحددة ثم أعد المحاولة', { fields: bad });
      }
      const idemKey = method === 'POST' && headers['idempotency-key'];
      const idemId = idemKey ? `${user?.id}|${p}|${idemKey}` : null;
      const fp = idemId ? fnv(JSON.stringify(ctx.body)) : null; // change detector only (cheap on large bodies), not a security hash
      if (idemId && state.idem[idemId]) {
        const prev = state.idem[idemId];
        if (prev.fp && prev.fp !== fp)
          fail(422, 'IDEMPOTENCY_MISMATCH', 'استُخدم مفتاح التكرار نفسه مع طلب مختلف؛ أنشئ مفتاحًا جديدًا');
        return { status: prev.status, body: prev.body };
      }
      const data = route.handler(ctx) ?? {};
      const res = { status: ctx.status, body: data };
      if (data && data.__binary) {
        E.corr = null;
        return res;
      }
      if (idemId) {
        state.idem[idemId] = { ...res, fp };
        const keys = Object.keys(state.idem);
        if (keys.length > 400) delete state.idem[keys[0]];
      }
      if (method !== 'GET') E.persist(state);
      E.corr = null;
      return res;
    } catch (e) {
      if (!(e instanceof ApiError)) {
        console.error(e);
        return { status: 500, body: { error: { code: 'INTERNAL', message: 'حدث خطأ غير متوقع في الخادم' } } };
      }
      if (method !== 'GET' && ctx?.user && (e.status === 403 || LOGGED_CONFLICTS.includes(e.code))) {
        E.audit({
          actor_id: ctx.user.id,
          action: `denied:${method} ${ctx.route.pattern}`,
          object_type: 'attempt',
          object_id: ctx.params.id || '-',
          project_id: e.details?.project_id || null,
          outcome: 'denied',
          reason: e.code,
        });
        E.persist(state);
      }
      const corr = E.corr;
      E.corr = null;
      return {
        status: e.status,
        body: { error: { code: e.code, message: e.message, details: e.details, correlation_id: corr || undefined } },
      };
    }
  };

  E.maybeTick = () => {
    if (E.now() - E.lastTick > 60000) {
      E.lastTick = E.now();
      E.tickRequests?.();
    }
  };

  // ------------------------------------------------------------------ auth + demo
  const publicUser = (u) => ({
    id: u.id,
    name: u.name,
    title: u.title,
    org_id: u.org_id,
    org_name: E.oname(u.org_id),
    roles: u.roles,
    role_labels: u.roles.map((r) => M.ROLE_LABEL[r]).filter(Boolean),
  });

  E.buildNav = (u) => {
    if (E.hasRole(u, 'SUPER_ADMIN')) return ['home', 'settings'];
    const inCommittee = state.projects.some((p) => E.committeeRole(u, p));
    const orgPart = state.projects.some((p) => E.orgParticipates(u.org_id, p));
    const delegated = state.delegations.some((d) => d.user_id === u.id && !d.revoked);
    // an organisation leader prepares and answers requests, commits the organisation and follows its decisions;
    // a plain executive (منفّذ) only works on the tasks assigned to them, so the menu shows that work and nothing else
    const leader = E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || delegated;
    const executiveOnly =
      !inCommittee &&
      !leader &&
      !E.hasRole(
        u,
        'COORDINATING_ADMIN',
        'FINAL_AUDITOR',
        'INDEPENDENT_REVIEWER',
        'PLATFORM_OWNER_ADMIN',
        'SCOPED_VIEWER',
        'TEMPLATE_CATALOG_EDITOR',
        'TEMPLATE_REVIEWER',
      );
    const nav = ['home', 'projects'];
    if (!executiveOnly && !E.hasRole(u, 'FINAL_AUDITOR', 'INDEPENDENT_REVIEWER')) nav.push('templates');
    if ((orgPart && !executiveOnly) || inCommittee) nav.push('requests');
    if (inCommittee) nav.push('committee');
    if (orgPart) nav.push('tasks');
    if ((orgPart && !executiveOnly) || inCommittee) nav.push('commitments');
    if (orgPart || inCommittee || E.hasRole(u, 'FINAL_AUDITOR', 'INDEPENDENT_REVIEWER')) nav.push('messages');
    if (!executiveOnly) nav.push('reports');
    if (orgPart && E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN')) nav.splice(nav.indexOf('tasks') + 1, 0, 'orgtasks');
    if (
      inCommittee ||
      E.hasRole(
        u,
        'COORDINATING_ADMIN',
        'ORG_ADMIN',
        'FINAL_AUDITOR',
        'PLATFORM_OWNER_ADMIN',
        'INDEPENDENT_REVIEWER',
      ) ||
      state.delegations.some((d) => d.user_id === u.id && !d.revoked)
    )
      nav.splice(nav.indexOf('projects') + 1, 0, 'overview');
    if (!executiveOnly && !E.hasRole(u, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN'))
      nav.splice(nav.indexOf('reports'), 0, 'decisions', 'evidence');
    if (
      inCommittee ||
      E.hasRole(
        u,
        'COORDINATING_ADMIN',
        'ORG_ADMIN',
        'FINAL_AUDITOR',
        'PLATFORM_OWNER_ADMIN',
        'INDEPENDENT_REVIEWER',
      ) ||
      state.delegations.some((d) => d.user_id === u.id && !d.revoked)
    )
      nav.push('governance');
    nav.push('settings');
    return nav;
  };

  E.route(
    'GET',
    '/demo/users',
    () =>
      !E.demo
        ? { demo: false, users: [], orgs: [] }
        : {
            // production mode: never publish the user directory before sign-in
            demo: E.demo,
            users: state.users
              .filter((u) => u.active !== false)
              .map((u) => ({
                ...publicUser(u),
                committee: state.projects
                  .filter((p) => E.committeeRole(u, p))
                  .map((p) => M.COMMITTEE_ROLE_LABEL[E.committeeRole(u, p)])
                  .filter((x, i, a) => a.indexOf(x) === i),
                hint: u.hint,
              })),
            orgs: state.orgs.map((o) => ({ id: o.id, name: o.name })),
          },
    { public: true },
  );

  E.route(
    'POST',
    '/auth/login',
    (ctx) => {
      if (!E.demo) fail(403, 'DEMO_ONLY', 'الدخول التجريبي معطّل في هذه البيئة');
      const hits = (E.loginHits[ctx.headers['x-forwarded-for'] || 'local'] ||= []);
      const t = E.now();
      while (hits.length && t - hits[0] > 60000) hits.shift();
      if (hits.length >= 40) fail(429, 'RATE_LIMITED', 'محاولات كثيرة، حاول بعد دقيقة');
      hits.push(t);
      const u = E.user(clean(ctx.body.user_id, 80));
      if (!u || u.active === false) fail(401, 'UNKNOWN_USER', 'مستخدم غير معروف');
      const tok = E.token();
      state.sessions[tok] = { user_id: u.id, created: t, last: t };
      E.audit({ actor_id: u.id, action: 'login', object_type: 'session', object_id: u.id });
      return { token: tok, user: publicUser(u) };
    },
    { public: true },
  );

  E.route(
    'POST',
    '/auth/logout',
    (ctx) => {
      delete state.sessions[ctx.token];
      return { ok: true };
    },
    { limitedOk: true },
  );

  E.route(
    'GET',
    '/me',
    (ctx) => {
      const u = ctx.user;
      const delegations = state.delegations
        .filter((d) => d.user_id === u.id && !d.revoked)
        .map((d) => ({
          id: d.id,
          action: d.action,
          label: M.DELEGATION_LABEL[d.action],
          project_ids: d.project_ids,
          service_types: d.service_types,
          valid_to: d.valid_to,
          basis: d.basis,
        }));
      return {
        user: publicUser(u),
        demo: E.demo,
        limited: state.sessions[ctx.token]?.limited || null,
        auth: state.sessions[ctx.token]?.auth || 'demo',
        today: E.today(),
        nav: E.buildNav(u),
        delegations,
        committee: state.projects
          .filter((p) => E.committeeRole(u, p))
          .map((p) => ({
            project_id: p.id,
            project_name: p.name,
            role: E.committeeRole(u, p),
            label: M.COMMITTEE_ROLE_LABEL[E.committeeRole(u, p)],
          })),
        prefs: state.prefs[u.id] || {},
        unread: state.notifications.filter((n) => n.user_id === u.id && !n.read).length,
        unread_messages: state.threads
          .filter((t) => t.member_ids.includes(u.id))
          .reduce(
            (n, t) =>
              n +
              state.messages.filter((m) => m.thread_id === t.id && m.seq > (t.reads?.[u.id] || 0) && m.user_id !== u.id)
                .length,
            0,
          ),
      };
    },
    { limitedOk: true },
  );

  E.route('PUT', '/me/prefs', (ctx) => {
    const cur = state.prefs[ctx.user.id] || {};
    const b = ctx.body;
    if (b.widgets && typeof b.widgets === 'object')
      cur.widgets = {
        order: (b.widgets.order || []).slice(0, 30).map((x) => clean(x, 40)),
        hidden: (b.widgets.hidden || []).slice(0, 30).map((x) => clean(x, 40)),
        sizes: Object.fromEntries(
          Object.entries(b.widgets.sizes && typeof b.widgets.sizes === 'object' ? b.widgets.sizes : {})
            .slice(0, 30)
            .filter(([, v]) => ['sm', 'md', 'lg'].includes(v))
            .map(([k, v]) => [clean(k, 40), v]),
        ),
      };
    if (typeof b.last_project === 'string') cur.last_project = clean(b.last_project, 40);
    if (Array.isArray(b.pinned)) cur.pinned = [...new Set(b.pinned.map((x) => clean(x, 40)))].slice(0, 12);
    if (typeof b.dismissed_guide === 'boolean') cur.dismissed_guide = b.dismissed_guide;
    state.prefs[ctx.user.id] = cur;
    return { prefs: cur };
  });

  E.route(
    'POST',
    '/demo/reset',
    () => {
      if (!E.demo) fail(403, 'DEMO_ONLY', 'إعادة التهيئة متاحة في الوضع التجريبي فقط');
      E.reset?.();
      return { ok: true };
    },
    { public: true },
  );

  // UX-012 / OPS-008: platform-wide maintenance or outage notice, readable before sign-in, written only by the platform operator.
  E.route(
    'GET',
    '/system/notice',
    () => ({
      notice:
        state.meta.notice && (!state.meta.notice.until || Date.parse(state.meta.notice.until) > E.now())
          ? state.meta.notice
          : null,
    }),
    { public: true },
  );
  E.route('PUT', '/system/notice', (ctx) => {
    if (!E.hasRole(ctx.user, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN'))
      fail(403, 'NO_PERMISSION', 'متاح لمشغّل المنصة ومالكها فقط');
    const b = ctx.body || {};
    const text = clean(b.text, 400);
    if (!text) {
      delete state.meta.notice;
      E.audit({
        actor_id: ctx.user.id,
        action: 'system.notice.clear',
        object_type: 'system',
        object_id: 'notice',
        outcome: 'ok',
      });
      return { notice: null };
    }
    const level = ['info', 'warn', 'outage'].includes(b.level) ? b.level : 'info';
    const until = b.until && !Number.isNaN(Date.parse(b.until)) ? new Date(b.until).toISOString() : null;
    state.meta.notice = { level, text, until, by: ctx.user.id, at: new Date(E.now()).toISOString() };
    E.audit({
      actor_id: ctx.user.id,
      action: 'system.notice.set',
      object_type: 'system',
      object_id: 'notice',
      outcome: 'ok',
      after: { level, until },
    });
    return { notice: state.meta.notice };
  });

  // SEC-012: suspicious-event signals computed from the tamper-evident audit log. This is the feed an external monitor/SIEM would poll; paging/on-call itself is not part of the platform.
  E.securitySignals = (windowMs = 15 * 60000, dayMs = 24 * 3600000) => {
    const t = E.now();
    const recent = [];
    const day = [];
    for (let i = state.audit.length - 1; i >= 0; i--) {
      const a = state.audit[i];
      const age = t - Date.parse(a.at);
      if (age > dayMs) break;
      day.push(a);
      if (age <= windowMs) recent.push(a);
    }
    const by = (list, f) =>
      list.reduce((m, a) => {
        const k = a.actor_id || a.actor_name;
        if (f(a)) m[k] = (m[k] || 0) + 1;
        return m;
      }, {});
    const failedLogin = by(recent, (a) => a.action === 'denied:login');
    const denied = by(recent, (a) => String(a.action).startsWith('denied:') && a.action !== 'denied:login');
    const alerts = [];
    for (const [k, n] of Object.entries(failedLogin))
      if (n >= 5)
        alerts.push({
          level: 'high',
          kind: 'repeated_failed_login',
          subject: E.user(k)?.name || k,
          count: n,
          window_min: windowMs / 60000,
          text: 'محاولات دخول فاشلة متكررة (تخمين كلمة مرور محتمل)',
        });
    for (const [k, n] of Object.entries(denied))
      if (n >= 10)
        alerts.push({
          level: 'medium',
          kind: 'repeated_denied_actions',
          subject: E.user(k)?.name || k,
          count: n,
          window_min: windowMs / 60000,
          text: 'محاولات وصول مرفوضة متكررة من حساب واحد',
        });
    for (const a of day) {
      if (a.action === 'mfa.disable')
        alerts.push({
          level: 'medium',
          kind: 'mfa_disabled',
          subject: a.actor_name,
          at: a.at,
          text: 'عُطّل التحقق الثنائي لحساب',
        });
      if (a.action === 'password.reset')
        alerts.push({
          level: 'info',
          kind: 'password_reset',
          subject: a.object_id,
          at: a.at,
          text: 'أُعيد تعيين كلمة مرور',
        });
    }
    const bg = (state.breakGlass || []).filter((b) => b.status === 'ACTIVE').length;
    if (bg)
      alerts.push({ level: 'high', kind: 'break_glass_active', count: bg, text: 'وصول طارئ (كسر الزجاج) فعّال الآن' });
    return {
      generated_at: E.iso(),
      window_minutes: windowMs / 60000,
      last_24h: {
        failed_logins: day.filter((a) => a.action === 'denied:login').length,
        denied_actions: day.filter((a) => String(a.action).startsWith('denied:')).length,
        logins: day.filter((a) => a.action === 'login').length,
      },
      alerts,
      note: 'قراءة من سجل التدقيق. الإنذار والمناوبة خارج المنصة؛ اربط هذه النقطة بأداة المراقبة في المؤسسة.',
    };
  };
  E.route('GET', '/system/security-signals', (ctx) => {
    if (!E.hasRole(ctx.user, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN'))
      fail(403, 'NO_PERMISSION', 'متاح لمشغّل المنصة ومالكها فقط');
    return E.securitySignals();
  });
  E.route('GET', '/system/health', (ctx) => {
    if (!E.hasRole(ctx.user, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN'))
      fail(403, 'NO_PERMISSION', 'متاح لمشغّل المنصة ومالكها فقط');
    return {
      counts: {
        users: state.users.length,
        orgs: state.orgs.length,
        projects: state.projects.length,
        requests: state.requests.length,
        tasks: state.tasks.length,
        sessions: Object.keys(state.sessions).length,
      },
      audit: E.verifyAudit(),
      demo: E.demo,
      store: E.store ? { kind: E.store.kind, ...E.store.stats() } : undefined,
      at_rest: E.atRest || { enabled: false },
      alerting: E.alerting
        ? { enabled: E.alerting.enabled, sinks: E.alerting.sinks, ...E.alerting.stats }
        : { enabled: false },
      security: (() => {
        const g = E.securitySignals();
        return { alerts: g.alerts.filter((a) => a.level !== 'info').length, last_24h: g.last_24h };
      })(),
      dataset: E.dataset || 'demo',
      seal: E.sealer ? { alg: E.sealer.algorithm, key_id: E.sealer.keyId } : null,
      audit_mirror: E.mirror ? { configured_outside_data_folder: E.mirror.independent } : null,
      note: 'أرقام تشغيلية مجمّعة فقط؛ لا يُعرض محتوى الجهات.',
    };
  });

  // ------------------------------------------------------------------ notifications
  E.route('GET', '/notifications', (ctx) => {
    const list = state.notifications
      .filter((n) => n.user_id === ctx.user.id)
      .slice(-60)
      .reverse();
    return { items: list, unread: list.filter((n) => !n.read).length };
  });
  E.route('POST', '/notifications/read', (ctx) => {
    const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids : null;
    state.notifications.forEach((n) => {
      if (n.user_id === ctx.user.id && (!ids || ids.includes(n.id))) n.read = true;
    });
    return { ok: true };
  });

  // ------------------------------------------------------------------ chat (MIHWAR Connect) — messages never constitute decisions
  const threadView = (t, u) => {
    const msgs = state.messages.filter((m) => m.thread_id === t.id);
    const last = msgs[msgs.length - 1];
    const readAt = t.reads?.[u.id] || 0;
    return {
      id: t.id,
      kind: t.kind,
      kind_label: M.THREAD_KINDS[t.kind] || t.kind,
      wp_id: t.wp_id || null,
      wp_ref: t.wp_id ? E.wp(t.wp_id)?.ref : null,
      title: t.title,
      project_id: t.project_id,
      project_name: t.project_id ? E.project(t.project_id)?.name : null,
      request_id: t.request_id || null,
      request_ref: t.request_id ? E.req(t.request_id)?.ref : null,
      members: t.member_ids.map((id) => ({ id, name: E.uname(id), org: E.oname(E.user(id)?.org_id) })),
      last: last ? { text: last.text.slice(0, 120), at: last.at, by: E.uname(last.user_id) } : null,
      unread: msgs.filter((m) => m.seq > readAt && m.user_id !== u.id).length,
      count: msgs.length,
    };
  };
  E.threadFor = (id, user) => {
    const t = find(state.threads, id);
    if (!t || !t.member_ids.includes(user.id)) fail(404, 'NOT_FOUND', 'المحادثة غير موجودة أو لست عضوًا فيها');
    return t;
  };
  E.createThread = ({ project_id, kind, title, member_ids, request_id, created_by }) => {
    const t = {
      id: E.id('thr'),
      project_id: project_id || null,
      kind,
      title,
      member_ids: uniq(member_ids),
      request_id: request_id || null,
      created_by,
      created_at: E.iso(),
      reads: {},
    };
    state.threads.push(t);
    return t;
  };
  E.postMessage = (t, userId, text) => {
    const seq = (state.meta.seq.msg = (state.meta.seq.msg || 0) + 1);
    const m = { id: E.id('msg'), seq, thread_id: t.id, user_id: userId, text: clean(text, 3000), at: E.iso() };
    state.messages.push(m);
    t.reads[userId] = seq;
    return m;
  };

  E.route('GET', '/threads', (ctx) => {
    const { project_id, request_id } = ctx.query;
    const list = state.threads.filter(
      (t) =>
        t.member_ids.includes(ctx.user.id) &&
        (!project_id || t.project_id === project_id) &&
        (!request_id || t.request_id === request_id),
    );
    return {
      items: list
        .map((t) => threadView(t, ctx.user))
        .sort((a, b) => (b.last?.at || '').localeCompare(a.last?.at || '')),
    };
  });
  E.route('POST', '/threads', (ctx) => {
    const { project_id, title, member_ids = [], kind = 'project', wp_id } = ctx.body;
    const u = ctx.user;
    if (!Object.keys(M.THREAD_KINDS).includes(kind) || kind === 'request') fail(422, 'BAD_KIND', 'نوع محادثة غير صالح');
    let p = null;
    let wp = null;
    if (kind === 'wp') {
      wp = E.wp(clean(wp_id, 40));
      if (!wp) fail(422, 'BAD_WP', 'اختر حزمة العمل');
      p = E.needProject(u, wp.project_id, 'member');
    } else if (project_id && kind !== 'support') p = E.needProject(u, project_id, 'member');
    if (['project', 'wp'].includes(kind) && !p) fail(422, 'MISSING_PROJECT', 'اختر المشروع');
    const t0 = clean(title, 120) || (wp ? `${wp.ref} — ${wp.title}` : '');
    if (!t0) fail(422, 'MISSING_TITLE', 'اكتب عنوانًا واضحًا للمحادثة');
    let ids = member_ids.map((x) => clean(x, 40));
    if (kind === 'support') {
      if (E.hasRole(u, 'PLATFORM_OWNER_ADMIN')) fail(422, 'BAD_KIND', 'محادثة الدعم يبدؤها مستخدمو الجهات');
      ids = state.users.filter((x) => x.active && x.roles.includes('PLATFORM_OWNER_ADMIN')).map((x) => x.id);
    }
    const members = uniq([u.id, ...ids]);
    for (const id of members) {
      const m = E.user(id);
      if (!m) fail(422, 'UNKNOWN_MEMBER', 'عضو غير معروف');
      if (['org', 'team'].includes(kind) && m.org_id !== u.org_id)
        fail(403, 'WRONG_ORGANIZATION', 'المحادثة الداخلية لأعضاء الجهة فقط');
      if (p && kind !== 'support' && !(E.committeeRole(m, p) || E.orgParticipates(m.org_id, p)))
        fail(403, 'NOT_PROJECT_MEMBER', `«${m.name}» ليس من أطراف هذا المشروع`);
    }
    if (kind === 'direct' && members.length !== 2) fail(422, 'BAD_MEMBERS', 'المحادثة الفردية بين شخصين');
    if (kind === 'org')
      for (const x of E.orgUsers(u.org_id)) if (!members.includes(x.id) && x.active) members.push(x.id); // whole-organisation channel
    const t = E.createThread({ project_id: p?.id, kind, title: t0, member_ids: members, created_by: u.id });
    if (wp) t.wp_id = wp.id;
    E.audit({
      actor_id: u.id,
      action: 'thread.create',
      object_type: 'thread',
      object_id: t.id,
      project_id: p?.id,
      detail: kind,
    });
    ctx.status = 201;
    return { thread: threadView(t, u) };
  });
  const msgView = (u, m) => ({
    id: m.id,
    seq: m.seq,
    text: m.text,
    at: m.at,
    user_id: m.user_id,
    by: E.uname(m.user_id),
    org: E.oname(E.user(m.user_id)?.org_id),
    mine: m.user_id === u.id,
    mentions: (m.mentions || []).map((id) => ({ id, name: E.uname(id) })),
    mentioned_me: (m.mentions || []).includes(u.id),
    attachments: (m.attachments || []).map((a) => ({
      ...a,
      can_download: !!E.file(a.file_id) && E.canReadFile(u, E.file(a.file_id)),
    })),
  });
  E.route('GET', '/threads/:id', (ctx) => {
    const t = E.threadFor(ctx.params.id, ctx.user);
    const msgs = state.messages.filter((m) => m.thread_id === t.id).slice(-200);
    return { thread: threadView(t, ctx.user), messages: msgs.map((m) => msgView(ctx.user, m)) };
  });
  E.route('POST', '/threads/:id/messages', (ctx) => {
    const t = E.threadFor(ctx.params.id, ctx.user);
    const u = ctx.user;
    const b = ctx.body;
    const text = clean(b.text, 3000);
    const fileIds = Array.isArray(b.file_ids) ? uniq(b.file_ids.map((x) => clean(x, 40))).slice(0, 5) : [];
    if (!text && !fileIds.length) fail(422, 'EMPTY_MESSAGE', 'اكتب نص الرسالة');
    // mentions: explicit ids plus exact "@name" occurrences; only members of this thread can be mentioned
    const mentions = uniq([
      ...(Array.isArray(b.mentions) ? b.mentions.map((x) => clean(x, 40)) : []),
      ...t.member_ids.filter((id) => text.includes('@' + E.uname(id))),
    ]);
    for (const id of mentions)
      if (!t.member_ids.includes(id)) fail(422, 'MENTION_NOT_MEMBER', 'لا يمكن الإشارة إلى من ليس عضوًا في المحادثة');
    const attachments = [];
    for (const fid of fileIds) {
      const f = E.file(fid);
      if (!f || !E.canReadFile(u, f)) fail(404, 'NOT_FOUND', 'الملف المرفق غير موجود أو لا تملك الاطلاع عليه');
      if (!t.project_id || f.project_id !== t.project_id || t.kind === 'support')
        fail(422, 'ATTACHMENT_SCOPE', 'يُرفق في محادثات المشروع ملفٌ مرفوع إلى المشروع نفسه فقط');
      for (const id of t.member_ids)
        if (E.user(id).org_id !== f.owner_org_id) E.addGrant(f, 'user', id, u, `مرفق في محادثة «${t.title}»`);
      attachments.push({ file_id: f.id, name: f.name, size: f.size });
    }
    const m = E.postMessage(t, u.id, text);
    m.mentions = mentions;
    m.attachments = attachments;
    if (attachments.length)
      E.audit({
        actor_id: u.id,
        action: 'thread.attach',
        object_type: 'thread',
        object_id: t.id,
        project_id: t.project_id,
        detail: attachments
          .map((a) => a.name)
          .join('، ')
          .slice(0, 160),
      });
    E.notify(
      mentions.filter((id) => id !== u.id),
      {
        kind: 'mention',
        title: `ذكرك ${u.name} في «${t.title}»`,
        body: text.slice(0, 90),
        link: `#/messages/${t.id}`,
        project_id: t.project_id,
      },
      u.id,
    );
    E.notify(
      t.member_ids.filter((id) => !mentions.includes(id)),
      {
        kind: 'message',
        title: `رسالة جديدة: ${t.title}`,
        body: `${u.name}: ${text.slice(0, 80) || '📎 مرفق'}`,
        link: `#/messages/${t.id}`,
        project_id: t.project_id,
      },
      u.id,
    );
    ctx.status = 201;
    return { message: msgView(u, m) };
  });
  E.route('POST', '/threads/:id/read', (ctx) => {
    const t = E.threadFor(ctx.params.id, ctx.user);
    t.reads[ctx.user.id] = state.meta.seq.msg || 0;
    return { ok: true };
  });

  // ------------------------------------------------------------------ admin: delegations & competencies
  const GRANT_BY_ORG_ADMIN = ['submit_request', 'commit', 'accept_deliverable', 'approve_change'];
  const GRANT_BY_COORD = ['route', 'release', 'close_request'];
  const dlgView = (d) => ({
    ...d,
    user_name: E.uname(d.user_id),
    org_name: E.oname(d.org_id),
    action_label: M.DELEGATION_LABEL[d.action],
    granted_by_name: E.uname(d.granted_by),
  });

  E.route('GET', '/admin/overview', (ctx) => {
    const u = ctx.user;
    const isOwner = E.hasRole(u, 'PLATFORM_OWNER_ADMIN');
    const isOrgAdmin = E.hasRole(u, 'ORG_ADMIN', 'COORDINATING_ADMIN');
    if (!isOwner && !isOrgAdmin && !state.delegations.some((d) => d.user_id === u.id))
      fail(403, 'NO_PERMISSION', 'هذه الصفحة لمن يملك صلاحية إدارية أو تفويضًا');
    const users = (isOwner ? state.users : E.orgUsers(u.org_id)).map((x) => ({
      ...publicUser(x),
      delegations: state.delegations.filter((d) => d.user_id === x.id && !d.revoked).length,
    }));
    const dlgs = state.delegations
      .filter((d) => isOwner || d.org_id === u.org_id || d.granted_by === u.id)
      .map(dlgView);
    return {
      users,
      delegations: dlgs,
      orgs: state.orgs,
      competencies: state.competencies.map((c) => ({
        ...c,
        substitute_org_name: c.substitute_org_id ? E.oname(c.substitute_org_id) : null,
        owner_org_name: E.oname(c.owner_org_id),
        label: M.SERVICE_TYPES[c.service_type],
      })),
      can_grant: {
        org: E.hasRole(u, 'ORG_ADMIN') ? GRANT_BY_ORG_ADMIN : [],
        coord: E.hasRole(u, 'COORDINATING_ADMIN') ? GRANT_BY_COORD : [],
      },
      can_edit_competencies: isOwner,
    };
  });
  E.route('POST', '/admin/delegations', (ctx) => {
    E.requireReauth?.(ctx);
    const u = ctx.user;
    const b = ctx.body;
    const target = E.user(clean(b.user_id, 40));
    if (!target) fail(422, 'UNKNOWN_USER', 'اختر موظفًا');
    const action = clean(b.action, 40);
    const okOrg = E.hasRole(u, 'ORG_ADMIN') && GRANT_BY_ORG_ADMIN.includes(action) && target.org_id === u.org_id;
    const okCoord = E.hasRole(u, 'COORDINATING_ADMIN') && GRANT_BY_COORD.includes(action) && target.org_id === u.org_id;
    if (target.id === u.id) fail(403, 'SELF_GRANT', 'لا يجوز منح التفويض لنفسك');
    if (!okOrg && !okCoord) fail(403, 'NO_PERMISSION', 'لا تملك صلاحية منح هذا التفويض لهذا الموظف');
    const basis = clean(b.basis, 300);
    if (!basis) fail(422, 'MISSING_BASIS', 'اكتب سند التفويض (رقم القرار أو الكتاب)');
    const valid_to = isDay(b.valid_to) ? b.valid_to : null;
    if (!valid_to) fail(422, 'MISSING_END', 'حدّد تاريخ انتهاء التفويض');
    const projects =
      Array.isArray(b.project_ids) && b.project_ids.length ? b.project_ids.map((x) => clean(x, 40)) : ['*'];
    for (const pid of projects) if (pid !== '*' && !E.project(pid)) fail(422, 'UNKNOWN_PROJECT', 'مشروع غير معروف');
    const d = {
      id: E.id('dlg'),
      user_id: target.id,
      org_id: target.org_id,
      action,
      project_ids: projects,
      service_types:
        Array.isArray(b.service_types) && b.service_types.length ? b.service_types.map((x) => clean(x, 40)) : ['*'],
      valid_from: E.today(),
      valid_to,
      basis,
      granted_by: u.id,
      revoked: false,
      max_amount: null,
    };
    if (b.max_amount != null && b.max_amount !== '') {
      const m = Number(b.max_amount);
      if (!(m >= 0) || !isFinite(m)) fail(422, 'BAD_AMOUNT', 'الحد المالي رقم موجب');
      d.max_amount = Math.round(m);
    }
    state.delegations.push(d);
    E.audit({
      actor_id: u.id,
      action: 'delegation.grant',
      object_type: 'delegation',
      object_id: d.id,
      reason: basis,
      detail: `${target.name}: ${action}${d.max_amount != null ? ' حد ' + d.max_amount : ''}`,
    });
    E.notify([target.id], {
      kind: 'delegation',
      title: 'تفويض جديد',
      body: `${M.DELEGATION_LABEL[action]} — حتى ${valid_to}`,
      link: '#/settings',
    });
    ctx.status = 201;
    return { delegation: dlgView(d) };
  });
  E.route('POST', '/admin/delegations/:id/revoke', (ctx) => {
    E.requireReauth?.(ctx);
    const d = find(state.delegations, ctx.params.id);
    if (!d) fail(404, 'NOT_FOUND', 'التفويض غير موجود');
    const u = ctx.user;
    if (!(d.granted_by === u.id || (E.hasRole(u, 'ORG_ADMIN', 'COORDINATING_ADMIN') && d.org_id === u.org_id)))
      fail(403, 'NO_PERMISSION', 'لا تملك صلاحية سحب هذا التفويض');
    d.revoked = true;
    d.revoked_at = E.iso();
    d.revoked_by = u.id;
    E.audit({
      actor_id: u.id,
      action: 'delegation.revoke',
      object_type: 'delegation',
      object_id: d.id,
      reason: clean(ctx.body.reason, 300),
    });
    E.notify([d.user_id], {
      kind: 'delegation',
      title: 'سُحب تفويض',
      body: M.DELEGATION_LABEL[d.action],
      link: '#/settings',
    });
    return { delegation: dlgView(d) };
  });
  E.route('PATCH', '/admin/competencies/:id', (ctx) => {
    if (!E.hasRole(ctx.user, 'PLATFORM_OWNER_ADMIN'))
      fail(403, 'NO_PERMISSION', 'تعديل دليل الاختصاصات لمالك المنصة فقط');
    const c = find(state.competencies, ctx.params.id);
    if (!c) fail(404, 'NOT_FOUND', 'غير موجود');
    const b = ctx.body;
    const n = { ...c };
    const changes = []; // validate on a copy; the record changes only if everything is valid
    if ('sla_hours' in b) {
      const h = Number(b.sla_hours);
      if (!(h >= 4 && h <= 720)) fail(422, 'BAD_SLA', 'مدة الاستجابة بين 4 و720 ساعة');
      if (Math.round(h) !== c.sla_hours) changes.push(`sla ${c.sla_hours}→${Math.round(h)}`);
      n.sla_hours = Math.round(h);
    }
    if ('valid_from' in b) {
      if (b.valid_from && !isDay(b.valid_from)) fail(422, 'BAD_DATES', 'تاريخ بداية السريان غير صحيح');
      changes.push(`from ${c.valid_from || '-'}→${b.valid_from || '-'}`);
      n.valid_from = b.valid_from || null;
    }
    if ('valid_to' in b) {
      if (b.valid_to && !isDay(b.valid_to)) fail(422, 'BAD_DATES', 'تاريخ نهاية السريان غير صحيح');
      changes.push(`to ${c.valid_to || '-'}→${b.valid_to || '-'}`);
      n.valid_to = b.valid_to || null;
    }
    if (n.valid_from && n.valid_to && n.valid_to < n.valid_from) fail(422, 'BAD_DATES', 'نهاية السريان قبل بدايته');
    if ('acceptance_authority' in b) {
      n.acceptance_authority = clean(b.acceptance_authority, 160);
      changes.push('authority');
    }
    if ('substitute_org_id' in b) {
      const o = b.substitute_org_id || null;
      if (o && (!state.orgs.some((x) => x.id === o) || o === c.owner_org_id))
        fail(422, 'BAD_SUBSTITUTE', 'جهة بديلة غير صالحة');
      n.substitute_org_id = o;
      changes.push(`substitute ${o || '-'}`);
    }
    Object.assign(c, n);
    E.audit({
      actor_id: ctx.user.id,
      action: 'competency.update',
      object_type: 'competency',
      object_id: c.id,
      from: '',
      to: changes.join('; ').slice(0, 200),
      reason: clean(b.reason, 300),
    });
    return { competency: c };
  });
  E.route('GET', '/competencies', () => ({
    items: state.competencies.map((c) => ({
      ...c,
      owner_org_name: E.oname(c.owner_org_id),
      label: M.SERVICE_TYPES[c.service_type],
    })),
    service_types: M.SERVICE_TYPES,
    reason_codes: M.REASON_CODES,
  }));

  // ------------------------------------------------------------------ audit read
  E.route('GET', '/audit', (ctx) => {
    const u = ctx.user;
    const { project_id } = ctx.query;
    const limit = Math.min(Number(ctx.query.limit) || 100, 300);
    let list = state.audit;
    if (project_id) {
      const p = E.needProject(ctx.user, project_id, 'viewer');
      const seeAll =
        E.committeeRole(u, p) === 'chair' ||
        E.committeeRole(u, p) === 'secretary' ||
        E.hasRole(u, 'FINAL_AUDITOR', 'COORDINATING_ADMIN');
      list = list.filter((r) => r.project_id === p.id && (seeAll || r.org_id === u.org_id));
    } else if (E.hasRole(u, 'FINAL_AUDITOR', 'PLATFORM_OWNER_ADMIN')) {
      // platform-wide list: metadata only — fine for auditor/owner
    } else list = list.filter((r) => r.org_id === u.org_id && (E.hasRole(u, 'ORG_ADMIN') || r.actor_id === u.id));
    return { items: list.slice(-limit).reverse(), verify: E.verifyAudit() };
  });
  E.route('GET', '/audit/verify', (ctx) => {
    if (!E.hasRole(ctx.user, 'FINAL_AUDITOR', 'PLATFORM_OWNER_ADMIN', 'SUPER_ADMIN', 'COORDINATING_ADMIN'))
      fail(403, 'NO_PERMISSION', 'التحقق من سلسلة التدقيق للمدقق والمنسق ومالك المنصة');
    return E.verifyAudit();
  });

  // ------------------------------------------------------------------ search (scoped)
  E.route('GET', '/search', (ctx) => {
    // RTL-009: Arabic-aware matching — diacritics, tatweel, alef/yaa/taa-marbuta variants, Arabic-Indic digits and spacing do not change the match
    const fold = (x) =>
      String(x || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/\s+/g, ' ')
        .trim();
    const q = fold(clean(ctx.query.q, 60));
    if (q.length < 2) return { groups: [] };
    const u = ctx.user;
    const has = (s) => fold(s).includes(q);
    const projects = E.projectsFor(u);
    const pids = projects.map((p) => p.id);
    const groups = [];
    const g = (name, items) => {
      if (items.length) groups.push({ name, items: items.slice(0, 6) });
    };
    g(
      'المشاريع',
      projects
        .filter((p) => has(p.name) || has(p.ref))
        .map((p) => ({ title: p.name, sub: p.ref, link: `#/p/${p.id}/overview` })),
    );
    g(
      'طلبات الجهات',
      state.requests
        .filter((r) => pids.includes(r.project_id) && E.reqVisible?.(u, r) && (has(r.title) || has(r.ref)))
        .map((r) => ({
          title: r.title,
          sub: `${r.ref} · ${M.REQUEST_STATUS[r.status].ar}`,
          link: `#/requests/${r.id}`,
        })),
    );
    g(
      'حزم العمل',
      state.workPackages
        .filter((w) => pids.includes(w.project_id) && (has(w.title) || has(w.ref)))
        .map((w) => ({
          title: w.title,
          sub: `${w.ref} · ${E.oname(w.owner_org_id)}`,
          link: `#/p/${w.project_id}/board?wp=${w.id}`,
        })),
    );
    g(
      'المهام',
      state.tasks
        .filter((t) => E.taskVisible?.(u, t) && (has(t.title) || has(t.ref)))
        .map((t) => ({
          title: t.title,
          sub: `${t.ref} · ${M.TASK_STATUS[t.status].ar}`,
          link: `#/tasks?task=${t.id}`,
        })),
    );
    g(
      'المحادثات',
      state.threads
        .filter((t) => t.member_ids.includes(u.id) && has(t.title))
        .map((t) => ({ title: t.title, sub: 'محادثة', link: `#/messages/${t.id}` })),
    );
    g(
      'الأشخاص',
      state.users
        .filter(
          (x) =>
            x.active !== false &&
            x.id !== u.id &&
            (has(x.name) || has(x.title)) &&
            state.projects.some(
              (p) => pids.includes(p.id) && (E.committeeRole(x, p) || E.orgParticipates(x.org_id, p)),
            ),
        )
        .map((x) => ({ title: x.name, sub: `${x.title} — ${E.oname(x.org_id)}`, link: `#/messages?with=${x.id}` })),
    );
    return { groups };
  });

  registerProjects(E);
  registerRequests(E);
  registerInsights(E);
  registerExtras(E);
  registerTemplates(E, templateCatalog);
  E.scanner = scanner; // optional external scanner hook: (name, bytes) => { infected, signature }
  registerAuth(E, authKit);
  registerRegisters(E);
  // ARCH-002: scripts/record-api.sh preloads server/record-api.mjs (node --import) which sets this hook; the engine itself stays free of Node-only modules.
  if (typeof globalThis.__MIHWAR_RECORDER__ === 'function') globalThis.__MIHWAR_RECORDER__(E);
  return E;
}
