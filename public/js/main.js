// App shell: session, router, navigation, search palette, notifications.
import { api, session, setUnauthHandler, setReauthHandler } from './api.js';
import { h, mount, $, $$, icon, toast, popover, modal, formDialog, ago, avatar, emptyState } from './ui.js';
import { initI18n } from './i18n.js';
import { initA11y } from './a11y.js';
import { loginView } from './views/login.js';
import { VERSION } from './views/help.js';

export const ctx = { me: null, nav: [], theme: 'light' };
const app = $('#app');
let renderToken = 0;

try {
  const t = localStorage.getItem('mihwar.theme');
  if (t === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    ctx.theme = 'dark';
  }
} catch {
  /* ignore */
}
export const setTheme = (t) => {
  ctx.theme = t;
  if (t === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem('mihwar.theme', t);
  } catch {
    /* ignore */
  }
};

initI18n();

const NAV = {
  home: ['الرئيسية', 'home', '#/'],
  projects: ['المشاريع', 'folder', '#/projects'],
  templates: ['النماذج الجاهزة', 'doc', '#/templates'],
  requests: ['طلبات الجهات', 'inbox', '#/requests'],
  committee: ['صندوق اللجنة', 'users', '#/committee'],
  overview: ['النظرة التنفيذية', 'chart', '#/overview'],
  tasks: ['مهامي', 'task', '#/tasks'],
  orgtasks: ['مهام الجهة', 'users', '#/tasks?scope=all'],
  decisions: ['القرارات والتصاريح', 'shield', '#/decisions'],
  evidence: ['الأدلة', 'doc', '#/evidence'],
  commitments: ['التزامات الجهة', 'link', '#/commitments'],
  messages: ['المحادثات', 'chat', '#/messages'],
  reports: ['التقارير', 'chart', '#/reports'],
  governance: ['الحوكمة والتدقيق', 'shield', '#/governance'],
  settings: ['الإعدادات', 'gear', '#/settings'],
};

// The menu shows the daily work first; less frequent sections sit under one collapsible «المزيد» group (settings live in the user menu).
const PRIMARY = ['home', 'projects', 'requests', 'committee', 'tasks', 'messages'];
const MORE = ['overview', 'orgtasks', 'commitments', 'decisions', 'evidence', 'reports', 'templates', 'governance'];
try {
  if (localStorage.getItem('mihwar.side') === '1') document.documentElement.classList.add('side-collapsed');
} catch {
  /* ignore */
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export const go = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};
export const refresh = () => route();

setReauthHandler(
  () =>
    new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (!done) {
          done = true;
          resolve(v);
        }
      };
      formDialog({
        title: 'تأكيد الهوية',
        intro: 'هذا إجراء حساس. أدخل كلمة المرور (ورمز التحقق إن كان مفعّلًا) للمتابعة لمدة خمس دقائق.',
        submit: 'تأكيد',
        fields: [
          { name: 'password', label: 'كلمة المرور', type: 'password', required: true },
          { name: 'otp', label: 'رمز التحقق الثنائي (إن وُجد)', hint: 'ستة أرقام من تطبيق المصادقة', dir: 'ltr' },
        ],
        onSubmit: async (v) => {
          await api.post('/auth/reauth', { password: v.password, otp: v.otp || undefined });
          finish(true);
        },
        onClose: () => finish(false),
      });
    }),
);
setUnauthHandler((e) => {
  ctx.me = null;
  toast(e?.message || 'انتهت الجلسة', 'err');
  location.hash = '#/login';
});

async function loadMe() {
  const r = await api.get('/me');
  ctx.me = r;
  ctx.nav = r.nav;
  return r;
}

// Pinned and recently opened projects under the main navigation (spec: projects tree). Opening one lands on the tab last used in it.
const lsj = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
function projectTree() {
  const list = ctx.projects || [];
  if (!list.length) return null;
  const pinned = ctx.me.prefs?.pinned || [];
  const recent = lsj('mihwar.recent', []);
  const order = [...pinned, ...recent.filter((id) => !pinned.includes(id))]
    .map((id) => list.find((p) => p.id === id))
    .filter(Boolean)
    .slice(0, 6);
  if (!order.length) return null;
  const cur = parseHash().parts[0] === 'p' ? parseHash().parts[1] : null;
  return h(
    'nav',
    { class: 'proj-tree', 'aria-label': 'مشاريعي' },
    h('div', { class: 'nav-sec' }, 'مشاريعي'),
    h(
      'ul',
      null,
      order.map((p) =>
        h(
          'li',
          null,
          h(
            'a',
            {
              href: `#/p/${p.id}/${lsj(`mihwar.ptab.${p.id}`, 'board')}`,
              'aria-current': p.id === cur ? 'page' : null,
              title: p.name,
              onclick: () => $('#side').classList.remove('open'),
            },
            h('i', { class: `dot ${p.delayed ? 'late' : 'ok'}`, 'aria-hidden': 'true' }),
            h('span', { class: 'nm' }, p.name),
            pinned.includes(p.id) ? h('span', { class: 'pin', 'aria-label': 'مثبّت' }, '★') : null,
            h('span', { class: 'pct num' }, `${p.progress.verified}٪`),
            p.delayed ? h('span', { class: 'sr-only' }, `${p.delayed} حزم متأخرة`) : null,
          ),
        ),
      ),
    ),
  );
}

function shell(content, current) {
  const me = ctx.me;
  const unread = me.unread;
  const navLinks = ctx.nav
    .map((k) => {
      const [label, ic, href] = NAV[k] || [];
      if (!label) return null;
      return { k, label, ic, href };
    })
    .filter(Boolean);
  const isCurrent = (k) => k === current;
  const navLink = (n) =>
    h(
      'a',
      {
        href: n.href,
        title: n.label,
        'aria-current': isCurrent(n.k) ? 'page' : null,
        onclick: () => $('#side').classList.remove('open'),
      },
      icon(n.ic),
      h('span', null, n.label),
      n.k === 'messages' && me.unread_messages ? h('span', { class: 'count' }, me.unread_messages) : null,
    );
  const mainLinks = navLinks.filter((n) => PRIMARY.includes(n.k));
  const moreLinks = navLinks.filter((n) => MORE.includes(n.k));
  const moreOpen = moreLinks.some((n) => isCurrent(n.k)) || lsj('mihwar.more', false);
  const more = moreLinks.length
    ? h(
        'details',
        {
          class: 'nav-more',
          open: moreOpen,
          ontoggle: (e) => {
            try {
              localStorage.setItem('mihwar.more', JSON.stringify(e.currentTarget.open));
            } catch {
              /* ignore */
            }
          },
        },
        h('summary', { title: 'المزيد' }, icon('menu', 20), h('span', null, 'المزيد'), icon('chev', 14)),
        moreLinks.map(navLink),
      )
    : null;
  const side = h(
    'aside',
    { class: 'side', id: 'side', 'aria-label': 'القائمة الرئيسية' },
    h('div', { class: 'brand' }, logoMark(), h('div', null, 'محور', h('small', null, 'حوكمة المشاريع المشتركة'))),
    h('nav', { class: 'nav' }, mainLinks.map(navLink), more),
    projectTree(),
    h(
      'button',
      {
        class: 'side-toggle',
        'aria-label': 'طي القائمة الجانبية',
        onclick: () => {
          document.documentElement.classList.toggle('side-collapsed');
          try {
            localStorage.setItem(
              'mihwar.side',
              document.documentElement.classList.contains('side-collapsed') ? '1' : '0',
            );
          } catch {
            /* ignore */
          }
        },
      },
      icon('menu', 18),
      h('span', null, 'طي القائمة'),
    ),
  );
  const bottom = h(
    'nav',
    { class: 'bottom-nav', 'aria-label': 'تنقل سريع' },
    navLinks
      .filter((n) => ['home', 'projects', 'requests', 'tasks', 'messages'].includes(n.k))
      .slice(0, 5)
      .map((n) => h('a', { href: n.href, 'aria-current': isCurrent(n.k) ? 'page' : null }, icon(n.ic, 22), n.label)),
  );
  const bell = h(
    'button',
    { class: 'iconbtn', 'aria-label': 'الإشعارات', id: 'bell', onclick: openNotifications },
    icon('bell'),
    unread ? h('span', { class: 'dot' }, unread > 99 ? '99+' : unread) : null,
  );
  const top = h(
    'header',
    { class: 'topbar' },
    h(
      'button',
      {
        class: 'iconbtn menu-btn',
        'aria-label': 'القائمة',
        'aria-controls': 'side',
        'aria-expanded': 'false',
        onclick: (e) => {
          const o = $('#side').classList.toggle('open');
          e.currentTarget.setAttribute('aria-expanded', String(o));
        },
      },
      icon('menu'),
    ),
    h(
      'button',
      { class: 'searchbtn', onclick: openSearch, 'aria-label': 'بحث (اضغط /)' },
      icon('search', 18),
      h('span', { class: 'truncate' }, 'ابحث عن مشروع أو طلب أو مهمة…'),
      h('kbd', null, '/'),
    ),
    h('div', { class: 'grow' }),
    workspaceSwitcher(),
    quickCreate(),
    bell,
    h(
      'button',
      { class: 'userbtn', onclick: (e) => userMenu(e.currentTarget), 'aria-label': 'قائمة المستخدم' },
      avatar(me.user.name),
      h('span', { class: 'who small' }, me.user.name),
    ),
  );
  return h(
    'div',
    { class: 'shell' },
    side,
    h(
      'div',
      { class: 'main' },
      ctx.notice
        ? h(
            'div',
            { class: `notice-bar ${ctx.notice.level}`, role: 'status' },
            h('b', null, { outage: 'انقطاع: ', warn: 'تنبيه صيانة: ', info: 'إشعار: ' }[ctx.notice.level] || 'إشعار: '),
            ctx.notice.text,
            ctx.notice.until
              ? ` (حتى ${new Date(ctx.notice.until).toLocaleString('ar-AE', { dateStyle: 'medium', timeStyle: 'short' })})`
              : '',
          )
        : null,
      me.demo
        ? h('div', { class: 'demo-bar' }, 'نسخة تجريبية محلية — بيانات تخيلية للعرض والتجربة، وليست بيانات جهة حقيقية')
        : null,
      top,
      h('main', { id: 'main', class: 'page', tabindex: '-1' }, content),
      siteFooter(),
    ),
    bottom,
  );
}

const siteFooter = () =>
  h(
    'footer',
    { class: 'site-foot' },
    h(
      'nav',
      { 'aria-label': 'روابط التذييل' },
      h('a', { href: '#/help' }, 'المساعدة والتواصل'),
      h('a', { href: '#/help' }, 'إشعار معالجة البيانات'),
      h('a', { href: '#/help' }, 'بيان إمكانية الوصول'),
    ),
    h('span', null, `إعداد وتصميم: د.م. جراح جمال الطير · الإصدار ${VERSION.number}`),
  );
const logoMark = () => h('img', { src: '/assets/mark.svg', width: 34, height: 34, alt: '', class: 'logo-mark' });

// Workspace switcher (master requirements 4.2): a user with more than one capacity (committee seat, organisation role, platform role)
// jumps between workspaces. It only navigates; what each workspace shows is still decided by the server.
function workspaces() {
  const me = ctx.me;
  const ws = [];
  const nav = ctx.nav;
  const roles = me.user.roles;
  const seen = new Set();
  for (const c of me.committee || [])
    if (!seen.has(c.project_id)) {
      seen.add(c.project_id);
      ws.push({
        id: `c:${c.project_id}`,
        label: `لجنة: ${c.project_name}`,
        sub: c.label,
        href: `#/p/${c.project_id}/committee`,
      });
    }
  if (roles.some((r) => ['ORG_ADMIN', 'ORG_SUPERVISOR', 'ORG_EXECUTIVE'].includes(r)) && nav.includes('requests'))
    ws.push({
      id: 'org',
      label: `جهتي: ${me.user.org_name}`,
      sub:
        roles.includes('ORG_EXECUTIVE') && !roles.includes('ORG_SUPERVISOR') && !roles.includes('ORG_ADMIN')
          ? 'مهامي'
          : 'طلبات الجهة ومهامها',
      href: nav.includes('orgtasks') ? '#/tasks?scope=all' : '#/tasks',
    });
  if (roles.includes('COORDINATING_ADMIN'))
    ws.push({ id: 'coord', label: 'تنسيق المشاريع', sub: 'المشاريع والخطوط الأساسية', href: '#/projects' });
  if (
    nav.includes('governance') &&
    roles.some((r) => ['ORG_ADMIN', 'PLATFORM_OWNER_ADMIN', 'FINAL_AUDITOR', 'INDEPENDENT_REVIEWER'].includes(r))
  )
    ws.push({
      id: 'admin',
      label: roles.includes('PLATFORM_OWNER_ADMIN') ? 'المنصة' : 'الإدارة والتدقيق',
      sub: 'التفويضات والسجل',
      href: '#/governance',
    });
  return ws;
}
function workspaceSwitcher() {
  const ws = workspaces();
  if (ws.length < 2) return null;
  let cur = null;
  try {
    cur = localStorage.getItem('mihwar.ws');
  } catch {
    /* ignore */
  }
  const active = ws.find((w) => w.id === cur) || ws[0];
  return h(
    'button',
    {
      class: 'btn sm ws-btn',
      'aria-haspopup': 'menu',
      'aria-label': `مساحة العمل: ${active.label}. غيّرها`,
      onclick: (e) => {
        const p = popover(e.currentTarget, [
          h('div', { class: 'ph' }, h('b', null, 'مساحة العمل')),
          h(
            'div',
            { class: 'menu', role: 'menu' },
            ws.map((w) =>
              h(
                'a',
                {
                  role: 'menuitem',
                  href: w.href,
                  'aria-current': w.id === active.id ? 'true' : null,
                  onclick: () => {
                    try {
                      localStorage.setItem('mihwar.ws', w.id);
                    } catch {
                      /* ignore */
                    }
                    p.close();
                  },
                },
                icon('users', 18),
                h('span', null, w.label, h('span', { class: 'xs muted', style: { display: 'block' } }, w.sub)),
              ),
            ),
          ),
        ]);
      },
    },
    icon('users', 16),
    h('span', { class: 'truncate', style: { maxWidth: '160px' } }, active.label),
  );
}

function quickCreate() {
  const items = [];
  const nav = ctx.nav;
  if (nav.includes('requests'))
    items.push([
      'طلب جديد إلى جهة',
      () => {
        go('#/requests?new=1');
      },
    ]);
  if (nav.includes('tasks'))
    items.push([
      'مهمة جديدة',
      () => {
        go('#/tasks?new=1');
      },
    ]);
  if (ctx.me.user.roles.includes('COORDINATING_ADMIN'))
    items.push([
      'مشروع جديد',
      () => {
        go('#/projects?new=1');
      },
    ]);
  if (nav.includes('messages'))
    items.push([
      'محادثة جديدة',
      () => {
        go('#/messages?new=1');
      },
    ]);
  if (!items.length) return null;
  return h(
    'button',
    {
      class: 'btn primary sm',
      onclick: (e) => {
        const p = popover(
          e.currentTarget,
          h(
            'div',
            { class: 'menu' },
            items.map(([l, fn]) =>
              h(
                'button',
                {
                  onclick: () => {
                    p.close();
                    fn();
                  },
                },
                icon('plus', 16),
                l,
              ),
            ),
          ),
        );
      },
    },
    icon('plus', 16),
    'جديد',
  );
}

async function openNotifications(e) {
  const anchor = e.currentTarget;
  const body = h('div', { class: 'pb' }, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  const markBtn = h(
    'button',
    {
      class: 'btn ghost sm',
      onclick: async () => {
        await api.post('/notifications/read', {});
        ctx.me.unread = 0;
        $('.dot', anchor)?.remove();
        $$('.ntf.unread', body).forEach((n) => n.classList.remove('unread'));
      },
    },
    'تعليم الكل كمقروء',
  );
  const pop = popover(anchor, [h('div', { class: 'ph' }, h('h3', { style: { flex: 1 } }, 'الإشعارات'), markBtn), body]);
  try {
    const r = await api.get('/notifications');
    mount(
      body,
      r.items.length
        ? r.items.map((n) =>
            h(
              'a',
              { class: `ntf${n.read ? '' : ' unread'}`, href: n.link || '#/', onclick: () => pop.close() },
              h('div', { class: 'small', style: { fontWeight: 500 } }, n.title),
              n.body && h('div', { class: 'xs muted truncate' }, n.body),
              h('div', { class: 'xs muted' }, ago(n.at)),
            ),
          )
        : emptyState('لا إشعارات', 'ستظهر هنا الطلبات والقرارات الموجهة إليك.'),
    );
  } catch (err) {
    mount(body, emptyState('تعذّر التحميل', err.message));
  }
}

function userMenu(anchor) {
  const me = ctx.me;
  const pop = popover(anchor, [
    h(
      'div',
      { class: 'ph' },
      avatar(me.user.name),
      h(
        'div',
        null,
        h('div', { style: { fontWeight: 500 } }, me.user.name),
        h('div', { class: 'xs muted' }, me.user.role_labels.join('، ')),
      ),
    ),
    h(
      'div',
      { class: 'menu' },
      h('a', { href: '#/settings', onclick: () => pop.close() }, icon('gear', 18), 'الإعدادات وتفويضاتي'),
      h(
        'button',
        {
          onclick: () => {
            setTheme(ctx.theme === 'dark' ? 'light' : 'dark');
            pop.close();
          },
        },
        icon('moon', 18),
        ctx.theme === 'dark' ? 'المظهر الفاتح' : 'المظهر الداكن',
      ),
      h('a', { href: '#/help', onclick: () => pop.close() }, icon('info', 18), 'المساعدة والتواصل'),
      h(
        'button',
        {
          onclick: () => {
            pop.close();
            shortcuts();
          },
        },
        icon('info', 18),
        'اختصارات لوحة المفاتيح',
      ),
      h(
        'button',
        {
          onclick: async () => {
            await api.post('/auth/logout').catch(() => {});
            session.set(null);
            ctx.me = null;
            pop.close();
            location.hash = '#/login';
          },
        },
        icon('logout', 18),
        'تبديل المستخدم / خروج',
      ),
    ),
  ]);
}

function shortcuts() {
  modal({
    title: 'اختصارات لوحة المفاتيح',
    body: h(
      'table',
      { class: 'tbl' },
      h(
        'tbody',
        null,
        [
          ['/ أو Ctrl+K', 'بحث شامل'],
          ['?', 'هذه القائمة'],
          ['N', 'إنشاء جديد'],
          ['[  و  ]', 'تبويب المشروع السابق / التالي'],
          ['M (على بطاقة)', 'نقل البطاقة بلا سحب'],
          ['Alt + الأسهم (على شريط)', 'اقتراح تغيير موعد'],
          ['G ثم H', 'الرئيسية'],
          ['G ثم P', 'المشاريع'],
          ['G ثم R', 'طلبات الجهات'],
          ['Esc', 'إغلاق النافذة أو الدرج'],
        ].map(([k, d]) => h('tr', null, h('td', null, h('kbd', { class: 'chip' }, k)), h('td', null, d))),
      ),
    ),
  });
}

function openSearch() {
  let timer;
  let sel = -1;
  let optN = 0;
  const res = h(
    'div',
    { class: 'res', id: 'search-res', role: 'listbox', 'aria-label': 'نتائج البحث' },
    h('div', { class: 'empty small' }, 'اكتب حرفين على الأقل للبحث'),
  );
  // CMP-012: ARIA 1.2 combobox with a listbox popup; the active option is announced through aria-activedescendant and the result count through a polite status
  const input = h('input', {
    type: 'search',
    placeholder: 'ابحث عن مشروع، طلب، حزمة عمل، مهمة، شخص…',
    'aria-label': 'بحث',
    autocomplete: 'off',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': 'search-res',
    'aria-haspopup': 'listbox',
  });
  const status = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const setSel = (l) => {
    l.forEach((x, i) => {
      x.classList.toggle('sel', i === sel);
      x.setAttribute('aria-selected', i === sel ? 'true' : 'false');
    });
    if (sel >= 0) input.setAttribute('aria-activedescendant', l[sel].id);
    else input.removeAttribute('aria-activedescendant');
  };
  const box = h(
    'div',
    { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'بحث' },
    input,
    status,
    res,
  );
  const scrim = h('div', { class: 'scrim', style: { alignItems: 'start' } }, box);
  const close = () => {
    scrim.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const links = () => $$('a', res);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const l = links();
      if (!l.length) return;
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + l.length) % l.length;
      setSel(l);
      l[sel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && sel >= 0) {
      e.preventDefault();
      links()[sel]?.click();
    }
  };
  document.addEventListener('keydown', onKey, true);
  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) close();
  });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      sel = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      if (q.length < 2) {
        mount(res, h('div', { class: 'empty small' }, 'اكتب حرفين على الأقل للبحث'));
        status.textContent = '';
        return;
      }
      try {
        const r = await api.get('/search', { q });
        mount(
          res,
          r.groups.length
            ? r.groups.map((g) => [
                h('div', { class: 'grp' }, g.name),
                g.items.map((i) =>
                  h(
                    'a',
                    { href: i.link, role: 'option', 'aria-selected': 'false', id: `so_${++optN}`, onclick: close },
                    h('span', null, i.title),
                    h('span', { class: 'xs muted' }, i.sub),
                  ),
                ),
              ])
            : h('div', { class: 'empty small' }, `لا نتائج لـ «${q}» ضمن ما يحق لك الاطلاع عليه`),
        );
        const n = r.groups.reduce((a, g) => a + g.items.length, 0);
        status.textContent = n ? `${n} نتيجة. استخدم السهمين للتنقل وEnter للفتح` : 'لا نتائج';
        input.setAttribute('aria-expanded', n ? 'true' : 'false');
      } catch (err) {
        mount(res, h('div', { class: 'empty small' }, err.message));
        status.textContent = err.message;
      }
    }, 180);
  });
  $('#layer').append(scrim);
  input.focus();
}

// ---------------- routing ----------------
// Views are loaded on first use (code splitting): the first screen downloads only the shell and its own view.
const lazy = (file, name) => (a) => import(file).then((m) => m[name](a));
const homeView = lazy('./views/home.js', 'homeView'),
  projectsView = lazy('./views/projects.js', 'projectsView'),
  projectView = lazy('./views/projects.js', 'projectView');
const requestsView = lazy('./views/requests.js', 'requestsView'),
  requestView = lazy('./views/requests.js', 'requestView'),
  tasksView = lazy('./views/work.js', 'tasksView');
const commitmentsView = lazy('./views/work.js', 'commitmentsView'),
  messagesView = lazy('./views/messages.js', 'messagesView'),
  reportsView = lazy('./views/reports.js', 'reportsView');
const governanceView = lazy('./views/admin.js', 'governanceView'),
  settingsView = lazy('./views/admin.js', 'settingsView'),
  overviewView = lazy('./views/registers.js', 'overviewView');
const decisionsView = lazy('./views/registers.js', 'decisionsView'),
  evidenceView = lazy('./views/registers.js', 'evidenceView'),
  committeeHome = lazy('./views/committee.js', 'committeeHome');
const helpView = lazy('./views/help.js', 'helpView'),
  templatesView = lazy('./views/templates.js', 'templatesView');
const VIEWS = {
  '': ['home', homeView],
  projects: ['projects', projectsView],
  p: ['projects', projectView],
  requests: ['requests', requestsView],
  tasks: ['tasks', tasksView],
  commitments: ['commitments', commitmentsView],
  messages: ['messages', messagesView],
  committee: ['committee', committeeHome],
  reports: ['reports', reportsView],
  governance: ['governance', governanceView],
  settings: ['settings', settingsView],
  help: ['help', helpView],
  templates: ['templates', templatesView],
  overview: ['overview', overviewView],
  decisions: ['decisions', decisionsView],
  evidence: ['evidence', evidenceView],
};

let firstPaint = true;
async function route() {
  const my = ++renderToken;
  const { parts, query } = parseHash();
  const key0 = parts[0];
  if (parts[0] === 'login' || !session.token) {
    ctx.me = null;
    document.title = 'محور — الدخول';
    mount(
      app,
      loginView({
        onLogin: async (limited) => {
          await loadMe();
          location.hash = limited ? '#/settings' : '#/';
        },
      }),
    );
    return;
  }
  try {
    if (!ctx.me) await loadMe();
  } catch {
    location.hash = '#/login';
    return;
  }
  ctx.notice = (await api.get('/system/notice').catch(() => ({}))).notice || null;
  if (
    !ctx.me.limited &&
    ctx.nav.includes('projects') &&
    (!ctx.projectsAt || Date.now() - ctx.projectsAt > 15000 || key0 === 'p')
  ) {
    ctx.projects = (await api.get('/projects').catch(() => ({ items: [] }))).items;
    ctx.projectsAt = Date.now();
  }
  if (my !== renderToken) return;
  const key = parts[0] || '';
  if (ctx.me.limited && key !== 'settings') {
    location.hash = '#/settings';
    return;
  }
  let [cur, view] = VIEWS[key] || ['home', homeView];
  if (key === 'requests' && parts[1]) view = requestView;
  if (key === 'tasks' && query.scope === 'all' && ctx.nav.includes('orgtasks')) cur = 'orgtasks';
  if (key === 'p' && parts[2] === 'committee') cur = 'committee';
  // a section that is not in this person's menu is not theirs: say so instead of showing an empty or half-usable page.
  // Deep links to a single record (a request from a notification, a project) still open; the server decides access.
  if (NAV[cur] && !ctx.nav.includes(cur) && cur !== 'home' && cur !== 'committee' && key !== 'p' && !parts[1])
    view = async () => ({
      title: NAV[cur][0],
      el: emptyState(
        'هذا القسم خارج صلاحياتك',
        'تظهر لك في القائمة الأقسام المرتبطة بدورك فقط. إن كنت تحتاج هذا القسم فاطلب الصلاحية من مدير جهتك.',
        h('a', { class: 'btn primary', href: '#/' }, 'العودة إلى الرئيسية'),
        'no-access',
      ),
    });
  const content = h('div', { id: 'view' }, h('div', { class: 'empty' }, 'جارٍ التحميل…'));
  mount(app, shell(content, cur));
  if (!firstPaint && !$('#layer')?.children.length) $('#main')?.focus({ preventScroll: true }); // never pull focus out of an open dialog // first load keeps the skip link as the first tab stop; later navigations move focus to the content
  firstPaint = false;
  window.scrollTo(0, 0);
  try {
    const out = await view({ parts: parts.slice(1), query, ctx, go, refresh: route });
    if (my !== renderToken) return;
    if (out?.title) document.title = `${out.title} — محور`;
    else document.title = 'محور';
    {
      const a = document.getElementById('announce');
      if (a) {
        a.textContent = '';
        setTimeout(() => {
          a.textContent = out?.title ? `فُتحت صفحة ${out.title}` : '';
        }, 60);
      }
    }
    const v = out?.el || out;
    mount(content, v);
    out?.after?.();
    makeScrollersKeyboardReachable(content);
  } catch (e) {
    if (my !== renderToken) return;
    const et = e.status === 404 ? 'غير موجود' : e.status === 403 ? 'غير متاح لك' : 'تعذّر تحميل الصفحة';
    document.title = `${et} — محور`;
    mount(
      content,
      h(
        'div',
        { class: 'card pad' },
        h('h1', { class: 'sr-only' }, et),
        emptyState(
          et,
          e.message,
          h('a', { class: 'btn', href: '#/' }, 'العودة للرئيسية'),
          e.status === 403 ? 'no-access' : 'error',
        ),
      ),
    );
  }
}
window.addEventListener('hashchange', route);

// global shortcuts
let gPending = false;
let gTimer;
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = ['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable;
  if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
    if (!ctx.me) return;
    e.preventDefault();
    openSearch();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || !ctx.me || $('#layer').children.length) return;
  if (e.key === '?') {
    shortcuts();
    return;
  }
  if (gPending) {
    gPending = false;
    clearTimeout(gTimer);
    const m = { h: '#/', p: '#/projects', r: '#/requests', t: '#/tasks', m: '#/messages' }[e.key.toLowerCase()];
    if (m) location.hash = m;
    return;
  }
  if (e.key.toLowerCase() === 'g') {
    gPending = true;
    gTimer = setTimeout(() => {
      gPending = false;
    }, 900);
    return;
  }
  if (e.key.toLowerCase() === 'n') {
    $('.topbar .btn.primary')?.click();
  }
});

route();
initA11y();
// Tables reflow into labelled cards on narrow screens instead of scrolling sideways: each cell carries its column header.
let labelQueued = false;
const labelTables = () => {
  labelQueued = false;
  document.querySelectorAll('table.tbl').forEach((tb) => {
    const heads = [...tb.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!heads.length) return;
    tb.classList.add('tbl-stack');
    tb.querySelectorAll('tbody tr').forEach((tr) =>
      [...tr.children].forEach((td, i) => {
        if (!td.hasAttribute('data-label') && !td.hasAttribute('colspan')) td.setAttribute('data-label', heads[i] || '');
      }),
    );
  });
};
new MutationObserver(() => {
  if (labelQueued) return;
  labelQueued = true;
  setTimeout(labelTables, 0);
}).observe(document.body, { childList: true, subtree: true });
// FORM-014: tell the person when the connection drops or returns; drafts stay in the open dialog and writes are retried with the same idempotency key
window.addEventListener('offline', () =>
  toast('انقطع الاتصال. ما كتبتَه محفوظ في النافذة المفتوحة؛ أعد المحاولة عند عودة الاتصال.', 'err'),
);
window.addEventListener('online', () => toast('عاد الاتصال', 'ok'));

// A scrollable table wrapper must be reachable and operable from the keyboard (WCAG 2.1.1).
function makeScrollersKeyboardReachable(root) {
  const mark = () =>
    root.querySelectorAll('*').forEach((el) => {
      if (el.hasAttribute('tabindex') || el.closest('[hidden]')) return;
      const cs = getComputedStyle(el);
      const scrolls = /(auto|scroll)/.test(cs.overflowX + cs.overflowY);
      if (
        scrolls &&
        (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight) &&
        !el.querySelector('a[href], button, input, select, textarea, [tabindex]')
      ) {
        el.tabIndex = 0;
        el.setAttribute('role', 'region');
        if (!el.getAttribute('aria-label'))
          el.setAttribute(
            'aria-label',
            el.closest('section')?.querySelector('h2,h3')?.textContent.trim() || 'منطقة قابلة للتمرير',
          );
      } else if (scrolls && el.classList.contains('scroll-x') && el.scrollWidth > el.clientWidth + 1) {
        el.tabIndex = 0;
        el.setAttribute('role', 'region');
        el.setAttribute(
          'aria-label',
          el.closest('section')?.querySelector('h2,h3')?.textContent.trim() || 'جدول قابل للتمرير',
        );
      }
    });
  mark();
  setTimeout(mark, 400);
}
