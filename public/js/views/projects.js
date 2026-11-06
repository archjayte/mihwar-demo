import { api } from '../api.js';
import {
  h,
  mount,
  $$,
  icon,
  toast,
  badge,
  fmtDate,
  fmtDT,
  ago,
  modal,
  drawer,
  popover,
  formDialog,
  confirmDialog,
  emptyState,
  progressBar,
  avatar,
} from '../ui.js';
import { kv, section, noticeEl, reqRow, breadcrumb, relatedPanel } from '../shared.js';
import { uploadFile, fileField, fileButton } from '../files.js';
import { requestForm } from './requests.js';
import { committeeTab } from './committee.js';
import { enableBoardDnD } from '../dnd.js';

const PSTATUS = { PLANNING: ['قيد التخطيط', 'attention'], ACTIVE: ['نشط', 'progress'], CLOSED: ['مغلق', 'done'] };
const ISSUE_STATUS = {
  PROPOSED: ['بانتظار اعتماد الدليل', 'attention'],
  OPEN: ['مفتوح', 'attention'],
  APPROVED: ['معتمد كاستثناء', 'success'],
  REJECTED: ['مرفوض', 'danger'],
  RESOLVED: ['مغلق', 'done'],
};

// ============================================================ projects list
export async function projectsView({ query, ctx, go, refresh }) {
  const r = await api.get('/projects');
  const grid = h(
    'div',
    { class: 'grid auto' },
    r.items.map((p) => projectCard(p)),
  );
  const el = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', null, 'المشاريع'),
        h('div', { class: 'sub' }, 'المشاريع المشتركة التي تشارك فيها جهتك أو تشرف عليها.'),
      ),
      r.can_create
        ? h(
            'button',
            { class: 'btn primary', onclick: () => newProjectChoice(ctx, go) },
            icon('plus', 16),
            'مشروع جديد',
          )
        : null,
    ),
    r.invitations.length
      ? h(
          'div',
          { class: 'card' },
          h('div', { class: 'card-h' }, h('h2', null, 'دعوات مشاركة تنتظر قرار جهتك')),
          h(
            'ul',
            { class: 'list' },
            r.invitations.map((i) =>
              h(
                'li',
                null,
                h(
                  'div',
                  { class: 'grow' },
                  h('b', null, i.name),
                  h('div', { class: 'small muted' }, `${i.lead_org} · ${fmtDate(i.start)} – ${fmtDate(i.end)}`),
                  h('div', { class: 'small' }, i.objective),
                ),
                i.can_decide
                  ? [
                      h(
                        'button',
                        { class: 'btn primary sm', onclick: () => answerInvite(i, 'accept', refresh) },
                        'قبول المشاركة',
                      ),
                      h(
                        'button',
                        { class: 'btn sm danger', onclick: () => answerInvite(i, 'decline', refresh) },
                        'اعتذار',
                      ),
                    ]
                  : badge('القرار لمفوّض الجهة', 'neutral'),
              ),
            ),
          ),
        )
      : null,
    r.items.length
      ? grid
      : h(
          'div',
          { class: 'card' },
          emptyState(
            'لا مشاريع بعد',
            r.can_create
              ? 'ابدأ بإنشاء مشروع مشترك ثم أضف الجهات المشاركة.'
              : 'ستظهر هنا المشاريع عند دعوة جهتك للمشاركة فيها.',
          ),
        ),
  );
  if (query.new && r.can_create)
    setTimeout(
      () => (query.blank ? projectForm(ctx, (p) => go(`#/p/${p.id}/overview`)) : newProjectChoice(ctx, go)),
      50,
    );
  return { title: 'المشاريع', el };
}

function projectCard(p) {
  const [sl, st] = PSTATUS[p.status] || ['—', 'neutral'];
  return h(
    'a',
    { class: 'card link pad col', href: `#/p/${p.id}/overview` },
    h('div', { class: 'row nowrap' }, h('h2', { class: 'grow' }, p.name), badge(sl, st)),
    h('div', { class: 'small muted' }, `${p.ref} · ${p.lead_org}`),
    h(
      'p',
      {
        class: 'small',
        style: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
      },
      p.objective,
    ),
    h(
      'div',
      null,
      progressBar(p.progress.verified, p.progress.operational),
      h(
        'div',
        { class: 'row small', style: { justifyContent: 'space-between', marginBlockStart: '4px' } },
        h('span', null, 'منجز معتمد ', h('b', { class: 'num' }, `${p.progress.verified}%`)),
        h('span', { class: 'muted' }, 'تشغيلي ', h('span', { class: 'num' }, `${p.progress.operational}%`)),
      ),
    ),
    h(
      'div',
      { class: 'row small muted' },
      `${p.wp_count} حزمة`,
      p.delayed ? badge(`${p.delayed} متأخرة`, 'danger') : null,
      !p.baseline_frozen ? badge('الخطة غير معتمدة', 'attention') : null,
      h('span', { class: 'grow' }),
      `${p.orgs.length} جهات`,
    ),
  );
}

function answerInvite(i, decision, refresh) {
  if (decision === 'accept')
    confirmDialog({
      title: `قبول المشاركة في «${i.name}»`,
      text: 'ستصبح جهتكم طرفًا في المشروع ويمكن إسناد حزم عمل إليها. القبول يعني المشاركة فقط، وليس الالتزام بأي طلب.',
      ok: 'قبول المشاركة',
    }).then(async (ok) => {
      if (!ok) return;
      try {
        await api.post(`/projects/${i.id}/participation`, { decision });
        toast('قُبلت المشاركة', 'ok');
        refresh();
      } catch (e) {
        toast(e.message, 'err');
      }
    });
  else
    formDialog({
      title: `الاعتذار عن المشاركة في «${i.name}»`,
      fields: [{ name: 'reason', label: 'سبب الاعتذار', type: 'textarea', required: true }],
      submit: 'تأكيد الاعتذار',
      danger: true,
      onSubmit: async (v) => {
        await api.post(`/projects/${i.id}/participation`, { decision, reason: v.reason });
        toast('سُجّل الاعتذار', 'ok');
        refresh();
      },
    });
}

// two ways to start: from one of the ready templates (the prominent one) or from an empty project
function newProjectChoice(ctx, go) {
  const m = modal({
    title: 'كيف تريد أن تبدأ؟',
    body: h(
      'div',
      { class: 'stack' },
      h(
        'button',
        {
          class: 'choice primary',
          onclick: () => {
            m.close();
            go('#/templates');
          },
        },
        h('b', null, 'مشروع من نموذج جاهز'),
        h(
          'span',
          { class: 'small' },
          'اختر مجال مشروعك وتخصصه من مكتبة النماذج، وعدّل المراحل والمدد، ثم أنشئ المشروع كمسودة تخطيط.',
        ),
      ),
      h(
        'button',
        {
          class: 'choice',
          onclick: () => {
            m.close();
            projectForm(ctx, (p) => go(`#/p/${p.id}/overview`));
          },
        },
        h('b', null, 'مشروع فارغ'),
        h('span', { class: 'small' }, 'ابدأ باسم وأهداف وجهات مشاركة، وأضف حزم العمل بنفسك.'),
      ),
    ),
  });
}
async function projectForm(ctx, onDone) {
  const [u, adm] = await Promise.all([api.get('/demo/users'), api.get('/admin/overview')]);
  const myOrg = ctx.me.user.org_id;
  const orgs = u.orgs.filter((o) => o.id !== myOrg && !['registry', 'platform'].includes(o.id));
  const mates = adm.users
    .filter((x) => x.org_id === myOrg)
    .map((x) => ({ value: x.id, label: `${x.name} — ${x.title}` }));
  formDialog({
    title: 'مشروع مشترك جديد',
    wide: true,
    fields: [
      { name: 'name', label: 'اسم المشروع', required: true },
      { name: 'objective', label: 'الهدف', type: 'textarea', required: true, rows: 3 },
      { name: 'start', label: 'تاريخ البداية', type: 'date', required: true, half: true },
      { name: 'end', label: 'تاريخ النهاية', type: 'date', required: true, half: true },
      {
        name: 'org_ids',
        label: 'الجهات المشاركة',
        type: 'checks',
        required: true,
        options: orgs.map((o) => ({ value: o.id, label: o.name })),
        hint: 'تصلها دعوة مشاركة، ولا تُسند إليها حزم عمل قبل أن تقبل.',
      },
      { name: 'chair_id', label: 'رئيس اللجنة', type: 'select', required: true, options: mates, half: true },
      {
        name: 'deputy_id',
        label: 'نائب الرئيس',
        type: 'select',
        options: mates,
        half: true,
        hint: 'يعمل بالنيابة عن الرئيس فقط عند تفويضه تفويضًا صريحًا',
      },
      { name: 'secretary_id', label: 'أمين اللجنة', type: 'select', required: true, options: mates, half: true },
    ],
    submit: 'إنشاء المشروع',
    onSubmit: async (v) => {
      const r = await api.post('/projects', v);
      toast('أُنشئ المشروع وأُرسلت دعوات المشاركة', 'ok');
      onDone(r.project);
    },
  });
}

// ============================================================ project workspace
let lastTabs = [];
let lastProject = null;
window.addEventListener('keydown', (e) => {
  if (
    !['[', ']'].includes(e.key) ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    /input|textarea|select/i.test(e.target.tagName) ||
    document.querySelector('#layer')?.children.length
  )
    return;
  const m = location.hash.match(/^#\/p\/([^/?]+)\/?([^?]*)/);
  if (!m || m[1] !== lastProject) return;
  const i = lastTabs.indexOf(m[2] || 'overview');
  const n = lastTabs[i + (e.key === ']' ? 1 : -1)];
  if (n) location.hash = `#/p/${m[1]}/${n}`;
});

export async function projectView({ parts, query, ctx, go, refresh }) {
  const [id, tab = 'overview'] = parts;
  const { project: p, orgs, committee, steps, stats, baseline, related } = await api.get(`/projects/${id}`);
  const [sl, st] = PSTATUS[p.status] || ['—', 'neutral'];
  const tabs = [
    ['overview', 'نظرة عامة'],
    ['board', 'لوحة العمل'],
    ['timeline', 'الجدول الزمني'],
    ['team', 'الفريق والأحمال'],
    ['inbox', 'صندوق التعاون'],
    ['requests', 'الطلبات'],
  ];
  if (p.caps.committee_role || ctx.me.user.roles.includes('FINAL_AUDITOR')) tabs.splice(5, 0, ['committee', 'اللجنة']);
  lastTabs = tabs.map((x) => x[0]);
  lastProject = id;
  try {
    localStorage.setItem(`mihwar.ptab.${id}`, JSON.stringify(tab));
    const rec = JSON.parse(localStorage.getItem('mihwar.recent') || '[]').filter((x) => x !== id);
    localStorage.setItem('mihwar.recent', JSON.stringify([id, ...rec].slice(0, 8)));
  } catch {
    /* ignore */
  }
  const pinned = (ctx.me.prefs?.pinned || []).includes(id);
  const pinBtn = h(
    'button',
    {
      class: 'iconbtn pin-btn',
      'aria-pressed': String(pinned),
      'aria-label': pinned ? 'إلغاء تثبيت المشروع' : 'تثبيت المشروع في القائمة الجانبية',
      title: pinned ? 'إلغاء التثبيت' : 'تثبيت في القائمة الجانبية',
      onclick: async () => {
        const cur = ctx.me.prefs?.pinned || [];
        const next = pinned ? cur.filter((x) => x !== id) : [...cur, id];
        try {
          const r = await api.put('/me/prefs', { pinned: next });
          ctx.me.prefs = r.prefs;
          toast(pinned ? 'أُلغي التثبيت' : 'ثُبّت المشروع في القائمة الجانبية', 'ok');
          refresh();
        } catch (e) {
          toast(e.message, 'err');
        }
      },
    },
    pinned ? '★' : '☆',
  );
  const switcher =
    (ctx.projects || []).length > 1
      ? h(
          'select',
          {
            class: 'proj-switch',
            'aria-label': 'تبديل المشروع',
            onchange: (e) => {
              location.hash = `#/p/${e.target.value}/${tab}`;
            },
          },
          ctx.projects.map((x) => h('option', { value: x.id, selected: x.id === id ? true : null }, x.name)),
        )
      : null;
  const head = h(
    'div',
    { class: 'stack' },
    breadcrumb([
      ['المشاريع', '#/projects'],
      [p.ref, `#/p/${id}/overview`],
      [(tabs.find((x) => x[0] === tab) || [0, p.name])[1]],
    ]),
    h(
      'div',
      { class: 'page-head', style: { marginBlockEnd: '10px' } },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', null, p.name),
        h('div', { class: 'sub' }, `${p.orgs.map((o) => o.name).join(' · ')}`),
      ),
      switcher,
      pinBtn,
      badge(sl, st),
      !p.baseline_frozen ? badge('الخطة غير معتمدة', 'attention') : badge('الخطة معتمدة', 'success'),
    ),
    h(
      'div',
      { class: 'card pad' },
      h(
        'div',
        { class: 'grid c3' },
        h(
          'div',
          null,
          h('div', { class: 'small muted' }, 'الإنجاز'),
          progressBar(p.progress.verified, p.progress.operational),
          h(
            'div',
            { class: 'row small', style: { marginBlockStart: '4px', justifyContent: 'space-between' } },
            h('span', null, 'معتمد ', h('b', { class: 'num' }, `${p.progress.verified}%`)),
            h('span', { class: 'muted' }, 'تشغيلي ', h('span', { class: 'num' }, `${p.progress.operational}%`)),
          ),
        ),
        h(
          'div',
          null,
          h('div', { class: 'small muted' }, 'المدة'),
          h('div', null, `${fmtDate(p.start)} – ${fmtDate(p.end)}`),
          h('div', { class: 'xs muted' }, `${p.wp_count} حزمة عمل`),
        ),
        h(
          'div',
          null,
          h('div', { class: 'small muted' }, 'تنبيهات'),
          h(
            'div',
            { class: 'row' },
            p.delayed ? badge(`${p.delayed} حزم متأخرة`, 'danger') : badge('لا تأخير محتسب', 'success'),
            stats.wp_awaiting_release ? badge(`${stats.wp_awaiting_release} بانتظار التصريح`, 'attention') : null,
            stats.awaiting_review ? badge(`${stats.awaiting_review} مخرجات للمراجعة`, 'attention') : null,
          ),
        ),
      ),
    ),
    h(
      'nav',
      { class: 'tabs', 'aria-label': 'أقسام المشروع' },
      tabs.map(([k, l]) =>
        h(
          'a',
          { href: `#/p/${id}/${k}`, 'aria-current': k === tab ? 'page' : null },
          l,
          k === 'requests' && stats.requests_total ? h('span', { class: 'n' }, stats.requests_total) : null,
        ),
      ),
    ),
  );
  const body = h('div', { id: 'tabbody' });
  const fn =
    {
      overview: () => overviewTab({ p, orgs, committee, steps, stats, baseline, related, ctx, refresh, go }),
      board: () => boardTab({ p, ctx, query, refresh, go }),
      timeline: () => timelineTab({ p, ctx, refresh }),
      requests: () => requestsTab({ p, ctx, refresh, go }),
      team: () => teamTab({ p, query, go }),
      inbox: () => inboxTab({ p, ctx, go }),
      committee: () => committeeTab({ p, ctx, query, refresh }),
    }[tab] || (() => h('div'));
  const content = await fn();
  mount(body, content);
  return {
    title: `${(tabs.find((x) => x[0] === tab) || [0, ''])[1]} — ${p.name}`,
    el: h('div', { class: 'stack' }, head, body),
  };
}

// ---------------- overview
function overviewTab({ p, orgs, committee, steps, stats, baseline, related, ctx, refresh }) {
  const c = p.caps;
  const next = steps?.length
    ? h(
        'div',
        { class: 'guide' },
        h('b', null, 'الخطوة التالية'),
        h(
          'ul',
          { class: 'check-list', style: { marginBlockStart: '8px' } },
          steps.map((s) =>
            h(
              'li',
              null,
              h('span', { class: 'ok' }, icon('chev', 14)),
              h('span', null, s.text, ' ', s.link ? h('a', { href: s.link }, s.cta || 'افتح') : null),
            ),
          ),
        ),
      )
    : null;
  const statChips = [
    ['requests_total', 'كل الطلبات'],
    ['at_committee', 'لدى اللجنة'],
    ['at_org', 'لدى الجهات'],
    ['in_execution', 'قيد التنفيذ'],
  ];
  const partBadge = (st) =>
    badge(
      { ACCEPTED: 'قبلت', INVITED: 'بانتظار القبول', DECLINED: 'اعتذرت' }[st] || st,
      { ACCEPTED: 'success', INVITED: 'attention', DECLINED: 'danger' }[st],
    );
  const orgRows = orgs.map((o) =>
    h(
      'tr',
      null,
      h('td', null, h('b', null, o.name)),
      h('td', null, o.role === 'lead' ? 'الجهة القائدة' : 'جهة مشاركة'),
      h('td', null, partBadge(o.status)),
      h('td', { class: 'small' }, o.reps.map((r) => r.name).join('، ') || '—'),
    ),
  );
  const orgTable = h(
    'div',
    { class: 'scroll-x' },
    h(
      'table',
      { class: 'tbl' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          ['الجهة', 'الدور', 'حالة المشاركة', 'الممثلون'].map((x) => h('th', null, x)),
        ),
      ),
      h('tbody', null, orgRows),
    ),
  );
  const freeze =
    c.manage_project && !baseline.frozen
      ? h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'اعتماد خطة المشروع',
                text: `سيُجمَّد خط الأساس بمجموع أوزان ${baseline.weight_total}٪. بعد الاعتماد لا تُعدَّل المواعيد والأوزان إلا بطلب تغيير.`,
                ok: 'اعتماد الخطة',
              });
              if (!ok) return;
              try {
                await api.post(`/projects/${p.id}/freeze-baseline`);
                toast('اعتُمدت خطة المشروع', 'ok');
                refresh();
              } catch (e) {
                toast(e.message, 'err');
              }
            },
          },
          'اعتماد الخطة',
        )
      : null;
  const baselineBody = h(
    'div',
    { class: 'col' },
    kv([
      ['الحالة', baseline.frozen ? `معتمد — الإصدار ${baseline.version}` : 'غير معتمد'],
      ['مجموع الأوزان', `${baseline.weight_total}٪`],
    ]),
    h(
      'div',
      { class: 'small muted' },
      baseline.frozen
        ? 'المواعيد والأوزان والاعتماديات مجمّدة. أي تعديل يمر عبر طلب تغيير يعتمده المتأثرون.'
        : 'أضف الحزم حتى يبلغ مجموع الأوزان ١٠٠٪ ثم اعتمد الخطة لتبدأ تصاريح البدء.',
    ),
    freeze,
  );
  const closeCard =
    c.manage_project && p.status !== 'CLOSED'
      ? section(
          'إغلاق المشروع',
          h(
            'div',
            { class: 'col' },
            h('p', { class: 'small muted' }, 'لا يُغلق المشروع وفيه التزامات أو طلبات أو حزم مفتوحة.'),
            h('button', { class: 'btn danger', onclick: () => closeProject(p, refresh) }, 'إغلاق المشروع'),
          ),
        )
      : null;
  const left = h(
    'div',
    { class: 'stack' },
    section('الأهداف', h('p', null, p.objective)),
    section('الجهات المشاركة', orgTable),
    stats.cr_pending
      ? noticeEl(
          `يوجد ${stats.cr_pending} طلب تغيير على خط الأساس بانتظار الاعتماد — راجعه في تبويب «الجدول الزمني».`,
          'warn',
          'alert',
        )
      : null,
  );
  const right = h(
    'div',
    { class: 'stack' },
    section(
      'لجنة المشروع',
      kv([
        ['الرئيس', committee.chair?.name],
        ['النائب', committee.deputy?.name],
        ['الأمين', committee.secretary?.name],
        ['الأعضاء', committee.members.map((m) => `${m.name} (${m.org})`).join('، ') || '—'],
      ]),
    ),
    section('خط الأساس', baselineBody),
    closeCard,
  );
  const rl = related || {};
  const relPanel = relatedPanel([
    { label: 'سجل القرارات', href: `#/decisions?project_id=${p.id}`, count: rl.decisions },
    { label: 'سجل الأدلة', href: `#/evidence?project_id=${p.id}`, count: rl.evidence },
    { label: 'حزم العمل', href: `#/p/${p.id}/board`, count: rl.work_packages },
    { label: 'الطلبات بين الجهات', href: `#/p/${p.id}/requests`, count: rl.requests },
    rl.tasks ? { label: 'مهام المشروع', href: '#/tasks', count: rl.tasks } : null,
    p.caps.committee_role || ctx.me.user.roles.includes('FINAL_AUDITOR')
      ? { label: 'لجنة المشروع', href: `#/p/${p.id}/committee` }
      : null,
    rl.threads ? { label: 'محادثات المشروع', href: '#/messages', count: rl.threads } : null,
    rl.template
      ? {
          label: `أصل المشروع: قالب «${rl.template.name}»`,
          sub: `الإصدار ${rl.template.version} · بصمة ${String(rl.template.snapshot_hash || '').slice(0, 12)}`,
        }
      : null,
  ]);
  return h(
    'div',
    { class: 'stack' },
    next,
    h(
      'div',
      { class: 'grid c4 keep2' },
      statChips.map(([k, l]) =>
        h(
          'a',
          { class: 'kpi', href: `#/p/${p.id}/requests` },
          h('span', { class: 'v num' }, stats[k] ?? 0),
          h('span', { class: 'l' }, l),
        ),
      ),
    ),
    h('div', { class: 'split-layout' }, left, right),
    h('div', { class: 'card pad' }, relPanel),
  );
}

async function closeProject(p, refresh) {
  if (
    !(await confirmDialog({
      title: 'إغلاق المشروع',
      text: 'سيحاول النظام إغلاق المشروع، وإن وُجد ما هو مفتوح فسيعرضه عليك.',
      ok: 'محاولة الإغلاق',
      danger: true,
    }))
  )
    return;
  try {
    await api.post(`/projects/${p.id}/close`);
    toast('أُغلق المشروع', 'ok');
    refresh();
  } catch (e) {
    const d = e.details || {};
    modal({
      title: 'تعذّر إغلاق المشروع',
      body: [
        noticeEl(e.message, 'err', 'alert'),
        d.requests?.length
          ? h(
              'div',
              null,
              h('h4', null, 'طلبات مفتوحة'),
              h(
                'ul',
                { class: 'check-list' },
                d.requests.map((x) => h('li', null, `${x.ref} — ${x.status}`)),
              ),
            )
          : null,
        d.commitments?.length
          ? h(
              'div',
              null,
              h('h4', null, 'التزامات سارية'),
              h(
                'ul',
                { class: 'check-list' },
                d.commitments.map((x) => h('li', null, `${x.org} — ${x.request}`)),
              ),
            )
          : null,
        d.work_packages?.length
          ? h(
              'div',
              null,
              h('h4', null, 'حزم غير مقبولة'),
              h(
                'ul',
                { class: 'check-list' },
                d.work_packages.map((x) =>
                  h('li', null, typeof x === 'string' ? x : `${x.ref || ''} ${x.title || ''}`),
                ),
              ),
            )
          : null,
      ],
    });
  }
}

// ---------------- board
const lsGet = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage may be blocked */
  }
};

async function boardTab({ p, ctx, query, refresh }) {
  const b = await api.get(`/projects/${p.id}/board`);
  const caps = b.caps;
  let mode = lsGet(`mihwar.board.${p.id}.mode`, 'wp');
  const KEY = `mihwar.board.${p.id}`;
  const F0 = { q: '', org: '', owner: '', mine: false, late: false, group: 'none', dense: false };
  let F = { ...F0, ...lsGet(KEY, {}) };
  const area = h('div');
  const toolbar = h('div', { class: 'toolbar', role: 'search', 'aria-label': 'مرشحات اللوحة' });
  const save = () => lsSet(KEY, F);
  const orgs = [...new Map(b.items.map((i) => [i.owner_org_id, i.owner_org_name])).entries()];
  const owners = [
    ...new Set([...b.items.map((i) => i.owner_name), ...b.tasks.map((t) => t.assignee_name)].filter(Boolean)),
  ];
  const active = () =>
    ['q', 'org', 'owner'].filter((k) => F[k]).length + (F.mine ? 1 : 0) + (F.late ? 1 : 0) + (F.attn ? 1 : 0);
  const okWp = (i) =>
    (!F.q || `${i.title} ${i.ref} ${i.owner_org_name}`.includes(F.q)) &&
    (!F.org || i.owner_org_id === F.org) &&
    (!F.owner || i.owner_name === F.owner) &&
    (!F.mine || i.mine) &&
    (!F.late || i.delay?.accountable > 0) &&
    (!F.attn || i.actions.some((a) => a.enabled && a.kind === 'primary' && ['release', 'review'].includes(a.key)));
  const okTask = (t) =>
    (!F.q || `${t.title} ${t.ref}`.includes(F.q)) &&
    (!F.owner || t.assignee_name === F.owner) &&
    (!F.mine || t.can_edit) &&
    (!F.late || t.overdue);
  const gate = {
    DRAFT: 'تُجهَّز وتُفحص جاهزيتها',
    AWAITING_RELEASE: 'بانتظار أمر البدء من المفوّض',
    RELEASED: 'صدر التصريح — للجهة أن تبدأ',
    IN_EXECUTION: 'تنفيذ وأدلة',
    ORG_SUBMITTED: 'مراجعة مستقلة للمخرج',
    ACCEPTED: 'مقبول — يُحتسب في الإنجاز المعتمد',
    CLOSED: 'مغلق',
  };
  const stateEl = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });
  const announce = (m) => {
    stateEl.textContent = m;
  };
  const drop = async (to, id) => {
    const w = b.items.find((x) => x.id === id);
    if (!w || w.status === to) return;
    if (['ACCEPTED', 'CLOSED'].includes(to)) {
      toast('القبول والإغلاق لا يتمان بالسحب: افتح الحزمة واستخدم «مراجعة المخرج» ليُسجَّل قرارك بالأدلة.', 'err');
      return;
    }
    if (to === 'RELEASED') {
      toast('تصريح البدء يصدر بأمر صريح من المفوّض: افتح الحزمة واضغط «إصدار تصريح البدء».', 'err');
      return;
    }
    try {
      await api.post(`/work-packages/${id}/transition`, { to });
      toast('انتقلت الحزمة', 'ok');
      announce('انتقلت الحزمة');
      refresh();
    } catch (e) {
      if (e.code === 'NOT_READY') {
        openWp(id, { p, ctx, refresh, caps });
        toast('الحزمة غير مستوفية لشروط الجاهزية — راجع القائمة', 'err');
      } else if (e.code === 'STALE_VERSION') toast('تغيّرت الحزمة منذ فتحت الصفحة — حدّث اللوحة', 'err');
      else toast(e.message, 'err');
      refresh();
    }
  };
  const moveDialog = (w) =>
    formDialog({
      title: `نقل ${w.ref}`,
      intro: 'بديل لوحة المفاتيح واللمس عن السحب. تُطبَّق قواعد الانتقال نفسها في الخادم.',
      fields: [
        {
          name: 'to',
          label: 'المرحلة',
          type: 'select',
          placeholder: false,
          options: b.stages.filter((s) => s.key !== w.status).map((s) => ({ value: s.key, label: s.label })),
          required: true,
        },
      ],
      submit: 'نقل',
      onSubmit: async (v) => {
        await drop(v.to, w.id);
      },
    });
  const card = (i) => {
    const c = wpCard(i, () => openWp(i.id, { p, ctx, refresh, caps }));
    c.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        moveDialog(i);
      }
    });
    return c;
  };
  const wpCanDrop = (to) =>
    ['ACCEPTED', 'CLOSED'].includes(to)
      ? { ok: false, reason: 'القبول والإغلاق بالمراجعة الرسمية فقط' }
      : to === 'RELEASED'
        ? { ok: false, reason: 'يصدر بأمر تصريح البدء من المفوّض' }
        : { ok: true };
  const dropTask = async (to, id) => {
    try {
      await api.patch(`/tasks/${id}`, { status: to });
      toast('حُدّثت حالة المهمة', 'ok');
      announce('حُدّثت حالة المهمة');
      refresh();
    } catch (e) {
      toast(e.message, 'err');
      refresh();
    }
  };
  const attention = () =>
    b.items.filter((i) =>
      i.actions.some((a) => a.enabled && a.kind === 'primary' && ['release', 'review'].includes(a.key)),
    );
  const alertCard = () => {
    const n = attention();
    if (!n.length && !b.items.some((i) => i.open_issues)) return null;
    const iss = b.items.reduce((a, i) => a + (i.open_issues || 0), 0);
    return h(
      'div',
      { class: 'decision-alert', role: 'region', 'aria-label': 'تنبيه القرار' },
      h(
        'div',
        { class: 'grow' },
        h('b', null, 'إجراءات حوكمة تنتظر مراجعتك'),
        h(
          'div',
          { class: 'small muted' },
          `${n.length ? `${n.length} حزمة تنتظر تصريحًا أو مراجعة` : 'لا إجراء رسميًا ينتظرك'}${iss ? ` · ${iss} عائق مفتوح` : ''}. السحب لا يعتمد العمل؛ القبول والتصريح بالإجراء الرسمي فقط.`,
        ),
      ),
      n.length
        ? h(
            'button',
            {
              class: 'btn sm',
              'aria-pressed': String(!!F.attn),
              onclick: () => {
                F.attn = !F.attn;
                save();
                redraw();
              },
            },
            F.attn ? 'عرض كل الحزم' : 'عرض المراجعات',
          )
        : null,
    );
  };
  const draw = () => {
    const [lanes, extra] = mode === 'wp' ? wpLanes() : taskLanes();
    const boardEl = h(
      'div',
      {
        class: `board${F.dense ? ' dense' : ''}`,
        role: 'group',
        'aria-label': mode === 'wp' ? 'لوحة حزم العمل' : 'لوحة المهام',
      },
      lanes,
    );
    mount(area, mode === 'wp' ? alertCard() : null, boardEl, extra);
    enableBoardDnD({
      board: boardEl,
      announce,
      canDrop: mode === 'wp' ? wpCanDrop : () => ({ ok: true }),
      onDrop: mode === 'wp' ? drop : dropTask,
      onDeny: (to, id) => {
        if (mode === 'wp') drop(to, id);
      },
      canDrag: (c) => c.dataset.nodrag !== '1',
    });
  };
  // lane chrome shared by both boards: header with count and a ⋯ menu (collapse, sort), and an optional add button
  const LS = () => (F.lanes = F.lanes || {});
  const laneMenu = (s, sorts) =>
    h(
      'button',
      {
        class: 'iconbtn lane-menu',
        'aria-label': `خيارات عمود ${s.label}`,
        'aria-haspopup': 'menu',
        onclick: (e) => {
          const st = LS()[s.key] || {};
          const btn = e.currentTarget;
          const item = (label, fn) =>
            h(
              'button',
              {
                role: 'menuitem',
                onclick: () => {
                  pop.close();
                  fn();
                  save();
                  redraw();
                },
              },
              label,
            );
          const pop = popover(
            btn,
            h(
              'div',
              { class: 'menu', role: 'menu' },
              item(st.collapsed ? 'توسيع العمود' : 'طي العمود', () => {
                LS()[s.key] = { ...st, collapsed: !st.collapsed };
              }),
              ...sorts.map(([k, l]) =>
                item(`${st.sort === k ? '✓ ' : ''}فرز: ${l}`, () => {
                  LS()[s.key] = { ...st, sort: st.sort === k ? '' : k };
                }),
              ),
            ),
          );
        },
      },
      '⋯',
    );
  const sortItems = (items, key) => {
    const k = (LS()[key] || {}).sort;
    if (!k) return items;
    const c = {
      end: (x, y) => (x.planned_end || '9').localeCompare(y.planned_end || '9'),
      weight: (x, y) => (y.weight || 0) - (x.weight || 0),
      title: (x, y) => x.title.localeCompare(y.title, 'ar'),
    }[k];
    return c ? [...items].sort(c) : items;
  };
  const laneEl = (s, items, kids, { gateText, add, sorts }) => {
    const st = LS()[s.key] || {};
    if (st.collapsed) {
      const l = h(
        'section',
        { class: 'lane collapsed', dataset: { key: s.key }, 'aria-label': s.label },
        h(
          'button',
          {
            class: 'lane-expand',
            'aria-label': `توسيع عمود ${s.label}`,
            onclick: () => {
              LS()[s.key] = { ...st, collapsed: false };
              save();
              redraw();
            },
          },
          h('span', { class: 'n' }, items.length),
          h('span', { class: 'v' }, s.label),
        ),
      );
      return l;
    }
    return h(
      'section',
      { class: 'lane', dataset: { key: s.key }, 'aria-label': s.label },
      h(
        'header',
        null,
        h('span', { class: 'grow' }, s.label),
        h('span', { class: 'n' }, items.length),
        laneMenu(s, sorts),
      ),
      gateText ? h('div', { class: 'gate' }, gateText) : null,
      kids,
      !items.length
        ? h('div', { class: 'xs muted', style: { padding: '6px' } }, active() ? 'لا نتائج بهذه المرشحات' : 'لا عناصر')
        : null,
      add || null,
    );
  };
  const wpLanes = () => {
    const shown = b.items.filter(okWp);
    return [
      b.stages.map((s) => {
        const items = sortItems(
          shown.filter((i) => i.status === s.key),
          s.key,
        );
        const kids =
          F.group === 'org'
            ? [...new Set(items.map((i) => i.owner_org_name))].flatMap((o) => [
                h('div', { class: 'grp-h' }, o),
                items.filter((i) => i.owner_org_name === o).map(card),
              ])
            : items.map(card);
        return laneEl(s, items, kids, {
          gateText: gate[s.key],
          sorts: [
            ['end', 'الموعد'],
            ['weight', 'الوزن'],
            ['title', 'العنوان'],
          ],
          add:
            s.key === 'DRAFT' && caps.create_wp
              ? h(
                  'button',
                  { class: 'lane-add', onclick: () => wpForm({ p, b, refresh }) },
                  icon('plus', 14),
                  'إضافة حزمة',
                )
              : null,
        });
      }),
      !b.items.length
        ? emptyState(
            'لا حزم عمل بعد',
            caps.create_wp ? 'أضف أول حزمة عمل لتبدأ بناء الخطة.' : 'لم يضف المنسّق حزم عمل بعد.',
          )
        : !shown.length
          ? h('div', { class: 'small muted' }, 'لا حزم تطابق المرشحات الحالية.')
          : null,
    ];
  };
  const taskLanes = () => {
    const shown = b.tasks.filter(okTask);
    return [
      b.task_stages.map((s) => {
        const items = sortItems(
          shown.filter((t) => t.status === s.key),
          s.key,
        );
        return laneEl(
          s,
          items,
          items.map((t) => taskCard(t)),
          {
            sorts: [
              ['end', 'الموعد'],
              ['title', 'العنوان'],
            ],
            add: caps.org_member
              ? h('button', { class: 'lane-add', onclick: () => taskAdd(s) }, icon('plus', 14), 'إضافة مهمة')
              : null,
          },
        );
      }),
      h('div', { class: 'small muted' }, 'تظهر هنا مهامك ومهام جهتك فقط؛ مهام الجهات الأخرى الداخلية لا تُعرض.'),
    ];
  };
  const taskAdd = (s) =>
    formDialog({
      title: `مهمة جديدة — ${s.label}`,
      intro: 'تُنشأ لك داخل هذا المشروع في العمود المختار. يمكنك لاحقًا إسنادها من صفحة المهام.',
      fields: [
        { name: 'title', label: 'عنوان المهمة', required: true },
        { name: 'planned_end', label: 'الموعد', type: 'date' },
      ],
      submit: 'إنشاء',
      onSubmit: async (v) => {
        const r = await api.post('/tasks', {
          project_id: p.id,
          title: v.title,
          assignee_id: ctx.me.user.id,
          planned_end: v.planned_end || undefined,
        });
        if (s.key !== 'TODO' && r.task?.id) await api.patch(`/tasks/${r.task.id}`, { status: s.key });
        toast('أُنشئت المهمة', 'ok');
        refresh();
      },
    });
  // The reset button lives in its own slot so the search field can update it without rebuilding the toolbar
  // (rebuilding removes the focused field while its own change event is still being dispatched).
  const resetSlot = h('span', { class: 'toolbar-slot' });
  const syncReset = () =>
    mount(
      resetSlot,
      active()
        ? h(
            'button',
            {
              class: 'btn sm ghost',
              onclick: () => {
                F = { ...F0, dense: F.dense, group: F.group };
                save();
                redraw();
              },
            },
            `إعادة ضبط (${active()})`,
          )
        : null,
    );
  let rebuilding = false;
  const buildToolbar = () => {
    const focused = toolbar.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focused && (focused.getAttribute('aria-label') || focused.textContent);
    const q = h('input', {
      type: 'search',
      placeholder: 'بحث في اللوحة…',
      value: F.q,
      'aria-label': 'بحث في اللوحة',
      onchange: (e) => {
        F.q = e.target.value.trim();
        save();
        syncReset();
        draw();
      },
    });
    const sel = (key, label, opts) =>
      h(
        'select',
        {
          'aria-label': label,
          onchange: (e) => {
            F[key] = e.target.value;
            save();
            redraw();
          },
        },
        h('option', { value: '' }, label),
        opts.map(([v, l]) => h('option', { value: v, selected: F[key] === v ? true : null }, l)),
      );
    const tog = (key, label) =>
      h(
        'button',
        {
          class: 'chipbtn',
          'aria-pressed': String(!!F[key]),
          onclick: () => {
            F[key] = !F[key];
            save();
            redraw();
          },
        },
        label,
      );
    const views = lsGet(`${KEY}.views`, {});
    const viewSel = h(
      'select',
      {
        'aria-label': 'العروض المحفوظة',
        onchange: (e) => {
          const v = views[e.target.value];
          if (v) {
            F = { ...F0, ...v };
            save();
            redraw();
          }
        },
      },
      h('option', { value: '' }, 'العروض المحفوظة'),
      Object.keys(views).map((n) => h('option', { value: n }, n)),
    );
    mount(
      toolbar,
      q,
      mode === 'wp' ? sel('org', 'كل الجهات', orgs) : null,
      sel(
        'owner',
        'كل المسؤولين',
        owners.map((o) => [o, o]),
      ),
      tog('mine', 'لي فقط'),
      tog('late', 'المتأخرة'),
      mode === 'wp'
        ? h(
            'select',
            {
              'aria-label': 'تجميع',
              onchange: (e) => {
                F.group = e.target.value;
                save();
                redraw();
              },
            },
            [
              ['none', 'بلا تجميع'],
              ['org', 'تجميع حسب الجهة'],
            ].map(([v, l]) => h('option', { value: v, selected: F.group === v ? true : null }, l)),
          )
        : null,
      tog('dense', 'عرض مضغوط'),
      viewSel,
      h(
        'button',
        {
          class: 'btn sm',
          onclick: () =>
            formDialog({
              title: 'حفظ العرض الحالي',
              fields: [{ name: 'name', label: 'اسم العرض', required: true }],
              submit: 'حفظ',
              onSubmit: async (v) => {
                const vs = lsGet(`${KEY}.views`, {});
                vs[v.name] = F;
                lsSet(`${KEY}.views`, vs);
                toast('حُفظ العرض على هذا المتصفح', 'ok');
                redraw();
              },
            }),
        },
        'حفظ العرض',
      ),
      resetSlot,
    );
    syncReset();
    if (focusKey) {
      const again = [...toolbar.querySelectorAll('input, select, button')].find(
        (c) => (c.getAttribute('aria-label') || c.textContent) === focusKey,
      );
      again?.focus();
    }
  };
  const drawToolbar = () => {
    if (rebuilding) return;
    rebuilding = true;
    try {
      buildToolbar();
    } finally {
      rebuilding = false;
    }
  };
  const redraw = () => {
    drawToolbar();
    draw();
  };
  const seg = h(
    'div',
    { class: 'seg' },
    [
      ['wp', `حزم العمل (${b.items.length})`],
      ['tasks', `المهام (${b.tasks.length})`],
    ].map(([k, l]) =>
      h(
        'button',
        {
          'aria-pressed': String(k === mode),
          onclick: (e) => {
            mode = k;
            lsSet(`${KEY}.mode`, k);
            $$('button', seg).forEach((x) => x.setAttribute('aria-pressed', String(x === e.currentTarget)));
            redraw();
          },
        },
        l,
      ),
    ),
  );
  redraw();
  const addWp = caps.create_wp
    ? h(
        'button',
        { class: 'btn primary', onclick: () => wpForm({ p, b, refresh }) },
        icon('plus', 16),
        'حزمة عمل جديدة',
      )
    : null;
  if (query.wp) setTimeout(() => openWp(query.wp, { p, ctx, refresh, caps }), 60);
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'row' },
      seg,
      h('div', { class: 'grow' }),
      h(
        'span',
        { class: 'small muted' },
        'اسحب البطاقة، أو ركّز عليها واضغط المسطرة ثم الأسهم للنقل (أو M لنافذة النقل). القبول والتصريح بالإجراء الرسمي فقط.',
      ),
      addWp,
    ),
    toolbar,
    stateEl,
    area,
  );
}

function wpCard(i, open) {
  const lateTone = i.delay?.accountable > 0;
  const next = i.actions.find((a) => a.kind === 'primary' && a.enabled);
  const card = h(
    'button',
    {
      class: `kcard${i.mine ? ' mine' : ''}`,
      dataset: { id: i.id },
      onclick: open,
      'aria-label': `${i.ref} ${i.title}`,
      'aria-roledescription': 'بطاقة قابلة للنقل',
    },
    h(
      'div',
      { class: 'row nowrap' },
      h('span', { class: 'grip', 'aria-hidden': 'true', title: 'اسحب للنقل' }, '⋮⋮'),
      h('span', { class: 'xs muted num' }, i.ref),
      h('div', { class: 'grow' }),
      lateTone ? badge(`متأخرة ${i.delay.accountable} يوم`, 'danger') : null,
      i.open_issues ? badge(`${i.open_issues} عائق`, 'attention') : null,
    ),
    h('div', { class: 'ttl' }, i.title),
    h('div', { class: 'meta' }, icon('users', 13), i.owner_org_name, '·', `وزن ${i.weight}٪`),
    i.status === 'IN_EXECUTION' || i.status === 'ORG_SUBMITTED'
      ? h('div', null, progressBar(0, i.self_pct, true))
      : null,
    h('div', { class: 'meta' }, icon('clock', 13), `${fmtDate(i.planned_start)} – ${fmtDate(i.planned_end)}`),
    !i.deps_ok ? h('div', { class: 'meta' }, badge('بانتظار حزم سابقة', 'neutral')) : null,
    next ? h('div', { class: 'next' }, `← ${next.label}`) : null,
  );
  return card;
}
function taskCard(t) {
  const card = h(
    'a',
    {
      class: `kcard${t.can_edit ? ' mine' : ''}`,
      href: `#/tasks?task=${t.id}`,
      dataset: { id: t.id, nodrag: t.can_edit ? '0' : '1' },
      'aria-label': `${t.ref} ${t.title}`,
      style: { textDecoration: 'none', color: 'inherit' },
    },
    h(
      'div',
      { class: 'row nowrap' },
      t.can_edit ? h('span', { class: 'grip', 'aria-hidden': 'true', title: 'اسحب للنقل' }, '⋮⋮') : null,
      h('span', { class: 'xs muted num' }, t.ref),
      h('div', { class: 'grow' }),
      t.overdue ? badge('متأخرة', 'danger') : null,
    ),
    h('div', { class: 'ttl' }, t.title),
    h(
      'div',
      { class: 'meta' },
      t.assignee_name || 'غير مسندة',
      t.planned_end ? ` · حتى ${fmtDate(t.planned_end)}` : '',
    ),
    t.completion_pct ? progressBar(0, t.completion_pct, true) : null,
  );
  return card;
}

// ---------------- work package drawer
export async function openWp(id, { p, ctx, refresh, caps }) {
  let data;
  try {
    data = await api.get(`/work-packages/${id}`);
  } catch (e) {
    toast(e.message, 'err');
    return;
  }
  const w = data.work_package;
  const d = drawer({ title: w.title, sub: `${w.ref} · ${w.owner_org_name}`, body: wpBody(w), footer: [] });
  const reload = () => {
    d.close();
    refresh();
  };
  const doTransition = async (to, msg) => {
    try {
      await api.post(`/work-packages/${w.id}/transition`, { to });
      toast(msg, 'ok');
      reload();
    } catch (e) {
      if (e.code === 'NOT_READY') {
        showReadiness(e.details?.checks);
      } else toast(e.message, 'err');
    }
  };
  const showReadiness = (checks) => d.setBody(wpBody(w, checks));
  const handlers = {
    'check-readiness': async () => {
      try {
        const r = await api.post(`/work-packages/${w.id}/readiness-check`);
        d.setBody(wpBody(w, r.readiness.checks, r.readiness.ok));
        toast(
          r.readiness.ok ? 'الحزمة مستوفية لشروط الجاهزية' : 'توجد شروط غير مستوفاة',
          r.readiness.ok ? 'ok' : 'err',
        );
      } catch (e) {
        toast(e.message, 'err');
      }
    },
    release: () =>
      formDialog({
        title: `إصدار تصريح البدء — ${w.ref}`,
        intro: 'أمر البدء قرار صريح يُسجَّل باسمك ويُربط بلقطة من فحص الجاهزية. لا يبدأ التنفيذ بدونه.',
        fields: [{ name: 'note', label: 'ملاحظة الأمر (اختياري)', type: 'textarea' }],
        submit: 'إصدار التصريح',
        onSubmit: async (v) => {
          await api.post(`/work-packages/${w.id}/release`, v);
          toast('صدر تصريح البدء', 'ok');
          reload();
        },
      }),
    start: () => doTransition('IN_EXECUTION', 'بدأ التنفيذ'),
    'add-evidence': () => {
      const ff = fileField('الملف');
      formDialog({
        title: 'إرفاق دليل',
        intro:
          'يُرفع الملف فعليًا مع فحص النوع والمحتوى والحجم، وتُحسب بصمته. يظهر للجهة القائدة والمنسّق ومفوّض القبول واللجنة والمدققين فقط.',
        fields: [{ name: 'title', label: 'عنوان الدليل', required: true }],
        submit: 'إرفاق',
        note: ff.el,
        onSubmit: async (v) => {
          const f = ff.input.files[0];
          if (!f) throw new Error('اختر ملف الدليل');
          const up = await uploadFile(p.id, f, { onStatus: ff.status });
          await api.post(`/work-packages/${w.id}/evidence`, { title: v.title, file_id: up.id });
          toast('أُرفق الدليل', 'ok');
          reload();
        },
      });
    },
    submit: () => doTransition('ORG_SUBMITTED', 'سُلّم المخرج للمراجعة'),
    withdraw: () => doTransition('IN_EXECUTION', 'سُحب التسليم'),
    review: () =>
      formDialog({
        title: `مراجعة المخرج — ${w.ref}`,
        intro: `تحقق من معايير القبول والأدلة (${w.evidence.length} من ${w.required_evidence}). قبولك يضيف ${w.weight}٪ إلى الإنجاز المعتمد.`,
        fields: [
          {
            name: 'decision',
            label: 'القرار',
            type: 'select',
            placeholder: false,
            options: [
              { value: 'accept', label: 'قبول المخرج' },
              { value: 'return', label: 'إعادته للتصحيح' },
            ],
            value: 'accept',
          },
          { name: 'note', label: 'ملاحظة المراجعة', type: 'textarea', hint: 'إلزامية عند الإعادة' },
        ],
        submit: 'تسجيل القرار',
        onSubmit: async (v) => {
          await api.post(`/work-packages/${w.id}/review`, v);
          toast(v.decision === 'accept' ? 'قُبل المخرج وارتفع الإنجاز المعتمد' : 'أُعيد المخرج للتصحيح', 'ok');
          reload();
        },
      }),
    close: async () => {
      if (
        await confirmDialog({ title: 'إغلاق الحزمة', text: 'ستُغلق الحزمة المقبولة ولن تتغير بعد ذلك.', ok: 'إغلاق' })
      ) {
        try {
          await api.post(`/work-packages/${w.id}/close`);
          toast('أُغلقت الحزمة', 'ok');
          reload();
        } catch (e) {
          toast(e.message, 'err');
        }
      }
    },
    'raise-issue': () =>
      formDialog({
        title: 'تسجيل عائق',
        intro:
          'العائق الداخلي يُسجَّل للمتابعة. العائق الخارجي الموثّق بدليل قد يُستثنى من التأخير المحتسب على الجهة بعد اعتماد المنسّق.',
        fields: [
          { name: 'title', label: 'وصف العائق', required: true },
          {
            name: 'kind',
            label: 'نوعه',
            type: 'select',
            placeholder: false,
            options: [
              { value: 'internal', label: 'داخلي (من الجهة)' },
              { value: 'external', label: 'خارجي (خارج سيطرة الجهة)' },
            ],
            value: 'internal',
          },
          { name: 'days', label: 'أيام التأخر الناتجة (للخارجي)', type: 'number', half: true, min: 1 },
          { name: 'proof', label: 'الدليل أو المرجع الموثّق (للخارجي)', half: true },
          {
            name: 'blocking',
            label: 'هل يمنع المتابعة؟',
            type: 'select',
            placeholder: false,
            options: [
              { value: 'no', label: 'لا، يؤخر فقط' },
              { value: 'yes', label: 'نعم، يمنع المتابعة' },
            ],
            value: 'no',
          },
        ],
        submit: 'تسجيل العائق',
        onSubmit: async (v) => {
          await api.post(`/work-packages/${w.id}/issues`, { ...v, blocking: v.blocking === 'yes' });
          toast('سُجّل العائق', 'ok');
          reload();
        },
      }),
  };
  const btns = w.actions.map((a) =>
    h(
      'button',
      {
        class: `btn ${a.kind === 'primary' ? 'primary' : ''}`,
        disabled: !a.enabled ? true : null,
        title: a.reason || '',
        onclick: handlers[a.key],
      },
      a.label,
    ),
  );
  if (w.status === 'DRAFT' && w.actions.some((a) => a.key === 'check-readiness'))
    btns.unshift(
      h(
        'button',
        { class: 'btn primary', onclick: () => doTransition('AWAITING_RELEASE', 'رُفعت الحزمة لطلب تصريح البدء') },
        'رفع لطلب تصريح البدء',
      ),
    );
  if (w.status === 'AWAITING_RELEASE' && w.actions.some((a) => a.key === 'check-readiness'))
    btns.push(
      h(
        'button',
        { class: 'btn ghost', onclick: () => doTransition('DRAFT', 'أُعيدت إلى المسودة') },
        'سحب من الانتظار',
      ),
    );
  const dis = w.actions.filter((a) => !a.enabled && a.reason);
  d.setFooter(
    btns,
    dis.length
      ? h(
          'div',
          { class: 'xs muted', style: { flexBasis: '100%' } },
          dis.map((a) => `${a.label}: ${a.reason}`).join(' — '),
        )
      : null,
  );
  if (!btns.length) d.setFooter(h('span', { class: 'small muted' }, 'لا إجراء متاح لك على هذه الحزمة الآن.'));
}

// Neighbours of a work package: the request(s) and commitment(s) that feed it, team tasks, decisions and its position in the dependency chain.
function wpRelated(w) {
  const r = w.related;
  if (!r) return null;
  const pid = w.project_id;
  const items = [
    ...r.requests.map((x) => ({
      label: `${x.ref} — ${x.title}`,
      href: `#/requests/${x.id}`,
      sub: [x.status_ar, x.target_org_name].filter(Boolean).join(' · '),
    })),
    ...r.commitments.map((c) => ({
      label: `الالتزام: ${c.org_name}`,
      href: `#/requests/${c.request_id}`,
      sub: `${c.status === 'ACTIVE' ? 'ساري' : 'مغلق'}${c.due_on ? ' · ' + fmtDate(c.due_on) : ''}`,
    })),
    ...r.tasks.map((t) => ({
      label: `${t.ref} — ${t.title}`,
      href: `#/tasks?task=${t.id}`,
      sub: [t.status_ar, t.assignee_name].filter(Boolean).join(' · '),
    })),
    r.tasks_total > r.tasks.length ? { label: 'كل مهام الحزمة', href: '#/tasks', count: r.tasks_total } : null,
    r.decisions_total
      ? { label: 'قرارات الحزمة في سجل القرارات', href: `#/decisions?project_id=${pid}`, count: r.decisions_total }
      : null,
    w.evidence_count
      ? { label: 'أدلة الحزمة في سجل الأدلة', href: `#/evidence?project_id=${pid}`, count: w.evidence_count }
      : null,
    ...r.depends_on.map((x) => ({
      label: `تعتمد على ${x.ref} — ${x.title}`,
      href: `#/p/${pid}/board?wp=${x.id}`,
      sub: x.status_ar,
    })),
    ...r.dependents.map((x) => ({ label: `يعتمد عليها ${x.ref} — ${x.title}`, href: `#/p/${pid}/board?wp=${x.id}` })),
    { label: 'الجدول الزمني للمشروع', href: `#/p/${pid}/timeline` },
  ];
  return relatedPanel(items, undefined, 'h4');
}

function wpBody(w, checks, okFlag) {
  const rd = checks || w.readiness?.checks;
  const ready = checks ? (okFlag ?? checks.every((c) => c.ok)) : w.readiness?.ok;
  const parts = [
    h(
      'div',
      { class: 'row' },
      badge(w.status_ar, w.tone),
      w.delay?.accountable > 0 ? badge(`تأخر محتسب ${w.delay.accountable} يوم`, 'danger') : null,
      w.delay?.external_approved > 0 ? badge(`استثناء خارجي ${w.delay.external_approved} يوم`, 'success') : null,
    ),
    w.description ? h('p', null, w.description) : null,
    kv([
      ['المسؤول', w.owner_name || 'لم يُحدَّد'],
      ['الوزن', `${w.weight}٪ من المشروع`],
      ['المواعيد', `${fmtDate(w.planned_start)} – ${fmtDate(w.planned_end)}`],
      w.baseline_start
        ? ['خط الأساس', `${fmtDate(w.baseline_start)} – ${fmtDate(w.baseline_end)} (إصدار ${w.baseline_version})`]
        : null,
      ['الإنجاز الذاتي', `${w.self_pct}٪ (تقدير الجهة — لا يُحتسب معتمدًا قبل قبول المخرج)`],
    ]),
    w.depends_on?.length
      ? h(
          'div',
          null,
          h('h4', null, 'تعتمد على'),
          h(
            'ul',
            { class: 'check-list', style: { marginBlockStart: '6px' } },
            w.depends_on.map((x) =>
              h(
                'li',
                null,
                h('span', { class: x.done ? 'ok' : 'no' }, icon(x.done ? 'check' : 'clock', 15)),
                `${x.ref} — ${x.title}`,
              ),
            ),
          ),
        )
      : null,
    h(
      'div',
      null,
      h('h4', null, 'معايير القبول'),
      h(
        'ul',
        { class: 'check-list', style: { marginBlockStart: '6px' } },
        w.criteria.map((c) => h('li', null, h('span', { class: 'muted' }, icon('flag', 14)), c)),
      ),
    ),
    rd
      ? h(
          'div',
          null,
          h('h4', null, `فحص الجاهزية ${ready ? '— مستوفٍ' : '— غير مستوفٍ'}`),
          h(
            'ul',
            { class: 'check-list', style: { marginBlockStart: '6px' } },
            rd.map((c) =>
              h(
                'li',
                null,
                h('span', { class: c.ok ? 'ok' : 'no' }, icon(c.ok ? 'check' : 'x', 15)),
                h('span', null, c.label, c.detail ? h('span', { class: 'xs muted' }, ` (${c.detail})`) : null),
              ),
            ),
          ),
        )
      : null,
    w.release
      ? h(
          'div',
          { class: 'notice ok' },
          icon('shield', 18),
          h(
            'div',
            null,
            h('b', null, `أمر البدء ${w.release.order_no}`),
            h(
              'div',
              { class: 'xs' },
              `${w.release.by_name} · ${fmtDT(w.release.at)}${w.release.note ? ' — ' + w.release.note : ''}`,
            ),
          ),
        )
      : null,
    h(
      'div',
      null,
      h('h4', null, `الأدلة (${w.evidence_count} من ${w.required_evidence} مطلوبة)`),
      w.evidence?.length
        ? h(
            'ul',
            { class: 'check-list', style: { marginBlockStart: '6px' } },
            w.evidence.map((e) =>
              h(
                'li',
                null,
                h('span', { class: 'muted' }, icon('doc', 15)),
                h(
                  'span',
                  null,
                  h('b', null, e.title),
                  h(
                    'div',
                    { class: 'xs muted' },
                    `${e.file_name || ''} · ${e.by_name} · ${ago(e.at)}${e.sha256 ? ' · SHA-256 ' + e.sha256.slice(0, 10) + '…' : ''}`,
                  ),
                ),
                h('span', { class: 'grow' }),
                fileButton(e),
              ),
            ),
          )
        : h(
            'div',
            { class: 'small muted' },
            w.evidence_hidden ? 'الأدلة ظاهرة للجهة المنفذة وللمراجعين.' : 'لا أدلة بعد.',
          ),
    ),
    w.issues?.length
      ? h(
          'div',
          null,
          h('h4', null, 'العوائق'),
          h(
            'ul',
            { class: 'check-list', style: { marginBlockStart: '6px' } },
            w.issues.map((i) =>
              h(
                'li',
                null,
                h('span', { class: 'no' }, icon('alert', 15)),
                h(
                  'span',
                  null,
                  i.title,
                  ' ',
                  badge(...(ISSUE_STATUS[i.status] || [i.status, 'neutral'])),
                  i.days ? h('span', { class: 'xs muted' }, ` ${i.days} يوم`) : null,
                ),
              ),
            ),
          ),
        )
      : null,
    null,
  ];
  const [badges, desc, facts, deps, criteria, readiness, release, evidence, issues] = parts;
  const approvals = (w.history || []).filter((x) => /release|review|accept|return|close|approve/i.test(x.action));
  const activity = [
    issues,
    h(
      'ul',
      { class: 'check-list' },
      [...(w.history || [])]
        .reverse()
        .map((x) =>
          h(
            'li',
            null,
            h('span', { class: 'muted' }, icon('clock', 13)),
            h(
              'span',
              null,
              `${x.note || x.action}`,
              h('div', { class: 'xs muted' }, `${x.actor_name} · ${fmtDT(x.at)}`),
            ),
          ),
        ),
    ),
  ];
  const chat = h(
    'div',
    { class: 'col' },
    h('div', { class: 'small muted' }, 'المحادثة للتنسيق فقط ولا تُغيّر حالة الحزمة ولا تُعد قبولًا أو اعتمادًا.'),
    h('a', { class: 'btn sm', href: `#/messages?new=1` }, icon('chat', 14), 'محادثة جديدة'),
    h('a', { class: 'btn sm ghost', href: `#/p/${w.project_id}/inbox` }, 'صندوق تعاون المشروع'),
  );
  const panes = {
    details: [badges, desc, facts, deps, criteria, readiness, wpRelated(w)],
    evidence: [evidence],
    approvals: [
      release || h('div', { class: 'small muted' }, 'لم يصدر أمر بدء بعد.'),
      h(
        'div',
        null,
        h('h4', null, 'قرارات المراجعة والاعتماد'),
        approvals.length
          ? h(
              'ul',
              { class: 'check-list', style: { marginBlockStart: '6px' } },
              approvals.map((x) =>
                h(
                  'li',
                  null,
                  h('span', { class: 'muted' }, icon('shield', 14)),
                  h(
                    'span',
                    null,
                    x.note || x.action,
                    h('div', { class: 'xs muted' }, `${x.actor_name} · ${fmtDT(x.at)}`),
                  ),
                ),
              ),
            )
          : h('div', { class: 'small muted' }, 'لا قرارات مراجعة بعد.'),
      ),
    ],
    activity,
    chat: [chat],
  };
  const labels = [
    ['details', 'التفاصيل'],
    ['evidence', `الأدلة (${w.evidence_count})`],
    ['approvals', 'الاعتمادات'],
    ['activity', 'النشاط'],
    ['chat', 'محادثات'],
  ];
  const pane = h('div', { class: 'col', role: 'tabpanel' });
  const bar = h(
    'div',
    { class: 'seg wrapseg', role: 'tablist', 'aria-label': 'أقسام الحزمة' },
    labels.map(([k, l]) =>
      h(
        'button',
        {
          role: 'tab',
          'aria-selected': String(k === 'details'),
          onclick: (e) => {
            $$('button', bar).forEach((x) => x.setAttribute('aria-selected', String(x === e.currentTarget)));
            mount(pane, panes[k]);
          },
        },
        l,
      ),
    ),
  );
  mount(pane, panes.details);
  return [bar, pane];
}

async function wpForm({ p, b, refresh }) {
  const proj = await api.get(`/projects/${p.id}`);
  const orgOpts = proj.orgs.filter((o) => o.status === 'ACCEPTED').map((o) => ({ value: o.id, label: o.name }));
  const reps = Object.fromEntries(proj.orgs.map((o) => [o.id, o.reps]));
  const owner = h('select', null);
  const fillOwner = (orgId) =>
    mount(
      owner,
      h('option', { value: '' }, '— اختر المسؤول —'),
      (reps[orgId] || []).map((r) => h('option', { value: r.id }, `${r.name} — ${r.title}`)),
    );
  const used = b.items.reduce((s, x) => s + x.weight, 0);
  const m = formDialog({
    title: 'حزمة عمل جديدة',
    wide: true,
    intro: `مجموع أوزان الحزم الحالية ${used}٪ — يجب أن يبلغ ١٠٠٪ قبل اعتماد الخطة.`,
    fields: [
      { name: 'title', label: 'عنوان الحزمة', required: true },
      { name: 'description', label: 'الوصف', type: 'textarea', rows: 2 },
      { name: 'owner_org_id', label: 'الجهة المنفذة', type: 'select', required: true, options: orgOpts, half: true },
      {
        name: 'weight',
        label: 'الوزن (٪)',
        type: 'number',
        required: true,
        half: true,
        min: 0,
        max: 100,
        hint: `المتبقي ${100 - used}٪`,
      },
      { name: 'planned_start', label: 'البدء', type: 'date', required: true, half: true },
      { name: 'planned_end', label: 'الانتهاء', type: 'date', required: true, half: true },
      {
        name: 'depends_on',
        label: 'تعتمد على حزم',
        type: 'checks',
        options: b.items.map((i) => ({ value: i.id, label: `${i.ref} — ${i.title}` })),
      },
      { name: 'criteria', label: 'معايير القبول', type: 'lines', required: true, hint: 'كل معيار في سطر' },
      { name: 'required_evidence', label: 'عدد الأدلة المطلوبة', type: 'number', min: 1, max: 5, half: true, value: 1 },
    ],
    submit: 'إضافة الحزمة',
    onSubmit: async (v) => {
      v.owner_user_id = owner.value || undefined;
      await api.post(`/projects/${p.id}/work-packages`, v);
      toast('أُضيفت الحزمة', 'ok');
      refresh();
    },
  });
  const sel = m.box.querySelector('select[name="owner_org_id"]');
  const wrap = h(
    'div',
    { class: 'field full' },
    h('label', null, 'المسؤول في الجهة المنفذة'),
    owner,
    h('div', { class: 'hint' }, 'لازم لاستيفاء شروط الجاهزية قبل التصريح'),
  );
  sel.closest('.field').after(wrap);
  fillOwner('');
  sel.addEventListener('change', () => fillOwner(sel.value));
}

// ---------------- timeline / gantt
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
function downloadText(name, text, mime = 'text/csv;charset=utf-8') {
  const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + text], { type: mime })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 400);
}

async function timelineTab({ p, ctx, refresh }) {
  const t = await api.get(`/projects/${p.id}/timeline`);
  const items = t.items;
  const caps = t.caps;
  const KEY = `mihwar.tl.${p.id}`;
  const S = {
    ppd: null,
    base: true,
    deps: false,
    crit: false,
    group: false,
    period: 'all',
    from: '',
    to: '',
    ...lsGet(KEY, {}),
  };
  const persist = () =>
    lsSet(KEY, {
      ppd: S.ppd,
      base: S.base,
      deps: S.deps,
      crit: S.crit,
      group: S.group,
      period: S.period,
      from: S.from,
      to: S.to,
    });
  const DAY = 86400000;
  const parse = (s) => new Date(s + 'T00:00:00Z').getTime();
  const fmtD = (ms) => new Date(ms).toISOString().slice(0, 10);
  const starts = items.flatMap((i) => [i.planned_start, i.baseline_start].filter(Boolean)).concat(t.project.start);
  const ends = items.flatMap((i) => [i.planned_end, i.baseline_end].filter(Boolean)).concat(t.project.end);
  const fullMin = Math.min(...starts.map(parse)) - 7 * DAY;
  const fullMax = Math.max(...ends.map(parse)) + 14 * DAY;
  const avail = window.innerWidth >= 860 ? window.innerWidth - 244 - 48 - 230 - 24 : window.innerWidth - 130 - 28;
  // the displayed period: the whole project, the next N months from today, or a custom [from, to) window
  let min, max, span, fit;
  const applyPeriod = () => {
    const today = parse(t.today);
    const addMonths = (ms, n) => {
      const d = new Date(ms);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate());
    };
    if (S.period === 'custom' && S.from && S.to && parse(S.to) > parse(S.from)) {
      min = parse(S.from);
      max = parse(S.to);
    } else if (['3', '6', '12'].includes(S.period)) {
      min = today - 14 * DAY;
      max = addMonths(today, Number(S.period));
    } else {
      min = fullMin;
      max = fullMax;
    }
    span = Math.max(1, Math.round((max - min) / DAY));
    fit = Math.max(1.5, Math.min(40, Math.floor((avail / span) * 10) / 10));
  };
  applyPeriod();
  const inPeriod = (i) => parse(i.planned_end) >= min && parse(i.planned_start) < max;
  const PRESETS = { week: 24, month: 7, quarter: 2.5 };
  let ppd = S.ppd || fit;
  const rtl = () => getComputedStyle(document.documentElement).direction === 'rtl';
  const x = (s) => Math.round(((parse(s) - min) / DAY) * ppd);
  const widthOf = (i) => Math.max(8, Math.round(((parse(i.planned_end) - parse(i.planned_start)) / DAY) * ppd) + ppd);

  // critical path = the longest chain of dependent packages by duration
  const critical = (() => {
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    const memo = {};
    const dur = (i) => Math.round((parse(i.planned_end) - parse(i.planned_start)) / DAY) + 1;
    const best = (i, seen = new Set()) => {
      if (memo[i.id]) return memo[i.id];
      if (seen.has(i.id)) return { len: 0, path: [] };
      seen.add(i.id);
      let b = { len: 0, path: [] };
      for (const d of i.depends_on || []) {
        const dd = byId[d.id];
        if (!dd) continue;
        const r = best(dd, seen);
        if (r.len > b.len) b = r;
      }
      return (memo[i.id] = { len: b.len + dur(i), path: [...b.path, i.id] });
    };
    let top = { len: 0, path: [] };
    for (const i of items) {
      const r = best(i);
      if (r.len > top.len) top = r;
    }
    return new Set(top.path.length > 1 ? top.path : []);
  })();

  const holder = h('div');
  const status = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const order = () => {
    const shown = S.period === 'all' ? items : items.filter(inPeriod);
    return S.group
      ? [...shown].sort(
          (a, b) =>
            a.owner_org_name.localeCompare(b.owner_org_name, 'ar') || a.planned_start.localeCompare(b.planned_start),
        )
      : shown;
  };
  const scroller = () => holder.querySelector('.g-scroll');
  const scrollToToday = () => {
    const sc = scroller();
    if (!sc) return;
    const px = Math.max(0, x(t.today) - 220);
    sc.scrollLeft = rtl() ? -px : px;
  };

  // moving a bar proposes new dates. A frozen baseline turns it into a change request; before approval the plan can be edited directly.
  const proposeMove = (i, days) => {
    if (!days) return;
    const s = fmtD(parse(i.planned_start) + days * DAY);
    const e = fmtD(parse(i.planned_end) + days * DAY);
    if (p.baseline_frozen) {
      if (!caps.org_member) {
        toast('طلب التغيير لأعضاء الجهات المشاركة', 'err');
        return;
      }
      crForm(p, items, refresh, {
        wp_id: i.id,
        planned_start: s,
        planned_end: e,
        note: `نقل ${i.ref} من ${fmtDate(i.planned_start)} – ${fmtDate(i.planned_end)} إلى ${fmtDate(s)} – ${fmtDate(e)}. الخطة معتمدة: لا يتغير الموعد إلا باعتماد الجهات المتأثرة.`,
      });
    } else if (caps.create_wp) {
      confirmDialog({
        title: `تعديل موعد ${i.ref}`,
        text: `الخطة لم تُعتمد بعد، فيُعدَّل الموعد مباشرة إلى ${fmtDate(s)} – ${fmtDate(e)}.`,
        ok: 'تعديل الموعد',
      }).then(async (ok) => {
        if (!ok) {
          draw();
          return;
        }
        try {
          await api.patch(`/work-packages/${i.id}`, { planned_start: s, planned_end: e, version: i.version });
          toast('عُدّل الموعد', 'ok');
          refresh();
        } catch (err) {
          toast(err.message, 'err');
          draw();
        }
      });
    } else {
      toast('تعديل المواعيد للمنسّق قبل اعتماد الخطة، ولأعضاء الجهات عبر طلب تغيير بعد اعتمادها', 'err');
      draw();
    }
  };

  const makeBar = (i) => {
    const late = i.delay?.accountable > 0 && !['ACCEPTED', 'CLOSED'].includes(i.status);
    const bar = h(
      'button',
      {
        class: `g-bar s-${i.status}${late ? ' late' : ''}${S.crit && critical.has(i.id) ? ' crit' : ''}`,
        style: { insetInlineStart: `${x(i.planned_start)}px`, width: `${widthOf(i)}px` },
        title: `${i.ref} — ${i.title}\n${fmtDate(i.planned_start)} – ${fmtDate(i.planned_end)}\nاسحب لاقتراح موعد جديد، أو Alt+الأسهم من لوحة المفاتيح`,
        'aria-label': `${i.ref} ${i.title}. من ${fmtDate(i.planned_start)} إلى ${fmtDate(i.planned_end)}. Enter للتفاصيل، Alt مع الأسهم لاقتراح تغيير الموعد`,
      },
      h('i', { class: 'fill', style: { width: `${['ACCEPTED', 'CLOSED'].includes(i.status) ? 100 : i.self_pct}%` } }),
      h('span', null, i.title),
    );
    let down = null;
    let moved = false;
    let shift = 0;
    const tip = h('span', { class: 'g-tip' });
    bar.append(tip);
    const show = (d) => {
      shift = d;
      bar.style.transform = d ? `translateX(${(rtl() ? -1 : 1) * d * ppd}px)` : '';
      tip.textContent = d ? `${d > 0 ? '+' : ''}${d} يوم` : '';
      tip.style.display = d ? 'block' : 'none';
    };
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      down = e.clientX;
      moved = false;
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', (e) => {
      if (down == null) return;
      const dx = e.clientX - down;
      if (Math.abs(dx) > 5) moved = true;
      if (moved) show(Math.round((rtl() ? -dx : dx) / ppd));
    });
    bar.addEventListener('pointerup', () => {
      if (down == null) return;
      const d = shift;
      down = null;
      if (moved && d) {
        show(0);
        proposeMove(i, d);
      } else show(0);
      setTimeout(() => {
        moved = false;
      }, 0);
    });
    bar.addEventListener('pointercancel', () => {
      down = null;
      show(0);
    });
    bar.addEventListener('click', (e) => {
      if (moved) {
        e.preventDefault();
        return;
      }
      openWp(i.id, { p, ctx, refresh, caps });
    });
    bar.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const dir = (e.key === 'ArrowLeft') === rtl() ? 1 : -1;
        show(shift + dir * (e.shiftKey ? 7 : 1));
        status.textContent = `تحريك مقترح ${shift} يوم — Enter للتأكيد، Esc للإلغاء`;
      } else if (e.key === 'Enter' && shift) {
        e.preventDefault();
        e.stopPropagation();
        const d = shift;
        show(0);
        proposeMove(i, d);
      } else if (e.key === 'Escape' && shift) {
        e.stopPropagation();
        show(0);
        status.textContent = 'أُلغي التحريك';
      }
    });
    return bar;
  };

  const draw = () => {
    const W = span * ppd;
    const list = order();
    const months = [];
    let cur = new Date(min);
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1));
    const mf = new Intl.DateTimeFormat('ar-AE-u-nu-latn-ca-gregory', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
    while (cur.getTime() < max) {
      months.push([Math.round(((cur.getTime() - min) / DAY) * ppd), mf.format(cur)]);
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }
    const rowsOut = [];
    const namesOut = [];
    const rowIndex = {};
    let lastOrg = null;
    list.forEach((i) => {
      if (S.group && i.owner_org_name !== lastOrg) {
        lastOrg = i.owner_org_name;
        rowsOut.push(h('div', { class: 'g-row grp' }));
        namesOut.push(h('div', { class: 'nm grp' }, h('b', null, lastOrg)));
      }
      rowIndex[i.id] = rowsOut.length;
      const row = h('div', { class: 'g-row' }, makeBar(i));
      if (S.base && i.baseline_start)
        row.append(
          h('div', {
            class: 'g-base',
            title: 'خط الأساس المعتمد',
            style: {
              insetInlineStart: `${x(i.baseline_start)}px`,
              width: `${Math.max(6, Math.round(((parse(i.baseline_end) - parse(i.baseline_start)) / DAY) * ppd) + ppd)}px`,
            },
          }),
        );
      rowsOut.push(row);
      namesOut.push(
        h(
          'div',
          { class: 'nm', onclick: () => openWp(i.id, { p, ctx, refresh, caps }) },
          h(
            'b',
            { class: 'truncate' },
            i.title,
            S.crit && critical.has(i.id)
              ? h('span', { class: 'xs', style: { color: 'var(--danger)' } }, ' ◆ حرج')
              : null,
          ),
          h('span', { class: 'xs muted truncate' }, `${i.owner_org_name} · ${i.status_ar}`),
        ),
      );
    });
    let svg = null;
    if (S.deps) {
      const R = rtl();
      const ROW = 56;
      const lines = [];
      list.forEach((i) =>
        (i.depends_on || []).forEach((d) => {
          const from = items.find((z) => z.id === d.id);
          if (!from || rowIndex[from.id] == null) return;
          const o1 = x(from.planned_start) + widthOf(from);
          const o2 = x(i.planned_start);
          const X = (o) => (R ? W - o : o);
          const y1 = 48 + rowIndex[from.id] * ROW + 28;
          const y2 = 48 + rowIndex[i.id] * ROW + 28;
          const mid = X(o1) + (X(o2) - X(o1)) / 2;
          lines.push(
            `<path d="M${X(o1)},${y1} C${mid},${y1} ${mid},${y2} ${X(o2)},${y2}" fill="none" stroke="${S.crit && critical.has(i.id) && critical.has(from.id) ? 'var(--danger)' : 'var(--ink-3)'}" stroke-width="1.6" marker-end="url(#ar)"/>`,
          );
        }),
      );
      const box = h('div', {
        class: 'g-deps',
        'aria-hidden': 'true',
        html: `<svg width="${W}" height="${48 + rowsOut.length * ROW}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ar" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker></defs>${lines.join('')}</svg>`,
      });
      svg = box;
    }
    const gantt = h(
      'div',
      { class: 'gantt', style: { width: `${W}px`, overflow: 'hidden' } },
      h(
        'div',
        { class: 'g-head' },
        months.map(([l, n]) => h('div', { class: 'mo', style: { insetInlineStart: `${l}px` } }, n)),
      ),
      months.map(([l]) =>
        h('div', { class: 'g-grid', style: { insetInlineStart: `${l}px`, insetBlockStart: '48px' } }),
      ),
      h('div', { class: 'g-today', style: { insetInlineStart: `${x(t.today)}px` } }),
      rowsOut,
      svg,
    );
    mount(
      holder,
      h(
        'div',
        { class: 'gantt-wrap' },
        h(
          'div',
          { class: 'g-with-labels' },
          h('div', { class: 'g-names' }, h('div', { class: 'hd' }, 'حزمة العمل'), namesOut),
          h('div', { class: 'g-scroll', style: { overflowX: 'auto' } }, gantt),
        ),
      ),
    );
    requestAnimationFrame(scrollToToday);
  };
  const setPpd = (v, preset) => {
    ppd = Math.max(1.5, Math.min(40, v));
    S.ppd = preset ? preset : ppd;
    persist();
    draw();
    syncZoom();
  };
  const zoom = h('div', { class: 'seg', role: 'group', 'aria-label': 'نطاق العرض' });
  const syncZoom = () =>
    mount(
      zoom,
      h('button', { 'aria-label': 'تصغير', onclick: () => setPpd(ppd / 1.3) }, '−'),
      h('button', { 'aria-label': 'تكبير', onclick: () => setPpd(ppd * 1.3) }, '+'),
      [
        ['ملاءمة', fit],
        ['أسبوع', PRESETS.week],
        ['شهر', PRESETS.month],
        ['ربع سنة', PRESETS.quarter],
      ].map(([l, v]) => h('button', { 'aria-pressed': String(Math.abs(v - ppd) < 0.05), onclick: () => setPpd(v) }, l)),
    );
  syncZoom();
  const fromIn = h('input', { type: 'date', class: 'sm', 'aria-label': 'من تاريخ', value: S.from || fmtD(fullMin) });
  const toIn = h('input', { type: 'date', class: 'sm', 'aria-label': 'إلى تاريخ', value: S.to || fmtD(fullMax) });
  const custom = h('span', { class: 'g-period-custom', hidden: S.period !== 'custom' }, fromIn, '—', toIn);
  const setPeriod = () => {
    applyPeriod();
    ppd = fit;
    S.ppd = null;
    persist();
    draw();
    syncZoom();
  };
  const periodSel = h(
    'select',
    {
      class: 'sm',
      'aria-label': 'الفترة المعروضة',
      onchange: (e) => {
        S.period = e.target.value;
        custom.hidden = S.period !== 'custom';
        if (S.period === 'custom') {
          S.from = fromIn.value;
          S.to = toIn.value;
        }
        setPeriod();
      },
    },
    [
      ['all', 'كامل المشروع'],
      ['3', '٣ أشهر القادمة'],
      ['6', '٦ أشهر القادمة'],
      ['12', 'سنة قادمة'],
      ['custom', 'فترة مخصّصة…'],
    ].map(([v, l]) => h('option', { value: v, selected: S.period === v }, l)),
  );
  const onRange = () => {
    if (!fromIn.value || !toIn.value || toIn.value <= fromIn.value) return toast('تاريخ النهاية يجب أن يلي البداية', 'err');
    S.from = fromIn.value;
    S.to = toIn.value;
    setPeriod();
  };
  fromIn.addEventListener('change', onRange);
  toIn.addEventListener('change', onRange);
  const period = h('label', { class: 'g-period' }, h('span', { class: 'xs muted' }, 'الفترة'), periodSel, custom);
  const tog = (key, label, extra) =>
    h(
      'button',
      {
        class: 'chipbtn',
        'aria-pressed': String(!!S[key]),
        onclick: (e) => {
          S[key] = !S[key];
          persist();
          e.currentTarget.setAttribute('aria-pressed', String(S[key]));
          draw();
          extra?.();
        },
      },
      label,
    );
  const exportCsv = () =>
    downloadText(
      `${p.ref}-timeline.csv`,
      [
        'الرقم,الحزمة,الجهة,الحالة,البدء,الانتهاء,بدء الأساس,انتهاء الأساس,الوزن,الإنجاز الذاتي',
        ...order().map((i) =>
          [
            i.ref,
            i.title,
            i.owner_org_name,
            i.status_ar,
            i.planned_start,
            i.planned_end,
            i.baseline_start || '',
            i.baseline_end || '',
            i.weight,
            i.self_pct,
          ]
            .map(csvCell)
            .join(','),
        ),
      ].join('\r\n'),
    );
  const toolbar = h(
    'div',
    { class: 'toolbar' },
    period,
    zoom,
    h('button', { class: 'btn sm', onclick: scrollToToday }, 'اليوم'),
    tog('base', 'خط الأساس'),
    tog('deps', 'التبعيات'),
    tog('crit', 'المسار الحرج'),
    tog('group', 'تجميع حسب الجهة'),
    h('div', { class: 'grow' }),
    h('button', { class: 'btn sm', onclick: exportCsv }, icon('doc', 14), 'تصدير CSV'),
  );
  draw();

  // dependencies as a table too (alternative to the drawn lines)
  const depRows = items.flatMap((i) => (i.depends_on || []).map((d) => [d, i]));
  const depTable = h(
    'details',
    { class: 'card pad' },
    h(
      'summary',
      { class: 'small', style: { cursor: 'pointer' } },
      `جدول الاعتماديات (${depRows.length}) — بديل نصي للخطوط`,
    ),
    depRows.length
      ? h(
          'div',
          { class: 'scroll-x' },
          h(
            'table',
            { class: 'tbl' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                ['تسبق', 'ثم تبدأ', 'حالة السابقة'].map((z) => h('th', null, z)),
              ),
            ),
            h(
              'tbody',
              null,
              depRows.map(([d, i]) =>
                h(
                  'tr',
                  null,
                  h('td', null, `${d.ref} — ${d.title}`),
                  h('td', null, `${i.ref} — ${i.title}`),
                  h('td', null, d.done ? 'منجزة' : 'غير منجزة'),
                ),
              ),
            ),
          ),
        )
      : h('div', { class: 'small muted' }, 'لا اعتماديات معرّفة.'),
  );
  // change requests + issues
  const crs = t.change_requests;
  const issues = t.issues.filter((i) => ['PROPOSED', 'OPEN'].includes(i.status) || i.status === 'APPROVED');
  const crCard = section(
    'طلبات تغيير خط الأساس',
    crs.length
      ? h(
          'div',
          { class: 'col' },
          crs.map((c) =>
            h(
              'div',
              { class: 'card pad' },
              h(
                'div',
                { class: 'row' },
                h('b', null, c.ref),
                h('span', { class: 'small muted' }, `${c.requested_by_name} · ${fmtDate(c.at)}`),
              ),
              h('p', { class: 'small' }, c.reason),
              h(
                'ul',
                { class: 'check-list' },
                c.changes.map((ch) =>
                  h(
                    'li',
                    null,
                    h('span', { class: 'muted' }, icon('gantt', 14)),
                    `${ch.wp_ref} — ${ch.wp_title}: ${ch.planned_start ? `${fmtDate(ch.planned_start)} – ${fmtDate(ch.planned_end)}` : ''}${ch.weight != null ? ` وزن ${ch.weight}٪` : ''}`,
                  ),
                ),
              ),
              h('div', { class: 'small muted' }, c.impact),
              h(
                'div',
                { class: 'row small' },
                c.required.map((r) =>
                  badge(
                    `${r.org_name}: ${r.approval === 'approve' ? 'وافقت' : r.approval === 'reject' ? 'رفضت' : 'بانتظار'}`,
                    r.approval === 'approve' ? 'success' : r.approval === 'reject' ? 'danger' : 'attention',
                  ),
                ),
              ),
              c.can_decide
                ? h(
                    'div',
                    { class: 'row', style: { marginBlockStart: '8px' } },
                    h(
                      'button',
                      { class: 'btn primary sm', onclick: () => crDecide(c, 'approve', refresh) },
                      'اعتماد باسم جهتي',
                    ),
                    h('button', { class: 'btn danger sm', onclick: () => crDecide(c, 'reject', refresh) }, 'رفض'),
                  )
                : null,
            ),
          ),
        )
      : h(
          'div',
          { class: 'small muted' },
          p.baseline_frozen ? 'لا طلبات تغيير معلّقة.' : 'الخطة لم تُعتمد بعد؛ يمكن تعديل الحزم مباشرة.',
        ),
    p.baseline_frozen && caps.org_member
      ? h('button', { class: 'btn sm', onclick: () => crForm(p, items, refresh) }, icon('plus', 14), 'طلب تغيير')
      : null,
  );
  const issueCard = section(
    'العوائق والاستثناءات',
    issues.length
      ? h(
          'ul',
          { class: 'list' },
          issues.map((i) =>
            h(
              'li',
              null,
              h(
                'div',
                { class: 'grow' },
                h('b', null, i.title),
                h(
                  'div',
                  { class: 'xs muted' },
                  `${i.wp_ref} · ${i.raised_by_name} · ${i.kind === 'external' ? `خارجي ${i.days} يوم` : 'داخلي'}`,
                ),
                i.proof ? h('div', { class: 'xs' }, `الدليل: ${i.proof}`) : null,
              ),
              badge(...(ISSUE_STATUS[i.status] || [i.status, 'neutral'])),
              i.status === 'PROPOSED' && (caps.create_wp || caps.committee_role === 'chair')
                ? [
                    h(
                      'button',
                      { class: 'btn primary sm', onclick: () => issueDecide(i, 'approve', refresh) },
                      'اعتماد الاستثناء',
                    ),
                    h('button', { class: 'btn sm danger', onclick: () => issueDecide(i, 'reject', refresh) }, 'رفض'),
                  ]
                : null,
            ),
          ),
        )
      : h('div', { class: 'small muted' }, 'لا عوائق مفتوحة.'),
  );
  const legend = h(
    'div',
    { class: 'legend' },
    h('span', null, h('i', { style: { background: 'var(--brand)' } }), 'قيد التنفيذ'),
    h('span', null, h('i', { style: { background: 'var(--ok)' } }), 'مقبولة'),
    h('span', null, h('i', { style: { background: 'var(--signal)' } }), 'قيد المراجعة'),
    h('span', null, h('i', { style: { background: 'var(--line-strong)' } }), 'خط الأساس'),
    h(
      'span',
      null,
      h('i', { style: { background: 'transparent', boxShadow: '0 0 0 2px var(--danger)' } }),
      'تأخر محتسب',
    ),
  );
  return h(
    'div',
    { class: 'stack' },
    toolbar,
    legend,
    status,
    items.length
      ? holder
      : h('div', { class: 'card' }, emptyState('لا حزم عمل لعرضها', 'أضف حزم العمل من تبويب «لوحة العمل».')),
    items.length ? depTable : null,
    h(
      'div',
      { class: 'small muted' },
      p.baseline_frozen
        ? 'سحب الشريط يفتح طلب تغيير على خط الأساس المعتمد — لا يتغير الموعد قبل اعتماد الجهات المتأثرة.'
        : 'قبل اعتماد الخطة يمكن للمنسّق سحب الشريط لتعديل الموعد مباشرة.',
    ),
    h('div', { class: 'grid c2' }, crCard, issueCard),
  );
}

function crDecide(c, d, refresh) {
  formDialog({
    title: d === 'approve' ? `اعتماد ${c.ref}` : `رفض ${c.ref}`,
    intro:
      d === 'approve'
        ? 'يصدر خط أساس جديد عندما توافق كل الجهات المتأثرة. الإصدار القديم يبقى محفوظًا.'
        : 'رفض جهة واحدة كافٍ لرفض الطلب.',
    fields: [{ name: 'note', label: 'ملاحظة', type: 'textarea', required: d === 'reject' }],
    submit: d === 'approve' ? 'اعتماد' : 'رفض',
    danger: d === 'reject',
    onSubmit: async (v) => {
      const r = await api.post(`/change-requests/${c.id}/decide`, { decision: d, note: v.note });
      toast(r.change_request?.status === 'APPROVED' ? 'اعتُمد التغيير وصدر خط أساس جديد' : 'سُجّل قرارك', 'ok');
      refresh();
    },
  });
}
function issueDecide(i, d, refresh) {
  formDialog({
    title: d === 'approve' ? 'اعتماد استثناء التأخير' : 'رفض الاستثناء',
    intro: d === 'approve' ? `سيُخصم ${i.days} يوم من التأخير المحتسب على الجهة بناءً على الدليل الموثّق.` : '',
    fields: [{ name: 'note', label: 'ملاحظة القرار', type: 'textarea', required: d === 'reject' }],
    submit: d === 'approve' ? 'اعتماد' : 'رفض',
    danger: d === 'reject',
    onSubmit: async (v) => {
      await api.post(`/issues/${i.id}/decide`, { decision: d, note: v.note });
      toast('سُجّل القرار', 'ok');
      refresh();
    },
  });
}
function crForm(p, items, refresh, pre = {}) {
  formDialog({
    title: 'طلب تغيير على خط الأساس',
    intro: pre.note || 'المواعيد والأوزان معتمدة. اذكر ما تريد تغييره ومبرره؛ تتولى الجهات المتأثرة الاعتماد.',
    fields: [
      {
        name: 'wp_id',
        label: 'الحزمة',
        type: 'select',
        required: true,
        value: pre.wp_id,
        options: items.map((i) => ({ value: i.id, label: `${i.ref} — ${i.title}` })),
      },
      { name: 'planned_start', label: 'البدء الجديد', type: 'date', half: true, value: pre.planned_start },
      { name: 'planned_end', label: 'الانتهاء الجديد', type: 'date', half: true, value: pre.planned_end },
      { name: 'weight', label: 'الوزن الجديد (٪) — إن تغيّر', type: 'number', half: true, min: 0, max: 100 },
      { name: 'reason', label: 'مبرر التغيير', type: 'textarea', required: true },
    ],
    submit: 'إرسال طلب التغيير',
    onSubmit: async (v) => {
      const ch = { wp_id: v.wp_id };
      if (v.planned_start) ch.planned_start = v.planned_start;
      if (v.planned_end) ch.planned_end = v.planned_end;
      if (v.weight != null) ch.weight = v.weight;
      await api.post(`/projects/${p.id}/change-requests`, { reason: v.reason, changes: [ch] });
      toast('أُرسل طلب التغيير للاعتماد', 'ok');
      refresh();
    },
  });
}

// ---------------- requests tab
async function requestsTab({ p, ctx, refresh, go }) {
  const r = await api.get('/interagency-requests', { project_id: p.id });
  const me = ctx.me;
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'muted small' }, `${r.items.length} طلب في هذا المشروع`),
      h('div', { class: 'grow' }),
      p.caps.create_request
        ? h(
            'button',
            {
              class: 'btn primary',
              onclick: () =>
                requestForm({ projects: [p], projectId: p.id, me, onDone: (x) => go(`#/requests/${x.id}`) }),
            },
            icon('plus', 16),
            'طلب جديد إلى جهة',
          )
        : null,
    ),
    h(
      'div',
      { class: 'card' },
      r.items.length
        ? r.items.map((x) => reqRow(x, me))
        : emptyState(
            'لا طلبات في هذا المشروع',
            'عندما تحتاج جهتك خدمة من جهة أخرى، ارفع طلبًا وستحيله اللجنة للجهة المختصة.',
            null,
            'empty-requests',
          ),
    ),
  );
}

// ---------------- team
async function teamTab({ p, query, go }) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : '';
  const t = await api.get(`/projects/${p.id}/team`, { from });
  const lvl = (hrs, cap) => {
    const r = hrs / (cap || 40);
    return r > 1.05 ? 'l4' : r > 0.75 ? 'l3' : r > 0.4 ? 'l2' : r > 0 ? 'l1' : '';
  };
  const shift = (days) => {
    const d = new Date(t.from + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const weekLabel = (i) => {
    const a = shift(i * 7);
    const b = shift(i * 7 + 6);
    return `${fmtDate(a)} – ${fmtDate(b)}`;
  };
  const nav = h(
    'div',
    { class: 'row' },
    h('button', { class: 'btn sm', onclick: () => go(`#/p/${p.id}/team?from=${shift(-28)}`) }, 'الفترة السابقة'),
    h('b', { class: 'small' }, `من ${fmtDate(t.from)} (٤ أسابيع)`),
    h('button', { class: 'btn sm', onclick: () => go(`#/p/${p.id}/team?from=${shift(28)}`) }, 'الفترة التالية'),
    query.from ? h('button', { class: 'btn sm ghost', onclick: () => go(`#/p/${p.id}/team`) }, 'اليوم') : null,
  );
  const cap = t.org_capacity;
  const capCard = cap
    ? h(
        'div',
        { class: 'grid c4 keep2' },
        [
          h(
            'div',
            { class: 'kpi' },
            h('span', { class: 'v num' }, cap.total_capacity),
            h('span', { class: 'l' }, 'الطاقة الأسبوعية (ساعة)'),
          ),
          ...cap.weeks.map((w, i) =>
            h(
              'div',
              { class: 'kpi' },
              h('span', { class: `v num${w > cap.total_capacity ? ' over' : ''}` }, w),
              h('span', { class: 'l' }, `أسبوع ${i + 1}: ${weekLabel(i)}`),
            ),
          ),
        ].slice(0, 4),
      )
    : null;
  return h(
    'div',
    { class: 'stack' },
    nav,
    section(
      'الجهات',
      h(
        'div',
        { class: 'scroll-x' },
        h(
          'table',
          { class: 'tbl' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              ['الجهة', 'الدور', 'حزم العمل', 'المقبولة', 'التزامات سارية', 'التقدم المشترك'].map((x) =>
                h('th', null, x),
              ),
            ),
          ),
          h(
            'tbody',
            null,
            t.orgs.map((o) =>
              h(
                'tr',
                null,
                h('td', null, h('b', null, o.name)),
                h('td', null, o.role === 'lead' ? 'قائدة' : 'مشاركة'),
                h('td', null, o.wp_count),
                h('td', null, o.wp_accepted),
                h('td', null, o.commitments_active),
                h(
                  'td',
                  { style: { minWidth: '140px' } },
                  o.shared_progress != null
                    ? [
                        progressBar(0, o.shared_progress, true),
                        h('span', { class: 'xs muted' }, `${o.shared_progress}٪`),
                      ]
                    : h('span', { class: 'xs muted' }, o.detail_visible ? '—' : 'لا يظهر لجهتك'),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
    section('أحمال فريقك', [
      capCard,
      t.members?.length
        ? h(
            'div',
            { class: 'scroll-x' },
            h(
              'table',
              { class: 'tbl' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  ['الشخص', 'مفتوحة', 'متأخرة', ...[0, 1, 2, 3].map((i) => `أسبوع ${i + 1}`)].map((x) =>
                    h('th', null, x),
                  ),
                ),
              ),
              h(
                'tbody',
                null,
                t.members.map((m) =>
                  h(
                    'tr',
                    null,
                    h(
                      'td',
                      null,
                      h(
                        'div',
                        { class: 'row nowrap' },
                        avatar(m.name, true),
                        h('div', null, m.name, h('div', { class: 'xs muted' }, m.title)),
                      ),
                    ),
                    h('td', null, m.open),
                    h('td', null, m.overdue ? badge(m.overdue, 'danger') : '0'),
                    m.weeks.map((x, i) =>
                      h(
                        'td',
                        null,
                        h(
                          'span',
                          { class: `load-cell ${lvl(x, m.capacity_week)}`, title: `${x} ساعة من ${m.capacity_week}` },
                          `${x}`,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          )
        : h('div', { class: 'small muted' }, t.members_note || 'أحمال الأفراد تظهر لمشرفي كل جهة عن فريقهم فقط.'),
      h(
        'div',
        { class: 'legend', style: { marginBlockStart: '10px' } },
        'الأرقام ساعات مقدّرة من تقديرات المهام (بيانات تجريبية)، وليست حكمًا على أداء أي موظف. الأغمق = أقرب للطاقة أو أعلى منها.',
      ),
    ]),
  );
}

// ---------------- inbox (collaboration)
async function inboxTab({ p, ctx, go }) {
  const [th, rq] = await Promise.all([
    api.get('/threads', { project_id: p.id }),
    api.get('/interagency-requests', { project_id: p.id }),
  ]);
  let cat = 'all';
  const area = h('div', { class: 'card' });
  const mine = rq.items.filter(
    (r) =>
      r.ball &&
      ((r.ball.org_id && r.ball.org_id === ctx.me.user.org_id) ||
        (r.ball.holder === 'committee' && ctx.me.committee.length)) &&
      !['CLOSED_COMPLETED', 'CLOSED_DECLINED', 'WITHDRAWN', 'CANCELLED'].includes(r.status),
  );
  const cats = [
    ['all', 'الكل'],
    ['unread', 'غير مقروء'],
    ['approvals', 'الاعتمادات'],
    ['inquiries', 'الاستفسارات'],
  ];
  const row = (t) =>
    h(
      'a',
      { class: 'req-row inbox-row', href: `#/messages/${t.id}` },
      h(
        'div',
        null,
        h(
          'div',
          { class: 'row', style: { gap: '8px' } },
          h('span', { class: 'ttl' }, t.title),
          t.unread ? badge(`${t.unread} جديد`, 'attention') : null,
        ),
        h('div', { class: 'xs muted truncate' }, t.last ? `${t.last.by}: ${t.last.text}` : 'لا رسائل بعد'),
        h(
          'div',
          { class: 'xs muted' },
          `${t.request_ref ? 'استفسار على ' + t.request_ref : t.kind === 'org' ? 'داخلية للجهة' : 'محادثة مشروع'} · ${t.last ? ago(t.last.at) : ''}`,
        ),
      ),
      h('div'),
      h('div'),
    );
  const draw = () => {
    const list = th.items.filter(
      (t) => cat === 'all' || (cat === 'unread' && t.unread) || (cat === 'inquiries' && t.request_id),
    );
    mount(
      area,
      cat === 'approvals'
        ? mine.length
          ? [
              h('div', { class: 'card-h' }, h('h2', null, 'بانتظار إجراء رسمي من جهتك')),
              mine.map((r) => reqRow(r, ctx.me)),
            ]
          : emptyState('لا اعتمادات معلّقة', 'لا طلبات تنتظر إجراءً رسميًا من جهتك في هذا المشروع.')
        : list.length
          ? list.map(row)
          : emptyState(
              'لا محادثات في هذا التصنيف',
              'ابدأ محادثة جديدة للتنسيق والاستفسار مع أطراف المشروع.',
              null,
              'empty-chat',
            ),
    );
  };
  const seg = h(
    'div',
    { class: 'seg' },
    cats.map(([k, l]) =>
      h(
        'button',
        {
          'aria-pressed': String(k === cat),
          onclick: (e) => {
            cat = k;
            $$('button', seg).forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
            draw();
          },
        },
        l,
        k === 'unread' ? ` (${th.items.filter((t) => t.unread).length})` : k === 'approvals' ? ` (${mine.length})` : '',
      ),
    ),
  );
  draw();
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'row' },
      seg,
      h('div', { class: 'grow' }),
      h('a', { class: 'btn primary', href: '#/messages?new=1' }, icon('plus', 16), 'محادثة جديدة'),
    ),
    noticeEl(
      'المحادثات للتنسيق والاستفسار فقط. لا تُعد قبولًا ولا اعتذارًا ولا قرارًا رسميًا؛ القرارات تُتخذ بالأزرار الرسمية في الطلب أو الحزمة.',
      '',
      'info',
    ),
    area,
  );
}
