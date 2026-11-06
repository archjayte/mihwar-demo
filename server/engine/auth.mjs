// Real sign-in (optional, needs the injected authKit): password with policy + lockout, TOTP MFA, forced change of the temporary password,
// admin-issued temporary passwords, and organisation member management by the organisation's administrator.
import { fail, clean, uniq } from './util.mjs';
import * as M from './model.mjs';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60000;
export const MFA_ROLES = ['PLATFORM_OWNER_ADMIN', 'ORG_ADMIN', 'COORDINATING_ADMIN', 'SUPER_ADMIN'];
const ASSIGNABLE = ['ORG_SUPERVISOR', 'ORG_EXECUTIVE', 'SCOPED_VIEWER']; // roles an organisation administrator may give inside their own organisation
export const policyError = (pw, username = '') => {
  pw = String(pw || '');
  if (pw.length < 12) return 'كلمة المرور 12 حرفًا على الأقل';
  if (!(/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw)))
    return 'يجب أن تجمع كلمة المرور أحرفًا كبيرة وصغيرة وأرقامًا';
  if (username && pw.toLowerCase().includes(String(username).toLowerCase()))
    return 'لا تضمّن اسم المستخدم في كلمة المرور';
  return null;
};

export function registerAuth(E, kit) {
  const S = E.state;
  const LIMITED_OK = { limitedOk: true };
  S.credentials ||= {};
  const needKit = () => {
    if (!kit) fail(501, 'AUTH_KIT_MISSING', 'الدخول بكلمة مرور غير مفعّل في هذه البيئة');
  };
  const cred = (id) => S.credentials[id];
  const mfaRole = (u) => u.roles.some((r) => MFA_ROLES.includes(r));
  const limitOf = (u, c) =>
    c?.must_change ? 'PASSWORD_CHANGE_REQUIRED' : mfaRole(u) && !c?.mfa_enabled ? 'MFA_SETUP_REQUIRED' : null;
  const revokeSessions = (userId, except = null) => {
    for (const [t, s] of Object.entries(S.sessions)) if (s.user_id === userId && t !== except) delete S.sessions[t];
  };

  E.setPassword = (userId, pw, { temporary = false } = {}) => {
    needKit();
    const c = (S.credentials[userId] ||= { failed: 0, locked_until: 0, mfa_enabled: false });
    Object.assign(c, kit.hashPassword(pw), { must_change: temporary, changed_at: E.iso(), failed: 0, locked_until: 0 });
  };

  E.route(
    'POST',
    '/auth/password',
    (ctx) => {
      needKit();
      const hits = (E.loginHits[ctx.headers['x-forwarded-for'] || 'local'] ||= []);
      const t = E.now();
      while (hits.length && t - hits[0] > 60000) hits.shift();
      if (hits.length >= 40) fail(429, 'RATE_LIMITED', 'محاولات كثيرة، حاول بعد دقيقة');
      hits.push(t);
      const u = E.user(clean(ctx.body.username, 80));
      const c = u && cred(u.id);
      const generic = () => fail(401, 'BAD_CREDENTIALS', 'بيانات الدخول غير صحيحة');
      if (c && c.locked_until > t) {
        E.audit({
          actor_id: u.id,
          action: 'denied:login',
          object_type: 'session',
          object_id: u.id,
          outcome: 'denied',
          reason: 'LOCKED',
        });
        fail(
          423,
          'ACCOUNT_LOCKED',
          `الحساب مقفل مؤقتًا بعد محاولات فاشلة. حاول بعد ${Math.ceil((c.locked_until - t) / 60000)} دقيقة`,
        );
      }
      const passOk = kit.verifyPassword(ctx.body.password, c);
      if (!u || u.active === false || !c || !passOk) {
        if (c) {
          c.failed++;
          if (c.failed >= MAX_FAILS) {
            c.locked_until = t + LOCK_MS;
            c.failed = 0;
          }
        }
        if (u)
          E.audit({
            actor_id: u.id,
            action: 'denied:login',
            object_type: 'session',
            object_id: u.id,
            outcome: 'denied',
            reason: 'BAD_CREDENTIALS',
          });
        generic();
      }
      if (c.mfa_enabled) {
        if (!ctx.body.otp) fail(401, 'MFA_REQUIRED', 'أدخل رمز التحقق الثنائي من تطبيق المصادقة');
        if (!kit.totpVerify(c.mfa_secret, ctx.body.otp, t)) {
          c.failed++;
          if (c.failed >= MAX_FAILS) {
            c.locked_until = t + LOCK_MS;
            c.failed = 0;
          }
          E.audit({
            actor_id: u.id,
            action: 'denied:login',
            object_type: 'session',
            object_id: u.id,
            outcome: 'denied',
            reason: 'BAD_OTP',
          });
          fail(401, 'BAD_OTP', 'رمز التحقق غير صحيح');
        }
      }
      c.failed = 0;
      const tok = E.token();
      const limited = limitOf(u, c);
      S.sessions[tok] = { user_id: u.id, created: t, last: t, auth: 'password', ...(limited ? { limited } : {}) };
      E.audit({
        actor_id: u.id,
        action: 'login',
        object_type: 'session',
        object_id: u.id,
        detail: c.mfa_enabled ? 'password+totp' : 'password',
      });
      return { token: tok, user: { id: u.id, name: u.name }, limited: limited || null };
    },
    { public: true },
  );

  // Step-up authentication (IAM-009): in password mode, sensitive administrative actions need a password (+TOTP when enabled) confirmed in the last 5 minutes.
  const REAUTH_MS = 5 * 60000;
  E.requireReauth = (ctx) => {
    if (E.demo || !cred(ctx.user.id)) return; // demo picker sessions have no password to confirm
    const s = S.sessions[ctx.token];
    if (!s || !(s.reauth_until > E.now())) fail(403, 'REAUTH_REQUIRED', 'هذا إجراء حساس: أكّد كلمة المرور للمتابعة');
  };
  E.route('POST', '/auth/reauth', (ctx) => {
    needKit();
    const u = ctx.user;
    const c = cred(u.id);
    if (!c) fail(409, 'NO_PASSWORD', 'حسابك يدخل بالانتقاء التجريبي ولا كلمة مرور له');
    const t = E.now();
    if (c.locked_until > t) fail(423, 'ACCOUNT_LOCKED', 'الحساب مقفل مؤقتًا، حاول لاحقًا');
    const bad = () => {
      c.failed++;
      if (c.failed >= MAX_FAILS) {
        c.locked_until = t + LOCK_MS;
        c.failed = 0;
      }
      E.audit({
        actor_id: u.id,
        action: 'denied:reauth',
        object_type: 'session',
        object_id: u.id,
        outcome: 'denied',
        reason: 'BAD_CREDENTIALS',
      });
      fail(403, 'BAD_CREDENTIALS', 'بيانات التأكيد غير صحيحة');
    };
    if (!kit.verifyPassword(ctx.body.password, c)) bad();
    if (c.mfa_enabled && !kit.totpVerify(c.mfa_secret, ctx.body.otp, t)) bad();
    c.failed = 0;
    S.sessions[ctx.token].reauth_until = t + REAUTH_MS;
    E.audit({ actor_id: u.id, action: 'reauth', object_type: 'session', object_id: u.id });
    return { ok: true, valid_for_seconds: REAUTH_MS / 1000 };
  });

  E.route(
    'GET',
    '/me/security',
    (ctx) => {
      const c = cred(ctx.user.id);
      return {
        has_password: !!c,
        mfa_enabled: !!c?.mfa_enabled,
        mfa_required: mfaRole(ctx.user),
        must_change: !!c?.must_change,
        changed_at: c?.changed_at || null,
        limited: S.sessions[ctx.token]?.limited || null,
        auth: S.sessions[ctx.token]?.auth || 'demo',
      };
    },
    LIMITED_OK,
  );

  E.route(
    'POST',
    '/me/password',
    (ctx) => {
      needKit();
      const u = ctx.user;
      const c = cred(u.id);
      if (!c) fail(409, 'NO_PASSWORD', 'حسابك يدخل بالانتقاء التجريبي ولا كلمة مرور له');
      if (!kit.verifyPassword(ctx.body.current, c)) {
        c.failed++;
        if (c.failed >= MAX_FAILS) {
          c.locked_until = E.now() + LOCK_MS;
          c.failed = 0;
        }
        fail(403, 'BAD_CREDENTIALS', 'كلمة المرور الحالية غير صحيحة');
      }
      const next = String(ctx.body.next || '');
      const pe = policyError(next, u.id);
      if (pe) fail(422, 'WEAK_PASSWORD', pe);
      if (kit.verifyPassword(next, c)) fail(422, 'WEAK_PASSWORD', 'اختر كلمة مرور مختلفة عن الحالية');
      E.setPassword(u.id, next, { temporary: false });
      revokeSessions(u.id, ctx.token);
      const s = S.sessions[ctx.token];
      const lim = limitOf(u, cred(u.id));
      if (lim) s.limited = lim;
      else delete s.limited;
      E.audit({ actor_id: u.id, action: 'password.change', object_type: 'user', object_id: u.id });
      return { ok: true, limited: lim || null };
    },
    LIMITED_OK,
  );

  E.route(
    'POST',
    '/me/mfa/setup',
    (ctx) => {
      needKit();
      const c = cred(ctx.user.id);
      if (!c) fail(409, 'NO_PASSWORD', 'فعّل الدخول بكلمة مرور أولًا');
      if (c.mfa_enabled) fail(409, 'MFA_ALREADY_ENABLED', 'التحقق الثنائي مفعّل');
      c.mfa_pending = kit.totpSecret();
      return {
        secret: c.mfa_pending,
        otpauth_uri: kit.otpauthUri(c.mfa_pending, ctx.user.id),
        note: 'أضف المفتاح إلى تطبيق مصادقة ثم أدخل الرمز المعروض لتأكيد التفعيل',
      };
    },
    LIMITED_OK,
  );
  E.route(
    'POST',
    '/me/mfa/enable',
    (ctx) => {
      needKit();
      const u = ctx.user;
      const c = cred(u.id);
      if (!c?.mfa_pending) fail(409, 'MFA_NOT_STARTED', 'ابدأ إعداد التحقق الثنائي أولًا');
      if (!kit.totpVerify(c.mfa_pending, ctx.body.code, E.now())) fail(422, 'BAD_OTP', 'الرمز غير صحيح');
      c.mfa_secret = c.mfa_pending;
      delete c.mfa_pending;
      c.mfa_enabled = true;
      const s = S.sessions[ctx.token];
      const lim = limitOf(u, c);
      if (lim) s.limited = lim;
      else delete s.limited;
      E.audit({ actor_id: u.id, action: 'mfa.enable', object_type: 'user', object_id: u.id });
      return { ok: true, limited: lim || null };
    },
    LIMITED_OK,
  );
  E.route('POST', '/me/mfa/disable', (ctx) => {
    E.requireReauth(ctx);
    needKit();
    const u = ctx.user;
    const c = cred(u.id);
    if (!c?.mfa_enabled) fail(409, 'MFA_NOT_ENABLED', 'التحقق الثنائي غير مفعّل');
    if (mfaRole(u)) fail(403, 'MFA_MANDATORY', 'التحقق الثنائي إلزامي لدورك الإداري');
    if (!kit.verifyPassword(ctx.body.password, c) || !kit.totpVerify(c.mfa_secret, ctx.body.code, E.now()))
      fail(403, 'BAD_CREDENTIALS', 'كلمة المرور أو الرمز غير صحيح');
    c.mfa_enabled = false;
    delete c.mfa_secret;
    E.audit({ actor_id: u.id, action: 'mfa.disable', object_type: 'user', object_id: u.id });
    return { ok: true };
  });

  // ------------------------------------------------------------------ administration: temporary passwords and organisation members
  const canManage = (u, target) =>
    E.hasRole(u, 'PLATFORM_OWNER_ADMIN') ||
    (E.hasRole(u, 'ORG_ADMIN') && target.org_id === u.org_id && target.id !== u.id);
  E.route('POST', '/admin/users/:id/reset-password', (ctx) => {
    E.requireReauth(ctx);
    needKit();
    const t = E.user(ctx.params.id);
    if (!t) fail(404, 'NOT_FOUND', 'مستخدم غير معروف');
    if (!canManage(ctx.user, t))
      fail(403, 'NO_PERMISSION', 'إعادة تعيين كلمة المرور لمدير جهة المستخدم أو مالك المنصة');
    const temp = kit.randomPassword();
    E.setPassword(t.id, temp, { temporary: true });
    revokeSessions(t.id);
    E.audit({ actor_id: ctx.user.id, action: 'password.reset', object_type: 'user', object_id: t.id });
    E.notify(
      [t.id],
      {
        kind: 'security',
        title: 'أُعيد تعيين كلمة مرورك',
        body: 'سلّمك المسؤول كلمة مرور مؤقتة، وستُطلب منك كلمة جديدة عند أول دخول',
        link: '#/settings',
      },
      ctx.user.id,
    );
    return {
      temporary_password: temp,
      note: 'تُعرض مرة واحدة فقط. سلّمها للمستخدم بقناة آمنة؛ سيُلزم بتغييرها عند أول دخول.',
    };
  });

  const memberView = (x) => ({
    id: x.id,
    name: x.name,
    title: x.title,
    org_id: x.org_id,
    roles: x.roles,
    role_labels: x.roles.map((r) => M.ROLE_LABEL[r]),
    active: x.active !== false,
    capacity_week: x.capacity_week,
    has_password: !!cred(x.id),
    mfa_enabled: !!cred(x.id)?.mfa_enabled,
    delegations: S.delegations.filter((d) => d.user_id === x.id && !d.revoked).length,
  });
  const needOrgAdmin = (u) => {
    if (!E.hasRole(u, 'ORG_ADMIN')) fail(403, 'NO_PERMISSION', 'إدارة أعضاء الجهة لمدير الجهة');
  };
  E.route('GET', '/org/members', (ctx) => {
    needOrgAdmin(ctx.user);
    return {
      items: S.users.filter((x) => x.org_id === ctx.user.org_id).map(memberView),
      assignable_roles: ASSIGNABLE.map((r) => ({ value: r, label: M.ROLE_LABEL[r] })),
      password_mode: !!kit,
    };
  });
  E.route('POST', '/org/members', (ctx) => {
    const u = ctx.user;
    needOrgAdmin(u);
    E.requireReauth(ctx);
    const b = ctx.body;
    const name = clean(b.name, 80);
    if (!name) fail(422, 'MISSING_NAME', 'اكتب اسم الموظف');
    const title = clean(b.title, 80) || 'موظف';
    const roles = uniq(Array.isArray(b.roles) && b.roles.length ? b.roles : ['ORG_EXECUTIVE']);
    if (roles.some((r) => !ASSIGNABLE.includes(r)))
      fail(
        403,
        'ROLE_NOT_ASSIGNABLE',
        'لا يملك مدير الجهة منح هذا الدور (أدوار اللجنة والإدارة العليا تُمنح من مالك المنصة)',
      );
    const id = E.id('u');
    const rec = {
      id,
      name,
      title,
      org_id: u.org_id,
      roles,
      hint: 'عضو أضافه مدير الجهة',
      active: true,
      capacity_week: Math.min(60, Math.max(4, Number(b.capacity_week) || 40)),
    };
    S.users.push(rec);
    E.audit({
      actor_id: u.id,
      action: 'member.create',
      object_type: 'user',
      object_id: id,
      detail: `${name} (${roles.join(',')})`,
    });
    const out = { member: memberView(rec) };
    if (kit && b.issue_password !== false) {
      const temp = kit.randomPassword();
      E.setPassword(id, temp, { temporary: true });
      out.temporary_password = temp;
      out.member = memberView(rec);
    }
    ctx.status = 201;
    return out;
  });
  E.route('PATCH', '/org/members/:id', (ctx) => {
    const u = ctx.user;
    needOrgAdmin(u);
    E.requireReauth(ctx);
    const t = E.user(ctx.params.id);
    if (!t || t.org_id !== u.org_id) fail(404, 'NOT_FOUND', 'العضو غير موجود في جهتك');
    if (t.id === u.id) fail(403, 'SELF_CHANGE', 'لا تعدّل حسابك بنفسك');
    const b = ctx.body;
    const n = { ...t };
    if (t.roles.some((r) => !ASSIGNABLE.includes(r)))
      fail(403, 'ROLE_NOT_ASSIGNABLE', 'هذا العضو يحمل دورًا إداريًا يُدار من مالك المنصة');
    if ('title' in b) n.title = clean(b.title, 80) || t.title;
    if ('roles' in b) {
      const roles = uniq(b.roles || []);
      if (!roles.length || roles.some((r) => !ASSIGNABLE.includes(r)))
        fail(403, 'ROLE_NOT_ASSIGNABLE', 'دور غير مسموح');
      n.roles = roles;
    }
    if ('capacity_week' in b) n.capacity_week = Math.min(60, Math.max(4, Number(b.capacity_week) || t.capacity_week));
    if ('active' in b) n.active = !!b.active;
    const was = t.active !== false;
    Object.assign(t, n);
    if (was && t.active === false) {
      for (const d of S.delegations.filter((x) => x.user_id === t.id && !x.revoked)) {
        d.revoked = true;
        d.revoked_at = E.iso();
        d.revoked_by = u.id;
      }
      revokeSessions(t.id);
    }
    E.audit({
      actor_id: u.id,
      action: was && t.active === false ? 'member.deactivate' : 'member.update',
      object_type: 'user',
      object_id: t.id,
      reason: clean(b.reason, 300),
    });
    return { member: memberView(t) };
  });
}
