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
  drawer,
  formDialog,
  emptyState,
  progressBar,
  avatar,
} from '../ui.js';
import { kv, noticeEl } from '../shared.js';

const PRI = { high: ['عالية', 'danger'], normal: ['عادية', 'neutral'], low: ['منخفضة', 'done'] };

// ============================================================ tasks
export async function tasksView({ query, ctx, go, refresh }) {
  const me = ctx.me;
  const isSup = me.user.roles.some((r) => ['ORG_SUPERVISOR', 'ORG_ADMIN'].includes(r));
  const scope = query.scope || 'mine';
  let mode = query.mode || 'board';
  const r = await api.get('/tasks', { scope });
  const projects = (await api.get('/projects')).items.filter((p) => p.caps.level === 'member' && p.status !== 'CLOSED');
  const area = h('div');

  const card = (t) => {
    const c = h(
      'button',
      {
        class: `kcard${t.overdue ? '' : ''}`,
        draggable: t.can_edit ? 'true' : null,
        onclick: () => openTask(t.id),
        'aria-label': t.title,
      },
      h(
        'div',
        { class: 'row nowrap' },
        h('span', { class: 'xs muted num' }, t.ref),
        h('div', { class: 'grow' }),
        t.priority === 'high' ? badge('عالية', 'danger') : null,
        t.overdue ? badge('متأخرة', 'danger') : null,
      ),
      h('div', { class: 'ttl' }, t.title),
      h('div', { class: 'meta' }, avatar(t.assignee_name, true), t.assignee_name, '·', t.project_name),
      t.request_ref ? h('div', { class: 'meta' }, icon('link', 13), t.request_ref) : null,
      t.completion_pct ? progressBar(0, t.completion_pct, true) : null,
      t.planned_end ? h('div', { class: 'meta' }, icon('clock', 13), `حتى ${fmtDate(t.planned_end)}`) : null,
    );
    c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', t.id));
    return c;
  };
  const move = async (id, to) => {
    try {
      await api.patch(`/tasks/${id}`, { status: to });
      toast('حُدّثت حالة المهمة', 'ok');
      refresh();
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  const draw = () => {
    if (!r.items.length) {
      mount(
        area,
        h(
          'div',
          { class: 'card' },
          emptyState(
            scope === 'mine' ? 'لا مهام مسندة إليك' : 'لا مهام في جهتك',
            'أنشئ مهمة لنفسك' + (isSup ? '، أو وزّع التزامًا مقبولًا على فريقك من صفحة الالتزامات.' : '.'),
            h('button', { class: 'btn primary', onclick: () => taskForm({ projects, r, me, refresh }) }, 'مهمة جديدة'),
            'empty-tasks',
          ),
        ),
      );
      return;
    }
    if (mode === 'board') {
      mount(
        area,
        h(
          'div',
          { class: 'board' },
          r.stages.map((s) => {
            const items = r.items.filter((t) => t.status === s.key);
            const lane = h(
              'section',
              { class: 'lane', 'aria-label': s.label },
              h('header', null, s.label, h('span', { class: 'n' }, items.length)),
              items.map(card),
            );
            lane.addEventListener('dragover', (e) => {
              e.preventDefault();
              lane.classList.add('over');
            });
            lane.addEventListener('dragleave', () => lane.classList.remove('over'));
            lane.addEventListener('drop', (e) => {
              e.preventDefault();
              lane.classList.remove('over');
              move(e.dataTransfer.getData('text/plain'), s.key);
            });
            return lane;
          }),
        ),
      );
    } else {
      const sorted = [...r.items].sort((x, y) => (x.planned_end || '9').localeCompare(y.planned_end || '9'));
      const rows = sorted.map((t) =>
        h(
          'tr',
          { style: { cursor: 'pointer' }, onclick: () => openTask(t.id) },
          h('td', null, h('b', null, t.title), h('div', { class: 'xs muted' }, `${t.ref} · ${t.project_name}`)),
          h('td', null, t.assignee_name),
          h(
            'td',
            null,
            badge(t.status_ar, t.tone),
            t.overdue ? ' ' : null,
            t.overdue ? badge('متأخرة', 'danger') : null,
          ),
          h('td', { style: { minWidth: '110px' } }, progressBar(0, t.completion_pct, true)),
          h('td', null, fmtDate(t.planned_end)),
        ),
      );
      mount(
        area,
        h(
          'div',
          { class: 'card scroll-x' },
          h(
            'table',
            { class: 'tbl' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                ['المهمة', 'المسؤول', 'الحالة', 'الإنجاز', 'الموعد'].map((x) => h('th', null, x)),
              ),
            ),
            h('tbody', null, rows),
          ),
        ),
      );
    }
  };
  const openTask = (id) => taskDrawer(id, { r, refresh, isSup });
  const seg1 = isSup
    ? h(
        'div',
        { class: 'seg' },
        [
          ['mine', 'مهامي'],
          ['all', 'مهام الجهة'],
        ].map(([k, l]) =>
          h('button', { 'aria-pressed': String(k === scope), onclick: () => go(`#/tasks?scope=${k}&mode=${mode}`) }, l),
        ),
      )
    : null;
  const seg2 = h(
    'div',
    { class: 'seg' },
    [
      ['board', 'لوحة'],
      ['list', 'قائمة'],
    ].map(([k, l]) =>
      h(
        'button',
        {
          'aria-pressed': String(k === mode),
          onclick: (e) => {
            mode = k;
            $$('button', seg2).forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
            draw();
          },
        },
        l,
      ),
    ),
  );
  const open = r.items.filter((t) => !['DONE_INTERNAL', 'CANCELLED'].includes(t.status));
  const late = open.filter((t) => t.overdue);
  const el = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', null, scope === 'all' ? 'مهام الجهة' : 'مهامي'),
        h('div', { class: 'sub' }, 'المهام الداخلية خاصة بجهتك — لا تُسند لموظفين في جهات أخرى ولا تظهر لهم.'),
      ),
      h(
        'button',
        { class: 'btn primary', onclick: () => taskForm({ projects, r, me, refresh }) },
        icon('plus', 16),
        'مهمة جديدة',
      ),
    ),
    h(
      'div',
      { class: 'row' },
      seg1,
      seg2,
      h('div', { class: 'grow' }),
      h('span', { class: 'small muted' }, `${open.length} مفتوحة`),
      late.length ? badge(`${late.length} متأخرة`, 'danger') : null,
    ),
    area,
  );
  draw();
  if (query.task) setTimeout(() => openTask(query.task), 60);
  if (query.new) setTimeout(() => taskForm({ projects, r, me, refresh }), 60);
  return { title: 'المهام', el };
}

function taskForm({ projects, r, me, refresh }) {
  if (!projects.length) {
    toast('لا توجد مشاريع نشطة تنتمي إليها جهتك', 'err');
    return;
  }
  formDialog({
    title: 'مهمة جديدة',
    wide: true,
    fields: [
      { name: 'title', label: 'عنوان المهمة', required: true },
      {
        name: 'project_id',
        label: 'المشروع',
        type: 'select',
        required: true,
        options: projects.map((p) => ({ value: p.id, label: p.name })),
        value: (projects.find((p) => p.id === me.prefs?.last_project) || projects[0]).id,
        half: true,
      },
      {
        name: 'assignee_id',
        label: 'المسؤول',
        type: 'select',
        required: true,
        options: r.people.map((x) => ({ value: x.id, label: x.name })),
        value: me.user.id,
        half: true,
      },
      { name: 'planned_start', label: 'البدء', type: 'date', half: true },
      { name: 'planned_end', label: 'الانتهاء', type: 'date', half: true },
      { name: 'est_hours', label: 'الساعات المقدّرة', type: 'number', half: true, min: 1 },
      {
        name: 'priority',
        label: 'الأولوية',
        type: 'select',
        placeholder: false,
        half: true,
        options: [
          { value: 'normal', label: 'عادية' },
          { value: 'high', label: 'عالية' },
          { value: 'low', label: 'منخفضة' },
        ],
        value: 'normal',
      },
      { name: 'description', label: 'التفاصيل', type: 'textarea', rows: 3 },
    ],
    submit: 'إنشاء المهمة',
    onSubmit: async (v) => {
      await api.post('/tasks', { ...v, est_hours: v.est_hours || undefined });
      api
        .put('/me/prefs', { last_project: v.project_id })
        .then((x) => {
          me.prefs = x.prefs;
        })
        .catch(() => {});
      toast('أُنشئت المهمة', 'ok');
      refresh();
    },
  });
}

async function taskDrawer(id, { r, refresh, isSup }) {
  let t;
  try {
    t = (await api.get(`/tasks/${id}`)).task;
  } catch (e) {
    toast(e.message, 'err');
    return;
  }
  const st = h(
    'select',
    { 'aria-label': 'الحالة' },
    r.stages.map((s) => h('option', { value: s.key, selected: s.key === t.status ? true : null }, s.label)),
    isSup ? h('option', { value: 'CANCELLED', selected: t.status === 'CANCELLED' ? true : null }, 'ملغاة') : null,
  );
  const pct = h('input', {
    type: 'range',
    min: 0,
    max: 100,
    step: 5,
    value: t.completion_pct,
    'aria-label': 'نسبة الإنجاز',
  });
  const pctLbl = h('b', { class: 'num' }, `${t.completion_pct}%`);
  pct.addEventListener('input', () => {
    pctLbl.textContent = `${pct.value}%`;
  });
  const shared = h(
    'textarea',
    { rows: 2, placeholder: 'جملة قصيرة يراها مشرف الجهة والجهة الطالبة عن التقدم' },
    t.shared_progress_note || '',
  );
  const priv = h('textarea', { rows: 3, placeholder: 'ملاحظات للعمل الداخلي' }, t.private_notes || '');
  const body = [
    h(
      'div',
      { class: 'row' },
      badge(t.status_ar, t.tone),
      badge(...(PRI[t.priority] || PRI.normal)),
      t.overdue ? badge('متأخرة', 'danger') : null,
    ),
    t.description ? h('p', null, t.description) : null,
    kv([
      ['المسؤول', t.assignee_name],
      ['المشروع', t.project_id ? h('a', { href: `#/p/${t.project_id}/overview` }, t.project_name) : t.project_name],
      t.request_ref
        ? ['الالتزام', h('a', { href: `#/requests/${t.request_id}` }, `${t.request_ref} — ${t.request_title}`)]
        : null,
      t.wp_ref
        ? [
            'حزمة العمل',
            t.wp_id && t.project_id
              ? h(
                  'a',
                  { href: `#/p/${t.project_id}/board?wp=${t.wp_id}` },
                  `${t.wp_ref}${t.wp_title ? ' — ' + t.wp_title : ''}`,
                )
              : t.wp_ref,
          ]
        : null,
      ['المدة', `${fmtDate(t.planned_start)} – ${fmtDate(t.planned_end)}`],
      ['الساعات', t.est_hours ? `${t.est_hours} ساعة مقدّرة` : '—'],
    ]),
    t.can_edit
      ? h(
          'div',
          { class: 'col' },
          h('div', { class: 'field' }, h('label', null, 'الحالة'), st),
          h('div', { class: 'field' }, h('label', null, 'نسبة الإنجاز ', pctLbl), pct),
          h(
            'div',
            { class: 'field' },
            h('label', null, 'تحديث مشترك'),
            shared,
            h('div', { class: 'hint' }, 'يظهر لمن يتابع الالتزام من خارج جهتك'),
          ),
          h(
            'div',
            { class: 'field' },
            h('label', null, 'ملاحظات خاصة بجهتك فقط'),
            priv,
            h('div', { class: 'hint' }, 'لا تظهر لأي جهة أخرى ولا للجنة'),
          ),
        )
      : noticeEl('يمكنك الاطلاع فقط على هذه المهمة.', '', 'lock'),
    h(
      'details',
      null,
      h('summary', { class: 'small', style: { cursor: 'pointer' } }, 'سجل المهمة'),
      h(
        'ul',
        { class: 'check-list', style: { marginBlockStart: '8px' } },
        [...t.history]
          .reverse()
          .map((x) =>
            h(
              'li',
              null,
              h('span', { class: 'muted' }, icon('clock', 13)),
              h(
                'span',
                null,
                x.note || x.action,
                h('div', { class: 'xs muted' }, `${x.actor_name || ''} · ${fmtDT(x.at)}`),
              ),
            ),
          ),
      ),
    ),
  ];
  const save = h(
    'button',
    {
      class: 'btn primary',
      onclick: async () => {
        try {
          await api.patch(`/tasks/${t.id}`, {
            status: st.value,
            completion_pct: Number(pct.value),
            shared_progress_note: shared.value,
            private_notes: priv.value,
            version: t.version,
          });
          toast('حُفظت المهمة', 'ok');
          d.close();
          refresh();
        } catch (e) {
          toast(e.message, 'err');
          if (e.code === 'STALE_VERSION') {
            d.close();
            refresh();
          }
        }
      },
    },
    'حفظ',
  );
  const d = drawer({
    title: t.title,
    sub: `${t.ref} · ${t.project_name}`,
    body,
    footer: t.can_edit ? [save, h('button', { class: 'btn ghost', onclick: () => d.close() }, 'إغلاق')] : null,
  });
}

// ============================================================ commitments
export async function commitmentsView({ query, ctx, go, refresh }) {
  if (query.tab === 'changes' && query.project) {
    go(`#/p/${query.project}/timeline`);
    return h('div');
  }
  const r = await api.get('/commitments');
  const sides = [
    ['provider', 'التزامات جهتي', 'ما قبلته جهتكم رسميًا وتنفّذه'],
    ['requester', 'التزامات لصالح جهتي', 'ما قبلته جهات أخرى بناءً على طلباتكم'],
    ['committee', 'متابعة اللجنة', 'كل الالتزامات السارية في مشاريع اللجنة'],
  ];
  const card = (c) =>
    h(
      'div',
      { class: 'card pad col' },
      h(
        'div',
        { class: 'row nowrap' },
        h(
          'div',
          { class: 'grow' },
          h('b', null, c.request_title),
          h('div', { class: 'xs muted' }, `${c.request_ref} · ${c.project_name}`),
        ),
        badge(c.status === 'ACTIVE' ? 'ساري' : 'مغلق', c.status === 'ACTIVE' ? 'success' : 'done'),
        c.overdue ? badge('تجاوز الموعد', 'danger') : null,
      ),
      h('p', { class: 'small' }, c.scope_text),
      kv([
        ['الجهة الملتزمة', c.org_name],
        ['الجهة الطالبة', c.requester_org_name],
        ['الموعد', fmtDate(c.due_on)],
        c.conditions ? ['الشروط', c.conditions] : null,
        ['قبله', `${c.accepted_by_name} — ${fmtDate(c.accepted_at)}`],
        ['حالة الطلب', c.request_status_ar],
      ]),
      c.progress != null
        ? h(
            'div',
            null,
            h('div', { class: 'small muted' }, `التقدم (من مهام الجهة): ${c.progress}٪`),
            progressBar(0, c.progress, true),
          )
        : h('div', { class: 'small muted' }, 'لم تُوزَّع مهام على الفريق بعد'),
      c.task_counts
        ? h('div', { class: 'small muted' }, `المهام: ${c.task_counts.done} مكتملة من ${c.task_counts.total}`)
        : null,
      c.shared_updates.length
        ? h(
            'div',
            { class: 'small' },
            h('b', null, 'آخر تحديث: '),
            c.shared_updates[c.shared_updates.length - 1].note,
            h('span', { class: 'xs muted' }, ` — ${ago(c.shared_updates[c.shared_updates.length - 1].at)}`),
          )
        : null,
      h(
        'div',
        { class: 'row' },
        h('a', { class: 'btn sm', href: `#/requests/${c.request_id}` }, 'فتح الطلب'),
        c.side === 'provider' &&
          c.status === 'ACTIVE' &&
          ctx.me.user.roles.some((x) => ['ORG_SUPERVISOR', 'ORG_ADMIN'].includes(x))
          ? h('a', { class: 'btn sm primary', href: `#/requests/${c.request_id}` }, 'توزيع على الفريق')
          : null,
      ),
    );
  const groups = sides
    .map(([k, title, sub]) => {
      const items = r.items.filter((c) => c.side === k);
      return items.length
        ? h(
            'section',
            { class: 'stack' },
            h('div', null, h('h2', null, `${title} (${items.length})`), h('div', { class: 'small muted' }, sub)),
            h('div', { class: 'grid auto' }, items.map(card)),
          )
        : null;
    })
    .filter(Boolean);
  return {
    title: 'الالتزامات',
    el: h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'page-head' },
        h(
          'div',
          null,
          h('h1', null, 'الالتزامات المؤسسية'),
          h('div', { class: 'sub' }, 'لا ينشأ التزام إلا بقبول موثّق من الجهة نفسها بتفويض ساري.'),
        ),
      ),
      groups.length
        ? groups
        : h(
            'div',
            { class: 'card' },
            emptyState(
              'لا التزامات بعد',
              'ستظهر هنا الالتزامات بعد أن تقبل الجهات المختصة الطلبات المحالة إليها.',
              null,
              'empty-tasks',
            ),
          ),
    ),
  };
}
