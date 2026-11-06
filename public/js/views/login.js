import { api, session } from '../api.js';
import { h, toast, badge, avatar } from '../ui.js';
import { lang, setLang, langLabel } from '../i18n.js';

const ART = `<svg viewBox="0 0 480 300" role="img" aria-label="رسم يوضح مركز المنصة وارتباطه بالجهات">
<defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#1b5a62" stop-opacity=".9"/><stop offset="1" stop-color="#11262d" stop-opacity="0"/></radialGradient></defs>
<rect width="480" height="300" fill="#11262d"/><circle cx="240" cy="150" r="150" fill="url(#g)"/>
<g stroke="#3f7f86" stroke-width="1.5" fill="none" stroke-dasharray="3 5">
<path d="M240 150 90 70M240 150 90 230M240 150 390 70M240 150 390 230M240 150 240 35M240 150 240 265"/></g>
<g fill="#16363e" stroke="#4aa0a6" stroke-width="1.5"><circle cx="90" cy="70" r="22"/><circle cx="90" cy="230" r="22"/><circle cx="390" cy="70" r="22"/><circle cx="390" cy="230" r="22"/><circle cx="240" cy="35" r="20"/><circle cx="240" cy="265" r="20"/></g>
<g fill="#cfe3e4" font-family="Noto Kufi Arabic,sans-serif" font-size="11" text-anchor="middle"><text x="90" y="74">الشرطة</text><text x="90" y="234">المالية</text><text x="390" y="74">المشتريات</text><text x="390" y="234">البلدية</text><text x="240" y="39">الخدمات</text><text x="240" y="269">الرقمية</text></g>
<circle cx="240" cy="150" r="40" fill="#0f5b61" stroke="#8fd0d3" stroke-width="2"/>
<text x="240" y="147" fill="#fff" font-family="Alexandria,sans-serif" font-weight="700" font-size="15" text-anchor="middle">لجنة</text><text x="240" y="165" fill="#fff" font-family="Alexandria,sans-serif" font-weight="700" font-size="15" text-anchor="middle">المشروع</text>
<circle cx="165" cy="110" r="7" fill="#d98a00"/><circle cx="165" cy="110" r="13" fill="#d98a00" opacity=".25"/></svg>`;

const PATH = [
  [
    'الجهة الطالبة تُعدّ الطلب',
    'مشرف الشرطة يكتب الطلب ومفوّض الجهة يعتمده — لا يصل للجنة قبل اعتماد الجهة.',
    'u_pol_sup',
    'ادخل كمشرف الشرطة',
  ],
  [
    'أمانة اللجنة تفرز',
    'تتحقق من اكتمال الطلب وترفعه للرئيس. لا تحيل رسميًا ولا تقبل نيابة عن أحد.',
    'u_sec',
    'ادخل كأمينة اللجنة',
  ],
  [
    'الرئيس يحيل للجهة المختصة',
    'إحالة تنسيقية فقط. يمكنه تفكيك الطلب المركّب أو إعادة توجيهه بعد اعتذار.',
    'u_chair',
    'ادخل كرئيس اللجنة',
  ],
  [
    'الجهة المختصة تقرر',
    'تقبل أو تعتذر بسبب إلزامي أو تقترح بديلًا — والصمت لا يُعد قبولًا.',
    'u_fin_auth',
    'ادخل كمفوّض المالية',
  ],
  [
    'التنفيذ ثم المراجعة',
    'المشرف يوزّع المهام داخل جهته، ثم تراجع الجهة الطالبة المخرج بالأدلة.',
    'u_proc_sup',
    'ادخل كمشرف المشتريات',
  ],
];

function passwordForm(enterWith) {
  const u = h('input', { name: 'username', autocomplete: 'username', required: true, dir: 'ltr' });
  const p = h('input', {
    name: 'password',
    type: 'password',
    autocomplete: 'current-password',
    required: true,
    dir: 'ltr',
  });
  const o = h('input', {
    name: 'otp',
    inputmode: 'numeric',
    autocomplete: 'one-time-code',
    maxlength: 6,
    dir: 'ltr',
    placeholder: '6 أرقام',
  });
  const otpField = h('div', { class: 'field hide' }, h('label', { for: 'otp-in' }, 'رمز التحقق الثنائي'), o);
  o.id = 'otp-in';
  u.id = 'user-in';
  p.id = 'pass-in';
  const err = h('div', { class: 'notice err hide', role: 'alert' });
  const form = h(
    'form',
    {
      class: 'form-grid',
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        err.classList.add('hide');
        try {
          await enterWith({ username: u.value.trim(), password: p.value, otp: o.value.trim() || undefined });
        } catch (x) {
          if (x.code === 'MFA_REQUIRED') {
            otpField.classList.remove('hide');
            o.focus();
          }
          err.textContent = x.message;
          err.classList.remove('hide');
        }
      },
    },
    h('div', { class: 'field' }, h('label', { for: 'user-in' }, 'اسم المستخدم'), u),
    h('div', { class: 'field' }, h('label', { for: 'pass-in' }, 'كلمة المرور'), p),
    otpField,
    err,
    h('div', { class: 'field full' }, h('button', { class: 'btn primary', type: 'submit' }, 'دخول')),
  );
  return h(
    'section',
    { class: 'org-group', 'aria-label': 'الدخول بكلمة مرور' },
    h(
      'details',
      null,
      h('summary', null, h('b', null, 'الدخول بكلمة مرور')),
      h(
        'p',
        { class: 'small muted' },
        'للبيئات التي فُعّل فيها الدخول الحقيقي: كلمة المرور المؤقتة يسلّمها لك مدير جهتك، وستُلزم بتغييرها عند أول دخول. التحقق الثنائي إلزامي للأدوار الإدارية.',
      ),
      form,
    ),
  );
}

export function loginView({ onLogin }) {
  const root = h('main', { class: 'login', id: 'main', tabindex: '-1' });
  const list = h('div', { style: { minHeight: '100vh' } }, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  async function enter(id) {
    try {
      const r = await api.post('/auth/login', { user_id: id });
      session.set(r.token);
      await onLogin();
    } catch (e) {
      toast(e.message, 'err');
    }
  }
  async function enterWith(body) {
    const r = await api.post('/auth/password', body);
    session.set(r.token);
    await onLogin(r.limited);
  }
  root.append(
    h(
      'section',
      { class: 'login-hero' },
      h(
        'div',
        { class: 'col', style: { gap: '14px' } },
        h(
          'button',
          {
            class: 'btn sm lang-btn',
            lang: lang === 'en' ? 'ar' : 'en',
            onclick: () => setLang(lang === 'en' ? 'ar' : 'en'),
          },
          langLabel(),
        ),
        h('img', { class: 'login-logo on-light', src: '/assets/logo.svg', alt: 'محور', width: 140, height: 48 }),
        h('img', { class: 'login-logo on-dark', src: '/assets/logo-light.svg', alt: '', width: 140, height: 48 }),
        badge('نسخة تجريبية محلية — بيانات تخيلية', 'attention'),
        h('h1', null, 'محور: مكان واحد تُدار فيه المشاريع المشتركة بين الجهات'),
        h(
          'p',
          { class: 'muted', style: { maxWidth: '56ch' } },
          'الطلب ليس التزامًا. يمر من الجهة الطالبة إلى لجنة المشروع ثم إلى الجهة المختصة، ولا يصبح التزامًا إلا بقبول موثّق من الجهة نفسها. كل خطوة مسجلة في سجل تدقيق لا يُعدَّل.',
        ),
        h(
          'p',
          { class: 'small muted' },
          'اختر مستخدمًا تجريبيًا من القائمة أدناه لتجرّب المنصة من موقعه؛ الدخول التجريبي بلا كلمة مرور. الدخول بكلمة مرور وتحقق ثنائي متاح عند تشغيل الخادم بـ MIHWAR_DEMO=0.',
        ),
      ),
      h('div', { class: 'axis-art', html: ART }),
    ),
    h(
      'section',
      null,
      h('h2', { style: { marginBlockEnd: '10px' } }, 'مسار تجربة مقترح'),
      h(
        'ol',
        { class: 'path-steps' },
        PATH.map(([t, d, uid, cta]) =>
          h(
            'li',
            null,
            h('b', null, t),
            h('div', { class: 'muted', style: { margin: '4px 0 8px' } }, d),
            h('button', { class: 'btn sm', onclick: () => enter(uid) }, cta),
          ),
        ),
      ),
    ),
    passwordForm(enterWith),
    h('section', { class: 'org-group', id: 'demo-users' }, h('h2', null, 'جميع المستخدمين التجريبيين'), list),
    h(
      'section',
      { class: 'notice info', 'aria-label': 'إشعار معالجة البيانات' },
      h('b', null, 'إشعار معالجة البيانات: '),
      'تُسجَّل في هذه المنصة بيانات الاسم والجهة والإجراءات التي تنفّذها لأغراض التنسيق والتدقيق، ويقتصر الاطلاع عليها على من لهم صلاحية. هذه نسخة محلية ببيانات اصطناعية، فلا تُدخل بيانات حقيقية.',
    ),
    h('p', { class: 'credit' }, 'إعداد وتصميم: د.م. جراح جمال الطير'),
  );
  api
    .get('/system/notice')
    .then((r) => {
      if (r.notice) root.prepend(h('div', { class: `notice-bar ${r.notice.level}`, role: 'status' }, r.notice.text));
    })
    .catch(() => {});
  api
    .get('/demo/users')
    .then((r) => {
      if (r.demo === false) document.getElementById('demo-users')?.remove();
      const byOrg = new Map(r.orgs.map((o) => [o.id, []]));
      r.users.forEach((u) => byOrg.get(u.org_id)?.push(u));
      list.style.minHeight = '';
      list.replaceChildren(
        ...r.orgs
          .filter((o) => byOrg.get(o.id)?.length)
          .map((o) =>
            h(
              'div',
              { class: 'org-group' },
              h('h3', null, o.name),
              h(
                'div',
                { class: 'grid auto' },
                byOrg
                  .get(o.id)
                  .map((u) =>
                    h(
                      'button',
                      { class: 'persona', onclick: () => enter(u.id) },
                      avatar(u.name),
                      h(
                        'span',
                        null,
                        h('b', null, u.name),
                        h('span', { class: 'small muted' }, u.title),
                        u.committee.length ? h('span', { class: 'small' }, ' · ' + u.committee.join('، ')) : null,
                        h('span', { class: 'xs muted', style: { display: 'block' } }, u.hint),
                      ),
                    ),
                  ),
              ),
            ),
          ),
      );
    })
    .catch((e) => list.replaceChildren(h('div', { class: 'notice err' }, e.message)));
  return root;
}
