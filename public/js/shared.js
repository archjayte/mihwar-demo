import { h, badge, icon, fmtDate, fmtDT, ago, popover, modal } from './ui.js';

export const STAGES = [
  ['requester', 'الجهة الطالبة'],
  ['committee', 'اللجنة'],
  ['org', 'الجهة المختصة'],
  ['execution', 'التنفيذ'],
  ['closing', 'الاستلام والإغلاق'],
];
export const SERVICE_TYPES = {
  supplier_provisioning: 'توفير مورد',
  contract_execution: 'إبرام وتوقيع عقد',
  financial_approval: 'اعتماد مالي',
  budget_allocation: 'تخصيص موازنة',
  facility_services: 'خدمات منشآت وصيانة',
  hr_services: 'خدمات موارد بشرية',
  it_integration: 'تكامل وحلول تقنية',
  municipal_permits: 'تصاريح واشتراطات بلدية',
  legal_review: 'مراجعة قانونية',
  other: 'خدمة أخرى',
};
const TERMINAL = ['CLOSED_COMPLETED', 'CLOSED_DECLINED', 'WITHDRAWN', 'CANCELLED', 'SPLIT'];

/** Five-stage journey track: where the request is, and which stages it has already passed. */
export function journey(r, mini = false) {
  const idx = Math.max(
    0,
    STAGES.findIndex(([k]) => k === r.stage),
  );
  const bad = r.tone === 'danger';
  return h(
    'div',
    {
      class: `journey${mini ? ' mini' : ''}`,
      role: 'img',
      'aria-label': `مرحلة الطلب: ${STAGES[idx][1]} — ${r.status_ar}`,
    },
    STAGES.map(([k, label], i) =>
      h('div', { class: `st${i < idx ? ' done' : ''}${i === idx ? ` here${bad ? ' bad' : ''}` : ''}` }, label),
    ),
  );
}

/** "Who holds the ball now" — the single most useful line on a request. */
export function ballBanner(r, me) {
  const closed = TERMINAL.includes(r.status) || !r.ball;
  const b = r.ball || {};
  const mine =
    !closed && ((b.org_id && b.org_id === me.user.org_id) || (b.holder === 'committee' && me.committee.length));
  return h(
    'div',
    { class: `ball${closed ? ' closed' : mine ? ' mine' : ''}` },
    h('span', { class: 'pin' }),
    h(
      'div',
      { class: 'grow' },
      h(
        'div',
        { style: { fontWeight: 500 } },
        closed
          ? 'لا إجراء مطلوب — الطلب في حالة ختامية'
          : mine
            ? `الكرة عندكم الآن: ${b.label}`
            : `الكرة عند: ${b.org_name} — ${b.label}`,
      ),
      !closed && b.since ? h('div', { class: 'xs muted' }, `منذ ${ago(b.since)}`) : null,
    ),
    r.response_due_at && !closed && ['REFERRED_TO_ORG', 'UNDER_ORG_REVIEW'].includes(r.status)
      ? h(
          'span',
          { class: `badge t-${r.overdue ? 'danger' : 'info'}` },
          `${r.overdue ? 'تجاوز مدة الرد المرجعية' : 'الرد المرجعي قبل'} ${fmtDate(r.response_due_at)}`,
        )
      : null,
  );
}

export const statusBadge = (r) => badge(r.status_ar, r.tone);
export const orgRoute = (r) =>
  h(
    'span',
    { class: 'small' },
    r.requester_org_name,
    ' ',
    h('span', { class: 'muted' }, '←'),
    ' ',
    r.target_org_name || h('span', { class: 'muted' }, 'لم تُحدَّد الجهة بعد'),
  );

export function reqRow(r, me) {
  const b = r.ball;
  const mine =
    b &&
    ((b.org_id && b.org_id === me.user.org_id) || (b.holder === 'committee' && me.committee.length)) &&
    !TERMINAL.includes(r.status);
  return h(
    'a',
    { class: 'req-row', href: `#/requests/${r.id}` },
    h(
      'div',
      null,
      h(
        'div',
        { class: 'row', style: { gap: '8px' } },
        h('span', { class: 'ttl' }, r.title),
        mine ? badge('عندكم', 'attention') : null,
      ),
      // the services requested are listed on the request itself; the row keeps only what tells requests apart
      h('div', { class: 'xs muted' }, `${r.ref} · ${r.project_name} · `, orgRoute(r)),
    ),
    h(
      'div',
      null,
      journey(r, true),
      h(
        'div',
        { class: 'xs muted', style: { marginBlockStart: '4px' } },
        b && !TERMINAL.includes(r.status) ? `${b.org_name}: ${b.label}` : '',
      ),
    ),
    h(
      'div',
      { class: 'col', style: { gap: '4px', alignItems: 'flex-start' } },
      statusBadge(r),
      h('span', { class: 'xs muted' }, r.required_by ? `مطلوب قبل ${fmtDate(r.required_by)}` : ''),
    ),
  );
}

export const kv = (pairs) =>
  h(
    'dl',
    { class: 'kv' },
    pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v ?? '—')]),
  );
export const section = (title, body, extra) =>
  h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-h' }, h('h2', null, title), extra),
    h('div', { class: 'card-b' }, body),
  );

export function eventsList(events) {
  return h(
    'ol',
    { class: 'timeline-ev' },
    [...events].reverse().map((e) => {
      const neg = /decline|DECLINE|reject|return|block|dispute/.test(e.action);
      const dec = /decide|accept|submit|refer|reroute|review/.test(e.action);
      return h(
        'li',
        { class: `${dec ? 'decision' : ''} ${neg ? 'neg' : ''}` },
        h('div', { style: { fontWeight: 500 } }, e.label),
        h('div', { class: 'xs muted' }, `${e.actor_name} — ${e.actor_org} · ${fmtDT(e.at)}`),
        e.detail ? h('div', { class: 'small' }, e.detail) : null,
        e.reason ? h('div', { class: 'small muted', style: { whiteSpace: 'pre-wrap' } }, `«${e.reason}»`) : null,
        e.vis && e.vis !== 'all'
          ? h('div', null, badge(e.vis === 'committee' ? 'مرئي للجنة فقط' : 'مرئي لجهتكم فقط', 'neutral'))
          : null,
      );
    }),
  );
}

export const noticeEl = (text, kind = '', ic = 'info') =>
  h('div', { class: `notice ${kind}` }, icon(ic, 18), h('div', null, text));

// ---- table helpers: column visibility (remembered per table) and a "⋯" row menu for secondary actions
export function colMenu(table, key, labels) {
  let hidden = [];
  try {
    hidden = JSON.parse(localStorage.getItem(`mihwar.cols.${key}`) || '[]');
  } catch {
    hidden = [];
  }
  const apply = () => {
    table
      .querySelectorAll('tr')
      .forEach((tr) => [...tr.children].forEach((c, i) => c.classList.toggle('col-off', hidden.includes(i))));
  };
  const save = () => {
    try {
      localStorage.setItem(`mihwar.cols.${key}`, JSON.stringify(hidden));
    } catch {
      /* ignore */
    }
  };
  queueMicrotask(apply);
  return h(
    'button',
    {
      class: 'btn sm',
      'aria-haspopup': 'menu',
      onclick: (e) => {
        popover(e.currentTarget, [
          h('div', { class: 'ph' }, h('b', null, 'الأعمدة المعروضة')),
          h(
            'div',
            { class: 'menu', style: { padding: '6px 10px' } },
            labels.map((l, i) =>
              h(
                'label',
                { class: 'chk' },
                h('input', {
                  type: 'checkbox',
                  checked: hidden.includes(i) ? null : true,
                  onchange: (ev) => {
                    hidden = ev.target.checked ? hidden.filter((x) => x !== i) : [...hidden, i];
                    save();
                    apply();
                  },
                }),
                h('span', null, l),
              ),
            ),
          ),
        ]);
      },
    },
    'الأعمدة',
  );
}
export function rowMenu(items) {
  return h(
    'button',
    {
      class: 'iconbtn',
      'aria-label': 'المزيد من الإجراءات',
      'aria-haspopup': 'menu',
      onclick: (e) => {
        const p = popover(
          e.currentTarget,
          h(
            'div',
            { class: 'menu', role: 'menu' },
            items.map(([label, fn]) =>
              h(
                'button',
                {
                  role: 'menuitem',
                  onclick: () => {
                    p.close();
                    fn();
                  },
                },
                label,
              ),
            ),
          ),
        );
      },
    },
    '⋯',
  );
}

/** Semantic breadcrumb (IA-006): items = [[label, href?], ...]; the last item is the current page. */
export function breadcrumb(items) {
  return h(
    'nav',
    { class: 'crumbs', 'aria-label': 'مسار التنقل' },
    h(
      'ol',
      null,
      [['الرئيسية', '#/'], ...items].map(([label, href], i, a) =>
        h(
          'li',
          { 'aria-current': i === a.length - 1 ? 'page' : null },
          href && i < a.length - 1 ? h('a', { href }, label) : h('span', null, label),
        ),
      ),
    ),
  );
}

/** IA-011: what happened, the reference to quote, what happens next (in order) and where to go from here. Shown after a service is completed. */
export function completionDialog({ title, lead, ref, steps = [], actions = [] }) {
  const close = () => m.close();
  const btns = actions.map((a, i) =>
    a.href
      ? h('a', { class: `btn${i === 0 ? ' primary' : ''}`, href: a.href, onclick: close }, a.label)
      : h(
          'button',
          {
            class: `btn${i === 0 ? ' primary' : ''}`,
            type: 'button',
            onclick: () => {
              close();
              a.onclick?.();
            },
          },
          a.label,
        ),
  );
  const m = modal({
    title,
    body: h(
      'div',
      { class: 'stack' },
      h('div', { class: 'notice ok', role: 'status' }, lead),
      ref ? h('p', { class: 'small' }, 'الرقم المرجعي للمتابعة: ', h('b', { dir: 'ltr' }, ref)) : null,
      steps.length
        ? h(
            'div',
            null,
            h('h3', { class: 'small', style: { marginBlockEnd: '6px' } }, 'الخطوات التالية'),
            h(
              'ol',
              { class: 'small', style: { paddingInlineStart: '20px', margin: 0, display: 'grid', gap: '6px' } },
              steps.map((x) => h('li', null, x)),
            ),
          )
        : null,
    ),
    actions: [...btns, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'إغلاق')],
  });
  return m;
}

// "Related to this item": one consistent list of links so every record leads to its neighbours. Items without href render as plain text.
export const relatedPanel = (items, title = 'مرتبط بهذا العنصر', level = 'h3') => {
  const rows = items.filter(Boolean);
  if (!rows.length) return null;
  return h(
    'nav',
    { class: 'related', 'aria-label': title },
    h(level, null, title),
    h(
      'ul',
      { class: 'related-list' },
      rows.map((x) =>
        h(
          'li',
          null,
          x.href ? h('a', { href: x.href }, x.label) : h('span', null, x.label),
          x.count != null ? h('span', { class: 'related-n num' }, x.count) : null,
          x.sub ? h('span', { class: 'xs muted related-sub' }, x.sub) : null,
        ),
      ),
    ),
  );
};
