import { api } from '../api.js';
import {
  h,
  mount,
  $,
  icon,
  toast,
  badge,
  fmtDate,
  fmtDT,
  ago,
  modal,
  formDialog,
  confirmDialog,
  emptyState,
  fmtSize,
  progressBar,
} from '../ui.js';
import { uploadFile, fileField, fileButton } from '../files.js';
import {
  journey,
  ballBanner,
  statusBadge,
  reqRow,
  kv,
  section,
  eventsList,
  noticeEl,
  SERVICE_TYPES,
  orgRoute,
  breadcrumb,
  completionDialog,
  relatedPanel,
} from '../shared.js';

const REASONS = {
  OUT_OF_SCOPE: 'خارج الاختصاص',
  MISSING_DOCS: 'نقص مستندات جوهري',
  LEGAL_CONFLICT: 'تضارب مع سند نظامي',
  NO_BUDGET: 'عدم توفر اعتماد أو موارد',
  SCHEDULE_CONFLICT: 'تعارض مع جدول معتمد',
  LEGAL_RISK: 'مخاطر قانونية',
  TECHNICAL_INFEASIBLE: 'تعذر فني',
  DUPLICATE: 'طلب مكرر',
  OTHER: 'سبب آخر (يُشرح في النص)',
};
const svcOptions = Object.entries(SERVICE_TYPES).map(([value, label]) => ({ value, label }));

// ============================================================ list
export async function requestsView({ query, ctx, go }) {
  const me = ctx.me;
  const scope = query.scope || 'all';
  const [list, projects] = await Promise.all([api.get('/interagency-requests', { scope }), api.get('/projects')]);
  const creatable = projects.items.filter((p) => p.caps.create_request);
  let filter = query.f || 'all';
  let text = '';
  let projectId = '';
  const holder = h('div', { class: 'card' });
  const isMine = (r) =>
    r.ball &&
    ((r.ball.org_id && r.ball.org_id === me.user.org_id) || (r.ball.holder === 'committee' && me.committee.length)) &&
    !['CLOSED_COMPLETED', 'CLOSED_DECLINED', 'WITHDRAWN', 'CANCELLED', 'SPLIT'].includes(r.status);
  const draw = () => {
    let items = list.items;
    if (filter === 'mine') items = items.filter(isMine);
    else if (filter === 'exec')
      items = items.filter((r) =>
        [
          'ACCEPTED_BY_ORG',
          'IN_EXECUTION',
          'BLOCKED',
          'ORG_SUBMITTED',
          'RETURNED_FOR_CORRECTION',
          'ACCEPTED_DELIVERABLE',
        ].includes(r.status),
      );
    else if (filter === 'closed')
      items = items.filter((r) =>
        ['CLOSED_COMPLETED', 'CLOSED_DECLINED', 'WITHDRAWN', 'CANCELLED', 'SPLIT'].includes(r.status),
      );
    else if (filter === 'open')
      items = items.filter(
        (r) => !['CLOSED_COMPLETED', 'CLOSED_DECLINED', 'WITHDRAWN', 'CANCELLED', 'SPLIT'].includes(r.status),
      );
    if (projectId) items = items.filter((r) => r.project_id === projectId);
    if (text)
      items = items.filter((r) => (r.title + r.ref + r.requester_org_name + (r.target_org_name || '')).includes(text));
    mount(
      holder,
      items.length
        ? items.map((r) => reqRow(r, me))
        : emptyState(
            'لا توجد طلبات بهذه المعايير',
            filter === 'mine' ? 'لا طلبات تنتظر إجراءً منك الآن.' : 'جرّب تغيير التصفية أو أنشئ طلبًا جديدًا.',
            null,
            'empty-requests',
          ),
    );
    chips.forEach(([k, b]) => b.setAttribute('aria-pressed', String(k === filter)));
    $('.cnt', counter) && ($('.cnt', counter).textContent = items.length);
    drawMore();
  };
  const more = h('div', { class: 'row', role: 'status', 'aria-live': 'polite', style: { justifyContent: 'center' } }); // CMP-010: pagination state is announced
  const drawMore = () => {
    mount(
      more,
      list.has_more
        ? [
            h('span', { class: 'small muted' }, `المعروض ${list.items.length} من ${list.total}`),
            h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  const next = await api.get('/interagency-requests', { scope, offset: list.items.length });
                  list.items.push(...next.items);
                  list.has_more = next.has_more;
                  list.total = next.total;
                  draw();
                },
              },
              'عرض المزيد',
            ),
          ]
        : [],
    );
  };
  const counter = h('span', { class: 'small muted' }, 'النتائج: ', h('b', { class: 'cnt num' }, 0));
  const chips = [
    ['all', 'الكل'],
    ['mine', 'الكرة عندي'],
    ['open', 'مفتوحة'],
    ['exec', 'قيد التنفيذ والمراجعة'],
    ['closed', 'مغلقة'],
  ].map(([k, l]) => [
    k,
    h(
      'button',
      {
        class: 'chip',
        'aria-pressed': 'false',
        onclick: () => {
          filter = k;
          draw();
        },
      },
      l,
    ),
  ]);
  const scopeTabs = h(
    'div',
    { class: 'seg', role: 'tablist' },
    [
      ['all', 'الكل'],
      ['outgoing', `صادرة من جهتي`],
      ['incoming', 'واردة لجهتي'],
      ...(me.committee.length ? [['committee', 'صندوق اللجنة']] : []),
    ].map(([k, l]) =>
      h(
        'button',
        { role: 'tab', 'aria-selected': String(k === scope), onclick: () => go(`#/requests?scope=${k}`) },
        l,
        k === 'incoming' && list.tabs.incoming ? ` (${list.tabs.incoming})` : '',
      ),
    ),
  );
  const pSel = h(
    'select',
    {
      'aria-label': 'المشروع',
      style: { width: 'auto', minHeight: '36px' },
      onchange: (e) => {
        projectId = e.target.value;
        draw();
      },
    },
    h('option', { value: '' }, 'كل المشاريع'),
    projects.items.map((p) => h('option', { value: p.id }, p.name)),
  );
  const search = h('input', {
    type: 'search',
    placeholder: 'بحث في الطلبات…',
    'aria-label': 'بحث',
    style: { width: '200px', minHeight: '36px' },
    oninput: (e) => {
      text = e.target.value.trim();
      draw();
    },
  });
  const newBtn = creatable.length
    ? h(
        'button',
        {
          class: 'btn primary',
          onclick: () => requestForm({ projects: creatable, me, onDone: (r) => go(`#/requests/${r.id}`) }),
        },
        icon('plus', 16),
        'طلب جديد إلى جهة',
      )
    : null;
  const el = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', null, scope === 'committee' ? 'صندوق لجنة المشروع' : 'طلبات الجهات'),
        h('div', { class: 'sub' }, 'الطلب لا يُعد التزامًا حتى تقبله الجهة المختصة رسميًا.'),
      ),
      newBtn,
    ),
    h('div', { class: 'row' }, scopeTabs, h('div', { class: 'grow' }), pSel, search),
    h(
      'div',
      { class: 'row' },
      chips.map(([, b]) => b),
      h('div', { class: 'grow' }),
      counter,
    ),
    holder,
    more,
  );
  draw();
  if (query.new && creatable.length)
    setTimeout(() => requestForm({ projects: creatable, me, onDone: (r) => go(`#/requests/${r.id}`) }), 50);
  return { title: 'طلبات الجهات', el };
}

// ============================================================ create / edit
export function requestForm({ projects, request, me, onDone, projectId }) {
  const editing = !!request;
  const items = (request?.items?.length ? request.items : [{ title: '', service_type: 'other', spec: '' }]).map(
    (i) => ({ ...i }),
  );
  const itemsBox = h('div', { class: 'col' });
  let projSel;
  const drawItems = () =>
    mount(
      itemsBox,
      items.map((it, idx) =>
        h(
          'div',
          { class: 'card pad', style: { background: 'var(--surface-2)' } },
          h(
            'div',
            { class: 'row nowrap' },
            h('b', { class: 'small' }, `العنصر ${idx + 1}`),
            h('div', { class: 'grow' }),
            items.length > 1
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn ghost sm',
                    onclick: () => {
                      items.splice(idx, 1);
                      drawItems();
                    },
                  },
                  'حذف',
                )
              : null,
          ),
          h(
            'div',
            { class: 'form-grid' },
            h(
              'div',
              { class: 'field full' },
              h('label', { class: 'req' }, 'ما المطلوب تحديدًا؟'),
              h('input', {
                value: it.title,
                placeholder: 'مثال: توفير المورد المعتمد للمستلزمات',
                oninput: (e) => {
                  it.title = e.target.value;
                },
              }),
            ),
            h(
              'div',
              { class: 'field' },
              h('label', null, 'نوع الخدمة'),
              h(
                'select',
                {
                  onchange: (e) => {
                    it.service_type = e.target.value;
                  },
                },
                svcOptions.map((o) =>
                  h('option', { value: o.value, selected: o.value === it.service_type ? true : null }, o.label),
                ),
              ),
              h('div', { class: 'hint' }, 'يساعد اللجنة على اقتراح الجهة المختصة'),
            ),
            h(
              'div',
              { class: 'field' },
              h('label', null, 'المواصفات أو الشروط'),
              h('input', {
                value: it.spec || '',
                oninput: (e) => {
                  it.spec = e.target.value;
                },
              }),
            ),
          ),
        ),
      ),
    );
  drawItems();
  const f = {};
  const field = (key, label, ctrl, opts = {}) =>
    h(
      'div',
      { class: `field${opts.half ? '' : ' full'}` },
      h('label', { class: opts.req ? 'req' : '' }, label),
      ctrl,
      opts.hint && h('div', { class: 'hint' }, opts.hint),
    );
  const wpSel = h('select', null, h('option', { value: '' }, 'غير مرتبط بحزمة'));
  const loadWps = async (pid) => {
    try {
      const r = await api.get(`/projects/${pid}/work-packages`);
      mount(
        wpSel,
        h('option', { value: '' }, 'غير مرتبط بحزمة'),
        r.items.map((w) =>
          h('option', { value: w.id, selected: w.id === request?.wp?.id ? true : null }, `${w.ref} — ${w.title}`),
        ),
      );
    } catch {
      /* optional */
    }
  };
  if (!editing) {
    projSel = h(
      'select',
      { onchange: (e) => loadWps(e.target.value) },
      projects.map((p) => h('option', { value: p.id, selected: p.id === projectId ? true : null }, p.name)),
    );
    loadWps(projectId || projects[0].id);
  }
  f.title = h('input', { value: request?.title || '', placeholder: 'عنوان واضح يصف المطلوب' });
  f.desc = h(
    'textarea',
    { rows: 4, placeholder: 'اشرح ما تحتاجه ولماذا. الجهة المختصة ستقرأ هذا النص قبل أن تقرر.' },
    request?.description || '',
  );
  f.by = h('input', { type: 'date', value: request?.required_by || '' });
  f.impact = h('input', { value: request?.impact_text || '', placeholder: 'ماذا يحدث إذا تأخر؟' });
  f.val = h('input', {
    type: 'number',
    min: 0,
    step: 1,
    inputmode: 'numeric',
    value: request?.estimated_value ?? '',
    placeholder: 'اختياري',
  });
  const tplSel = h(
    'select',
    {
      'aria-label': 'قالب جاهز',
      onchange: (e) => {
        const t = tpls.find((x) => x.key === e.target.value);
        if (!t) return;
        f.title.value = t.title;
        items.splice(0, items.length, ...t.items.map((i) => ({ ...i })));
        drawItems();
      },
    },
    h('option', { value: '' }, 'بدون قالب'),
  );
  const tpls = [];
  const catalogNote = h('div', { class: 'xs muted' });
  if (!editing)
    api
      .get('/request-templates')
      .then((r) => {
        tpls.push(...r.items);
        if (r.catalog)
          catalogNote.textContent = `وصف الخدمات: الإصدار ${r.catalog.version} — ${fmtDate(r.catalog.updated)} — ${r.catalog.status_ar}`;
        r.items.forEach((t) => tplSel.append(h('option', { value: t.key }, t.label)));
      })
      .catch(() => {
        tplSel.closest('.field')?.classList.add('hide');
      });
  const err = h('div', { class: 'notice err hide', role: 'alert' });
  const submit = async () => {
    const body = {
      title: f.title.value.trim(),
      description: f.desc.value.trim(),
      required_by: f.by.value,
      impact_text: f.impact.value.trim(),
      estimated_value: f.val.value === '' ? null : Number(f.val.value),
      items: items.filter((i) => i.title.trim()),
      wp_id: wpSel.value || undefined,
    };
    if (!editing) body.project_id = projSel.value;
    err.classList.add('hide');
    try {
      const r = editing
        ? await api.patch(`/interagency-requests/${request.id}`, { ...body, request_version: request.version })
        : await api.post('/interagency-requests', body);
      m.close();
      onDone?.(r.request);
      if (editing) toast('حُفظت المسودة', 'ok');
      else
        completionDialog({
          title: 'أُنشئت مسودة الطلب',
          lead: 'حُفظ الطلب مسودةً ولم يُرسَل إلى أحد بعد.',
          ref: r.request.ref,
          steps: [
            'راجع العناصر والمرفقات وموعد الحاجة داخل الطلب.',
            'اضغط «إرسال للاعتماد» ليراجعه مفوّض جهتك.',
            'بعد اعتماده يصل إلى لجنة المشروع لتحيله إلى الجهة المختصة؛ الإحالة تنسيقية ولا تُلزم أحدًا.',
            'تتابع الردّ من «لدى من الكرة؟» داخل الطلب وفي صفحتك الرئيسية.',
          ],
          actions: [
            { label: 'فتح الطلب', href: `#/requests/${r.request.id}` },
            { label: 'طلباتي', href: '#/requests' },
            { label: 'الرئيسية', href: '#/' },
          ],
        });
    } catch (e) {
      const FL = {
        title: 'العنوان',
        description: 'الوصف',
        required_by: 'موعد الحاجة',
        impact_text: 'الأثر',
        estimated_value: 'القيمة التقديرية',
        wp_id: 'حزمة العمل',
        project_id: 'المشروع',
      };
      const lab = (k) => {
        const mm = /^items\[(\d+)\]\.(\w+)$/.exec(k);
        return mm
          ? `العنصر ${Number(mm[1]) + 1} — ${mm[2] === 'title' ? 'العنوان' : mm[2] === 'qty' ? 'الكمية' : mm[2]}`
          : FL[k] || k;
      };
      const fields = e.details?.fields;
      const lines =
        fields && typeof fields === 'object'
          ? Object.entries(fields).map(([k, v]) => `${lab(k)}: ${Array.isArray(v) ? v.join('، ') : v}`)
          : [];
      err.replaceChildren(
        h('b', null, e.status === 0 ? 'تعذّر الاتصال بالخادم. لم يُحفظ شيء — أعد المحاولة.' : e.message),
        lines.length
          ? h(
              'ul',
              { class: 'small' },
              lines.map((l) => h('li', null, l)),
            )
          : null,
      );
      err.tabIndex = -1;
      err.classList.remove('hide');
      err.focus();
    }
  };
  const m = modal({
    title: editing ? 'تعديل مسودة الطلب' : 'طلب جديد إلى جهة أخرى',
    wide: true,
    body: [
      noticeEl(
        'هذا طلب وليس أمرًا. تُرسله إلى لجنة المشروع لتحيله إلى الجهة المختصة، ولا تنشأ مهام داخل الجهة الأخرى إلا إذا قبلت.',
        '',
        'info',
      ),
      h(
        'div',
        { class: 'form-grid' },
        !editing
          ? field(
              'tp',
              'ابدأ من قالب جاهز (اختياري)',
              h('div', { class: 'col', style: { gap: '4px' } }, tplSel, catalogNote),
              { hint: 'يملأ العنوان وعناصر الطلب ويمكنك تعديلها' },
            )
          : null,
        !editing ? field('p', 'المشروع', projSel, { req: true, half: true }) : null,
        field('w', 'حزمة العمل المرتبطة (اختياري)', wpSel, { half: true }),
        field('t', 'عنوان الطلب', f.title, { req: true }),
        field('d', 'الوصف', f.desc, { req: true }),
        field('b', 'موعد الحاجة', f.by, { req: true, half: true }),
        field('i', 'الأثر عند التأخر', f.impact, { half: true }),
        field('v', 'القيمة التقديرية (د.إ)', f.val, {
          half: true,
          hint: 'تُقارَن بالحد المالي لتفويض الجهة عند قبول الطلب',
        }),
      ),
      h(
        'div',
        null,
        h('h3', { style: { marginBlockEnd: '8px' } }, 'عناصر الطلب'),
        itemsBox,
        h(
          'button',
          {
            type: 'button',
            class: 'btn sm',
            style: { marginBlockStart: '8px' },
            onclick: () => {
              items.push({ title: '', service_type: 'other', spec: '' });
              drawItems();
            },
          },
          icon('plus', 14),
          'إضافة عنصر آخر',
        ),
        h(
          'div',
          { class: 'hint small muted', style: { marginBlockStart: '6px' } },
          'إذا كان الطلب يخص أكثر من جهة، اكتب كل عنصر منفصلًا؛ يستطيع رئيس اللجنة تفكيكه إلى طلبات مستقلة.',
        ),
      ),
      err,
    ],
    actions: [
      h('button', { class: 'btn primary', onclick: submit }, editing ? 'حفظ التعديلات' : 'حفظ كمسودة'),
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'إلغاء'),
    ],
  });
  return m;
}

// ============================================================ detail
// Neighbours of a request: project, work package, parent/dependency, registers filtered to this request, and its chat.
function reqRelated(r) {
  const ref = encodeURIComponent(r.ref);
  const items = [
    { label: `المشروع: ${r.project_name}`, href: `#/p/${r.project_id}/overview` },
    r.wp
      ? {
          label: `حزمة العمل: ${r.wp.ref} — ${r.wp.title}`,
          href: `#/p/${r.project_id}/board?wp=${r.wp.id}`,
          sub: r.wp.status_ar,
        }
      : null,
    r.parent ? { label: `الطلب الأصل ${r.parent.ref}`, href: `#/requests/${r.parent.id}` } : null,
    r.depends_on ? { label: `يعتمد على ${r.depends_on.ref}`, href: `#/requests/${r.depends_on.id}` } : null,
    r.can_add_tasks ? { label: 'مهام الجهة المرتبطة بهذا الالتزام', href: '#/tasks' } : null,
    r.decisions?.length
      ? {
          label: 'قرارات هذا الطلب في سجل القرارات',
          href: `#/decisions?project_id=${r.project_id}&q=${ref}`,
          count: r.decisions.length,
        }
      : null,
    r.evidence?.length
      ? {
          label: 'أدلة هذا الطلب في سجل الأدلة',
          href: `#/evidence?project_id=${r.project_id}&q=${ref}`,
          count: r.evidence.length,
        }
      : null,
    r.thread_id ? { label: 'محادثة الطلب', href: `#/messages/${r.thread_id}` } : null,
  ];
  return h('section', { class: 'card pad' }, relatedPanel(items));
}

export async function requestView({ parts, ctx, go, refresh }) {
  const id = parts[0];
  const { request: r } = await api.get(`/interagency-requests/${id}`);
  const me = ctx.me;
  const thread = r.thread_id ? await api.get(`/threads/${r.thread_id}`).catch(() => null) : null;

  const acts = r.actions || [];
  const primary = acts.find((a) => a.kind === 'primary' && a.enabled);
  const others = acts.filter((a) => a !== primary);
  const btnFor = (a) =>
    h(
      'button',
      {
        class: `btn ${a.kind === 'primary' ? 'primary' : a.kind === 'danger' ? 'danger' : ''}`,
        disabled: !a.enabled ? true : null,
        title: a.reason || '',
        onclick: (e) => perform(r, a, { me, refresh, go, btn: e.currentTarget }),
      },
      a.label,
    );
  const actionCard = acts.length
    ? h(
        'div',
        { class: 'card pad primary-action' },
        h('h3', null, primary ? 'الإجراء المطلوب' : 'الإجراءات'),
        primary ? btnFor(primary) : h('div', { class: 'small muted' }, 'لا يوجد إجراء مطلوب منك في هذه المرحلة.'),
        others.filter((a) => a.enabled).map(btnFor),
        others.some((a) => !a.enabled)
          ? h(
              'details',
              null,
              h('summary', { class: 'small muted', style: { cursor: 'pointer' } }, 'إجراءات غير متاحة لك'),
              h(
                'ul',
                { class: 'check-list', style: { marginBlockStart: '8px' } },
                others
                  .filter((a) => !a.enabled)
                  .map((a) =>
                    h(
                      'li',
                      null,
                      h('span', { class: 'no' }, icon('lock', 14)),
                      h('span', null, h('b', null, a.label), h('div', { class: 'xs muted' }, a.reason || '')),
                    ),
                  ),
              ),
            )
          : null,
      )
    : null;

  const infoBlock =
    r.info_request && r.status === 'NEEDS_INFORMATION'
      ? h(
          'div',
          { class: 'callout' },
          h('b', null, `مطلوب استكمال من ${r.info_request.by === 'org' ? r.target_org_name : 'اللجنة'}:`),
          h(
            'ul',
            { style: { margin: '6px 0 0', paddingInlineStart: '20px' } },
            r.info_request.items.map((i) => h('li', null, i)),
          ),
          r.reroute_hint ? null : null,
        )
      : null;
  const rerouteHint = r.reroute_hint
    ? noticeEl('استُكمل الطلب بعد طلب الجهة — جاهز لإعادة إحالته إلى الجهة نفسها.', 'ok', 'check')
    : null;

  const decisions = r.decisions?.length
    ? section(
        'قرارات الجهات',
        h(
          'div',
          { class: 'col' },
          r.decisions.map((d) =>
            h(
              'div',
              { class: `dec ${d.type}` },
              h(
                'div',
                { class: 'row' },
                h(
                  'b',
                  null,
                  { ACCEPT: 'قبول الطلب', DECLINE: 'اعتذار', COUNTER: 'مقترح بديل', NEED_INFO: 'طلب استكمال' }[
                    d.type
                  ] || d.type,
                ),
                d.reason_label ? badge(d.reason_label, 'danger') : null,
                h('span', { class: 'xs muted' }, `${d.org_name} — ${d.by_name} · ${fmtDT(d.at)}`),
              ),
              d.scope_text
                ? h(
                    'p',
                    { class: 'small', style: { marginBlockStart: '4px' } },
                    h('b', null, 'النطاق المقبول: '),
                    d.scope_text,
                  )
                : null,
              d.reason_text
                ? h('p', { class: 'small', style: { marginBlockStart: '4px' } }, h('b', null, 'السبب: '), d.reason_text)
                : null,
              d.new_scope
                ? h('p', { class: 'small', style: { marginBlockStart: '4px' } }, h('b', null, 'المقترح: '), d.new_scope)
                : null,
            ),
          ),
        ),
      )
    : null;

  const commits = r.commitments?.length
    ? section(
        'الالتزام المؤسسي',
        h(
          'div',
          { class: 'col' },
          r.commitments.map((c) =>
            h(
              'div',
              null,
              h(
                'div',
                { class: 'row' },
                badge(c.status === 'ACTIVE' ? 'التزام ساري' : 'مغلق', c.status === 'ACTIVE' ? 'success' : 'done'),
                h(
                  'span',
                  { class: 'small' },
                  `قبله ${c.accepted_by_name} (${c.org_name}) في ${fmtDate(c.accepted_at)}`,
                ),
              ),
              kv([
                ['النطاق', c.scope_text],
                c.conditions ? ['الشروط', c.conditions] : null,
                ['موعد الإنجاز', fmtDate(c.due_on)],
                ['سند التفويض', c.basis],
              ]),
              h(
                'div',
                { style: { marginBlock: '8px' } },
                h('div', { class: 'small muted' }, `التقدم المشترك: ${c.progress}٪`),
                progressBar(0, c.progress, true),
              ),
              c.shared_updates?.length
                ? h(
                    'ul',
                    { class: 'check-list' },
                    c.shared_updates
                      .slice(-3)
                      .reverse()
                      .map((u) =>
                        h(
                          'li',
                          null,
                          h('span', { class: 'muted' }, icon('clock', 14)),
                          h('span', null, u.note, h('div', { class: 'xs muted' }, `${u.by_name} · ${ago(u.at)}`)),
                        ),
                      ),
                  )
                : null,
              c.mine && r.can_add_tasks
                ? h(
                    'div',
                    { class: 'row', style: { marginBlockStart: '10px' } },
                    h(
                      'button',
                      { class: 'btn sm primary', onclick: () => taskDialog(r, c, refresh) },
                      icon('plus', 14),
                      'وزّع على فريق الجهة',
                    ),
                    h('button', { class: 'btn sm', onclick: () => updateDialog(c, refresh) }, 'نشر تحديث مشترك'),
                    h('a', { class: 'btn sm ghost', href: '#/tasks' }, 'مهام الجهة'),
                  )
                : null,
            ),
          ),
        ),
      )
    : null;

  const evidence =
    r.evidence?.length || ['IN_EXECUTION', 'ACCEPTED_BY_ORG', 'BLOCKED', 'RETURNED_FOR_CORRECTION'].includes(r.status)
      ? section(
          'الأدلة والمرفقات',
          r.evidence?.length
            ? h(
                'ul',
                { class: 'check-list' },
                r.evidence.map((e) =>
                  h(
                    'li',
                    null,
                    h('span', { class: 'muted' }, icon('doc', 16)),
                    h(
                      'span',
                      null,
                      h('b', null, e.title),
                      h(
                        'div',
                        { class: 'xs muted' },
                        `${e.file_name || '—'} · ${e.size ? fmtSize(e.size) : ''} · ${e.by_name} · ${e.visibility}${e.sha256 ? ' · SHA-256 ' + e.sha256.slice(0, 10) + '…' : ''}`,
                      ),
                    ),
                    h('span', { class: 'grow' }),
                    fileButton(e),
                  ),
                ),
              )
            : h('div', { class: 'small muted' }, 'لا أدلة بعد. لا يُقبل تسليم المخرج بلا دليل مشترك واحد على الأقل.'),
        )
      : null;

  const dispute = r.dispute
    ? section(
        'قضية اختلاف الاختصاص',
        h(
          'div',
          { class: 'col' },
          h('div', null, h('b', null, 'موضوع الخلاف: '), r.dispute.reason),
          r.dispute.status === 'RESOLVED'
            ? h('div', null, h('b', null, 'رأي المرجع المستقل (استشاري غير ملزم): '), r.dispute.opinion)
            : badge('بانتظار رأي المرجع المستقل', 'attention'),
        ),
      )
    : null;

  const main = h(
    'div',
    { class: 'stack' },
    h('div', { class: 'card pad' }, h('div', { class: 'col' }, journey(r), ballBanner(r, me))),
    infoBlock,
    rerouteHint,
    r.status === 'COUNTERPROPOSAL'
      ? noticeEl(
          'قدّمت الجهة مقترحًا بديلًا. لا يصبح التزامًا إلا إذا وافقت الجهة الطالبة ثم أصدرت الجهة قرارها الرسمي النهائي.',
          'warn',
          'alert',
        )
      : null,
    r.status === 'DECLINED_WITH_REASON'
      ? noticeEl(
          'اعتذار الجهة قرار مسبَّب ومحفوظ. للجنة إعادة التوجيه إلى جهة أخرى دون حذف القرار السابق.',
          'warn',
          'alert',
        )
      : null,
    section(
      'تفاصيل الطلب',
      h(
        'div',
        { class: 'col' },
        h('p', { style: { whiteSpace: 'pre-wrap' } }, r.description || '—'),
        h('h3', null, 'العناصر المطلوبة'),
        h(
          'ul',
          { class: 'check-list' },
          r.items.map((i) =>
            h(
              'li',
              null,
              h('span', { class: 'muted' }, icon('check', 14)),
              h(
                'span',
                null,
                h('b', null, i.title),
                ' ',
                badge(i.service_label),
                i.spec ? h('div', { class: 'xs muted' }, i.spec) : null,
              ),
            ),
          ),
        ),
        kv([
          ['موعد الحاجة', fmtDate(r.required_by)],
          ...(r.baseline_version != null
            ? [
                [
                  'خط الأساس',
                  `الإصدار ${r.baseline_version}${(r.baseline_history || []).length ? ' (رُحّل ' + r.baseline_history.length + ' مرة)' : ''}`,
                ],
              ]
            : []),
          ...(r.estimated_value != null
            ? [['القيمة التقديرية', `${r.estimated_value.toLocaleString('en-US')} د.إ`]]
            : []),
          ['الأثر عند التأخر', r.impact_text || '—'],
          r.wp
            ? ['حزمة العمل', h('a', { href: `#/p/${r.project_id}/board?wp=${r.wp.id}` }, `${r.wp.ref} — ${r.wp.title}`)]
            : null,
          r.parent ? ['فُكّك من', h('a', { href: `#/requests/${r.parent.id}` }, r.parent.ref)] : null,
          r.attachments?.length ? ['المرفقات', r.attachments.map((a) => a.name).join('، ')] : null,
        ]),
      ),
    ),
    decisions,
    commits,
    evidence,
    dispute,
    r.children?.length
      ? section(
          'الطلبات الفرعية بعد التفكيك',
          h(
            'ul',
            { class: 'check-list' },
            r.children.map((c) =>
              h(
                'li',
                null,
                h('a', { href: `#/requests/${c.id}` }, c.ref),
                ' — ',
                c.title,
                ' ',
                badge(c.status_ar, c.tone),
              ),
            ),
          ),
        )
      : null,
    section('سجل الطلب', eventsList(r.events)),
    reqRelated(r),
  );

  const side = h(
    'div',
    { class: 'stack sticky-side' },
    actionCard,
    h(
      'div',
      { class: 'card pad' },
      kv([
        ['الجهة الطالبة', r.requester_org_name],
        ['الجهة المختصة', r.target_org_name || 'لم تُحدَّد'],
        ['المشروع', h('a', { href: `#/p/${r.project_id}/overview` }, r.project_name)],
        ['أعدّه', r.created_by_name],
        ['أُنشئ', fmtDate(r.created_at)],
        r.sla?.hours ? ['مدة الرد المرجعية', `${r.sla.hours} ساعة`] : null,
      ]),
    ),
    r.referrals?.length
      ? h(
          'div',
          { class: 'card pad' },
          h('h3', { style: { marginBlockEnd: '8px' } }, 'الإحالات'),
          h(
            'ul',
            { class: 'check-list' },
            r.referrals.map((x) =>
              h(
                'li',
                null,
                h('span', { class: x.superseded ? 'muted' : 'ok' }, icon(x.superseded ? 'x' : 'chev', 14)),
                h(
                  'span',
                  null,
                  h('b', null, x.target_org_name),
                  x.superseded ? h('span', { class: 'xs muted' }, ' (استُبدلت)') : null,
                  h(
                    'div',
                    { class: 'xs muted' },
                    `${x.by_name} · ${fmtDate(x.at)} · ${x.ack_at ? 'استُلمت' : 'لم تُستلم بعد'}`,
                  ),
                  h('div', { class: 'xs' }, x.reason),
                ),
              ),
            ),
          ),
        )
      : null,
    thread ? chatCard(thread, r, refresh) : null,
  );
  const crumbs = breadcrumb([['طلبات الجهات', '#/requests'], [r.ref]]);
  return {
    title: r.title,
    el: h(
      'div',
      { class: 'stack' },
      crumbs,
      h(
        'div',
        { class: 'page-head' },
        h(
          'div',
          { class: 'page-head-main' },
          h('h1', null, r.title),
          h('div', { class: 'sub' }, `${r.ref} · `, orgRoute(r)),
        ),
        statusBadge(r),
        r.editable
          ? h(
              'button',
              { class: 'btn', onclick: () => requestForm({ request: r, me, onDone: refresh }) },
              'تعديل المسودة',
            )
          : null,
      ),
      h('div', { class: 'split-layout' }, main, side),
    ),
  };
}

function chatCard(thread, r, refresh) {
  const msgs = h(
    'div',
    { class: 'col', style: { maxHeight: '260px', overflowY: 'auto', gap: '6px' } },
    thread.messages
      .slice(-12)
      .map((m) =>
        h(
          'div',
          { class: 'small' },
          h('b', null, m.by),
          h('span', { class: 'muted' }, ` · ${ago(m.at)}`),
          h('div', null, m.text),
        ),
      ),
  );
  const input = h('input', { placeholder: 'اكتب استفسارًا أو تنسيقًا…', 'aria-label': 'رسالة' });
  const send = async () => {
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    try {
      await api.post(`/threads/${thread.thread.id}/messages`, { text: t });
      refresh();
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });
  return h(
    'div',
    { class: 'card pad' },
    h('div', { class: 'row' }, h('h3', { style: { flex: 1 } }, 'محادثة الطلب'), badge('للتنسيق فقط', 'neutral')),
    h(
      'div',
      { class: 'xs muted', style: { marginBlock: '4px 8px' } },
      'الرسائل لا تُعد قبولًا ولا اعتذارًا ولا قرارًا رسميًا.',
    ),
    msgs,
    h(
      'div',
      { class: 'row nowrap', style: { marginBlockStart: '10px' } },
      input,
      h('button', { class: 'btn primary sm', onclick: send, 'aria-label': 'إرسال' }, icon('send', 16)),
    ),
  );
}

// ============================================================ actions
async function post(r, key, body) {
  return api.post(`/interagency-requests/${r.id}/${key}`, { request_version: r.version, ...body });
}

function perform(r, a, { me, refresh, go }) {
  const done = (msg) => async () => {
    toast(msg, 'ok');
    refresh();
  };
  const simple = async (title, text, ok, msg, danger, next) => {
    if (await confirmDialog({ title, text, ok, danger })) {
      try {
        await post(r, a.key);
        done(msg)();
        if (next)
          completionDialog({
            title: msg,
            lead: msg + '.',
            ref: r.ref,
            steps: next,
            actions: [{ label: 'العودة للطلب' }, { label: 'كل الطلبات', href: '#/requests' }],
          });
      } catch (e) {
        toast(e.message, 'err');
        if (e.code === 'STALE_VERSION') refresh();
      }
    }
  };
  const withForm = (title, fields, submit, msg, opts = {}) =>
    formDialog({
      title,
      fields,
      submit,
      danger: opts.danger,
      intro: opts.intro,
      onSubmit: async (v) => {
        await post(r, a.key, opts.map ? opts.map(v) : v);
        done(msg)();
      },
    });
  switch (a.key) {
    case 'send-for-approval':
      return simple(
        'إرسال الطلب لاعتماد مفوّض الجهة',
        'سيراجع مفوّض جهتك الطلب ويعتمد إرساله إلى لجنة المشروع. لن يصل للجنة قبل اعتماده.',
        'إرسال للاعتماد',
        'أُرسل الطلب لمفوّض الجهة',
        false,
        [
          'يراجع مفوّض جهتك الطلب ويعتمد إرساله، أو يعيده إليك بسبب.',
          'بعد الاعتماد يصل إلى لجنة المشروع.',
          'ستصلك إشعارات عند كل تغيّر في حالته.',
        ],
      );
    case 'submit':
      return simple(
        'اعتماد الطلب وإرساله إلى اللجنة',
        'سيصل الطلب إلى أمانة لجنة المشروع باسم جهتكم. هذا الإرسال ليس التزامًا على أي جهة أخرى.',
        'اعتماد وإرسال',
        'أُرسل الطلب إلى لجنة المشروع',
        false,
        [
          'تفرز أمانة اللجنة الطلب وتحيله إلى الجهة المختصة مع مبرر واضح.',
          'الجهة المختصة وحدها تقبل أو تعتذر، والصمت لا يُعد قبولًا؛ يظهر لك تذكير إن تجاوزت مدة الرد.',
          'تابع حالة الطلب و«لدى من الكرة؟» من صفحة الطلب أو من الرئيسية.',
        ],
      );
    case 'return-to-draft':
      return withForm(
        'إعادة الطلب مسودة',
        [{ name: 'reason', label: 'سبب الإعادة', type: 'textarea', required: true }],
        'إعادة',
        'أُعيد إلى المسودة',
      );
    case 'cancel':
      return simple(
        'إلغاء المسودة',
        'ستُلغى هذه المسودة ويبقى أثرها في السجل.',
        'إلغاء المسودة',
        'أُلغيت المسودة',
        true,
      );
    case 'request-info':
      return withForm(
        'طلب استكمال من الجهة الطالبة',
        [
          {
            name: 'missing_items',
            label: 'ما الذي ينقص تحديدًا؟',
            type: 'lines',
            required: true,
            hint: 'اكتب كل بند ناقص في سطر مستقل',
          },
        ],
        'إرسال طلب الاستكمال',
        'أُرسل طلب الاستكمال',
      );
    case 'respond-info':
      return withForm(
        'استكمال الطلب',
        [{ name: 'response_text', label: 'ما الذي استُكمل؟', type: 'textarea', required: true }],
        'إرسال الاستكمال',
        'أُرسل الاستكمال',
      );
    case 'route-to-chair':
      return withForm(
        'رفع الطلب للرئيس للتوجيه',
        [
          {
            name: 'candidate_org_id',
            label: 'الجهة المقترحة (اختياري)',
            type: 'select',
            options: r.candidates.map((c) => ({
              value: c.id,
              label: c.name + (c.suggested ? ' — مقترحة حسب نوع الخدمة' : ''),
            })),
            value: r.candidates.find((c) => c.suggested)?.id,
          },
        ],
        'رفع للرئيس',
        'رُفع الطلب للرئيس',
        { intro: 'تحققتَ من اكتمال الطلب؟ الرئيس وحده يملك الإحالة الرسمية.' },
      );
    case 'refer':
    case 'reroute': {
      const sug = r.candidates.filter((c) => c.suggested);
      return withForm(
        a.key === 'refer' ? 'إحالة الطلب إلى الجهة المختصة' : 'إعادة توجيه الطلب إلى جهة',
        [
          {
            name: 'target_org_id',
            label: 'الجهة المختصة',
            type: 'select',
            required: true,
            options: r.candidates.map((c) => ({
              value: c.id,
              label: c.name + (c.suggested ? ` — مقترحة (${c.types.join('، ')})` : ''),
            })),
            value: sug.length === 1 ? sug[0].id : '',
          },
          {
            name: 'reason',
            label: 'مبرر الإحالة',
            type: 'textarea',
            required: true,
            value: a.key === 'refer' ? 'للدراسة والإفادة في حدود الاختصاص.' : '',
          },
          ...((r.declined_org_ids || []).length
            ? [
                {
                  name: 'review_note',
                  label: 'مذكرة المراجعة (إلزامية عند الإحالة إلى جهة سبق أن اعتذرت)',
                  type: 'textarea',
                  hint: `سبق اعتذار: ${r.candidates
                    .filter((c) => r.declined_org_ids.includes(c.id))
                    .map((c) => c.name)
                    .join('، ')} — اشرح ما تغيّر.`,
                },
              ]
            : []),
        ],
        'أحِل الطلب',
        'أُحيل الطلب',
        { intro: 'الإحالة تنسيقية: لا تُلزم الجهة بالتنفيذ، وللجهة أن تقبل أو تعتذر بسبب أو تقترح بديلًا.' },
      );
    }
    case 'acknowledge':
      return simple(
        'تأكيد استلام الطلب',
        'تأكيد الاستلام يعني بدء الدراسة فقط، وليس قبولًا للطلب. القرار الرسمي يصدر لاحقًا بتفويض.',
        'تأكيد الاستلام',
        'سُجّل استلام الطلب',
      );
    case 'decide':
      return decideDialog(r, done);
    case 'respond-counter':
      return formDialog({
        title: 'الرد على المقترح البديل',
        fields: [
          {
            name: 'agree',
            label: 'هل توافق على النطاق المقترح؟',
            type: 'select',
            required: true,
            placeholder: false,
            options: [
              { value: 'yes', label: 'نعم، أوافق على المقترح' },
              { value: 'no', label: 'لا أوافق' },
            ],
            value: 'yes',
          },
          { name: 'note', label: 'ملاحظة', type: 'textarea', hint: 'إلزامية عند عدم الموافقة' },
        ],
        submit: 'إرسال الرد',
        onSubmit: async (v) => {
          await post(r, 'respond-counter', { agree: v.agree === 'yes', note: v.note });
          done('سُجّل ردكم')();
        },
      });
    case 'reconsider':
      return withForm(
        'طلب إعادة نظر',
        [{ name: 'reason', label: 'ما الجديد الذي يستدعي إعادة النظر؟', type: 'textarea', required: true }],
        'طلب إعادة النظر',
        'أُرسل طلب إعادة النظر',
      );
    case 'close-declined':
      return simple('إغلاق الطلب بعد الاعتذار', 'يُغلق الطلب ويبقى السجل والقرار محفوظين.', 'إغلاق', 'أُغلق الطلب');
    case 'withdraw':
      return withForm(
        'سحب الطلب',
        [{ name: 'reason', label: 'سبب السحب', type: 'textarea', required: true }],
        'سحب الطلب',
        'سُحب الطلب',
        { danger: true },
      );
    case 'split':
      return withForm(
        'تفكيك الطلب إلى طلبات مستقلة',
        [{ name: 'reason', label: 'سبب التفكيك', type: 'textarea', value: 'لاختلاف الجهة المختصة لكل عنصر.' }],
        'فكّك الطلب',
        'فُكّك الطلب',
        { intro: `سيصبح كل عنصر (${r.items.length}) طلبًا مستقلًا له جهته وقراره.` },
      );
    case 'start-execution':
      return simple(
        'بدء التنفيذ',
        'سيُسجَّل بدء تنفيذ الالتزام. إن كان مرتبطًا بحزمة عمل فيجب أن يكون تصريح بدئها قد صدر.',
        'بدء التنفيذ',
        'بدأ التنفيذ',
      );
    case 'block':
      return withForm(
        'الإبلاغ عن عائق',
        [{ name: 'reason', label: 'سبب التوقف والجهة المطلوب منها الحل', type: 'textarea', required: true }],
        'أبلغ عن العائق',
        'سُجّل العائق',
      );
    case 'unblock':
      return simple('استئناف التنفيذ', 'سيعود الطلب إلى حالة التنفيذ.', 'استئناف', 'استؤنف التنفيذ');
    case 'submit-deliverable':
      return simple(
        'تسليم المخرج للمراجعة',
        'سيراجع مفوّض الجهة الطالبة المخرج والأدلة المشتركة. لا يصبح الطلب منجزًا إلا بقبولهم.',
        'تسليم للمراجعة',
        'سُلّم المخرج للمراجعة',
      );
    case 'review-deliverable':
      return formDialog({
        title: 'مراجعة المخرج',
        intro: 'اقبل المخرج إذا طابق ما التُزم به ودعمته الأدلة، وإلا أعده للتصحيح مع بيان المطلوب.',
        fields: [
          {
            name: 'decision',
            label: 'قرار المراجعة',
            type: 'select',
            required: true,
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
          await post(r, 'review-deliverable', v);
          done(v.decision === 'accept' ? 'قُبل المخرج' : 'أُعيد للتصحيح')();
        },
      });
    case 'close':
      return simple(
        'إغلاق الطلب إداريًا',
        'الإغلاق الإداري لا يُعد إذنًا بالصرف ولا توقيع عقد؛ هو إقفال للمتابعة بعد قبول المخرج.',
        'إغلاق الطلب',
        'أُغلق الطلب',
      );
    case 'add-evidence':
      return evidenceDialog(r, refresh);
    case 'remind':
      return simple(
        'إرسال تذكير للجهة',
        'يُرسل إشعار إلى مفوّضي الجهة. التذكير لا يغيّر حالة الطلب ولا يعني القبول.',
        'إرسال التذكير',
        'أُرسل التذكير',
      );
    case 'dispute':
      return formDialog({
        title: 'إحالة القضية إلى مرجع مستقل',
        intro: 'يعيّن النظام مرجعًا مستقلًا لا تعارض معه. رأيه استشاري وغير ملزم.',
        fields: [{ name: 'reason', label: 'موضوع الخلاف', type: 'textarea', required: true }],
        submit: 'إحالة',
        onSubmit: async (v) => {
          await api.post(`/interagency-requests/${r.id}/dispute`, v);
          done('أُحيلت القضية')();
        },
      });
    case 'opinion':
      return formDialog({
        title: 'تسجيل رأي المرجع المستقل',
        fields: [{ name: 'opinion', label: 'الرأي مسببًا', type: 'textarea', required: true, rows: 6 }],
        submit: 'تسجيل الرأي',
        onSubmit: async (v) => {
          await api.post(`/interagency-requests/${r.id}/opinion`, v);
          done('سُجّل الرأي')();
        },
      });
    default:
      toast('هذا الإجراء غير متاح في هذه النسخة', 'err');
  }
}

function decideDialog(r, done) {
  const kinds = [
    ['ACCEPT', 'قبول الطلب', 'تلتزم الجهة بالنطاق الذي تحدده أدناه'],
    ['DECLINE', 'الاعتذار بسبب', 'سبب إلزامي مصنّف ومكتوب'],
    ['COUNTER', 'مقترح بديل', 'تغيير النطاق أو التفكيك'],
    ['NEED_INFO', 'طلب استكمال', 'تحديد الناقص بدقة'],
  ];
  let kind = 'ACCEPT';
  const panes = {};
  const inputs = {};
  const mk = (k, label, ctrl, hint) =>
    h('div', { class: 'field' }, h('label', null, label), ctrl, hint && h('div', { class: 'hint' }, hint));
  inputs.scope_text = h('textarea', {
    rows: 3,
    placeholder: 'ما الذي ستنفذه الجهة بالضبط؟ وما الذي لا يدخل في النطاق؟',
  });
  inputs.conditions = h('input', { placeholder: 'مثال: تزويدنا بالمواصفات المعتمدة قبل البدء' });
  inputs.due_on = h('input', { type: 'date', value: r.required_by || '' });
  inputs.reason_code = h(
    'select',
    null,
    h('option', { value: '' }, '— اختر التصنيف —'),
    Object.entries(REASONS).map(([k, v]) => h('option', { value: k }, v)),
  );
  inputs.reason_text = h('textarea', { rows: 3, placeholder: 'اشرح سبب الاعتذار بوضوح. لا يُقبل اعتذار بلا شرح.' });
  inputs.new_scope = h('textarea', { rows: 3, placeholder: 'ما النطاق أو التفكيك الذي تقترحه الجهة؟' });
  inputs.counter_reason = h('textarea', { rows: 2, placeholder: 'لماذا لا يمكن تنفيذ الطلب كما ورد؟' });
  inputs.missing = h('textarea', { rows: 3, placeholder: 'اكتب كل مستند أو معلومة ناقصة في سطر مستقل' });
  panes.ACCEPT = [
    mk('s', 'نطاق الالتزام *', inputs.scope_text),
    mk('c', 'الشروط (إن وجدت)', inputs.conditions),
    mk('d', 'موعد الإنجاز', inputs.due_on),
  ];
  panes.DECLINE = [mk('rc', 'تصنيف السبب *', inputs.reason_code), mk('rt', 'شرح السبب *', inputs.reason_text)];
  panes.COUNTER = [mk('n', 'المقترح البديل *', inputs.new_scope), mk('r', 'سبب المقترح *', inputs.counter_reason)];
  panes.NEED_INFO = [mk('m', 'الناقص تحديدًا *', inputs.missing)];
  const paneBox = h('div', { class: 'col' });
  const err = h('div', { class: 'notice err hide', role: 'alert' });
  const segBtns = kinds.map(([k, l, d]) =>
    h(
      'label',
      { class: 'card pad', style: { cursor: 'pointer', display: 'flex', gap: '10px', alignItems: 'flex-start' } },
      h('input', {
        type: 'radio',
        name: 'dk',
        value: k,
        checked: k === kind ? true : null,
        onchange: () => {
          kind = k;
          drawPane();
        },
      }),
      h('span', null, h('b', null, l), h('div', { class: 'xs muted' }, d)),
    ),
  );
  const drawPane = () => mount(paneBox, panes[kind]);
  drawPane();
  const submit = async () => {
    const body = { decision: kind };
    if (kind === 'ACCEPT')
      Object.assign(body, {
        scope_text: inputs.scope_text.value,
        conditions: inputs.conditions.value,
        due_on: inputs.due_on.value,
      });
    if (kind === 'DECLINE')
      Object.assign(body, { reason_code: inputs.reason_code.value, reason_text: inputs.reason_text.value });
    if (kind === 'COUNTER')
      Object.assign(body, { new_scope: inputs.new_scope.value, reason_text: inputs.counter_reason.value });
    if (kind === 'NEED_INFO')
      Object.assign(body, {
        missing_items: inputs.missing.value
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      });
    err.classList.add('hide');
    try {
      await post(r, 'decide', body);
      m.close();
      done(
        {
          ACCEPT: 'قُبل الطلب وأصبح التزامًا مؤسسيًا',
          DECLINE: 'سُجّل الاعتذار المسبَّب',
          COUNTER: 'أُرسل المقترح البديل',
          NEED_INFO: 'أُرسل طلب الاستكمال',
        }[kind],
      )();
    } catch (e) {
      err.textContent =
        e.message + (e.details?.uncovered ? ` — غير مشمول بتفويضك: ${e.details.uncovered.join('، ')}` : '');
      err.classList.remove('hide');
    }
  };
  const m = modal({
    title: 'القرار الرسمي للجهة',
    wide: true,
    body: [
      noticeEl(
        'هذا قرار باسم جهتكم ويُحفظ مع سند التفويض. الصمت لا يُعد قبولًا، ولا يملك الرئيس ولا الجهة الطالبة قبول الطلب نيابة عنكم.',
        'warn',
        'shield',
      ),
      h('div', { class: 'grid c2' }, segBtns),
      paneBox,
      err,
    ],
    actions: [
      h('button', { class: 'btn primary', onclick: submit }, 'تسجيل القرار'),
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'إلغاء'),
    ],
  });
}

function evidenceDialog(r, refresh) {
  const ff = fileField('الملف (اختياري — يُسجَّل الدليل بدونه كبيانات فقط)');
  formDialog({
    title: 'إرفاق دليل',
    intro: 'يُرفع الملف فعليًا ويُخزَّن خارج قاعدة البيانات مع بصمة SHA-256. لا يطّلع عليه إلا من مُنح الاطلاع صراحةً.',
    fields: [
      { name: 'title', label: 'عنوان الدليل', required: true },
      {
        name: 'shared',
        label: 'الظهور',
        type: 'select',
        placeholder: false,
        options: [
          { value: 'yes', label: 'مشترك مع الجهة الطالبة واللجنة' },
          { value: 'no', label: 'داخلي لجهتنا فقط' },
        ],
        value: 'yes',
      },
    ],
    submit: 'إرفاق',
    note: ff.el,
    onSubmit: async (v) => {
      const f = ff.input.files[0];
      const up = f ? await uploadFile(r.project_id, f, { onStatus: ff.status }) : null;
      await api.post(`/interagency-requests/${r.id}/evidence`, {
        title: v.title,
        shared: v.shared === 'yes',
        file_id: up?.id,
        file_name: f?.name || '',
      });
      toast('أُرفق الدليل', 'ok');
      refresh();
    },
  });
}

function taskDialog(r, c, refresh) {
  const people = r.people?.org_people || [];
  formDialog({
    title: 'مهمة داخلية ضمن الالتزام',
    intro: 'المهام تُنشأ داخل جهتكم فقط ولا تُسند لموظف في جهة أخرى.',
    fields: [
      { name: 'title', label: 'عنوان المهمة', required: true },
      {
        name: 'assignee_id',
        label: 'المسؤول',
        type: 'select',
        required: true,
        options: people.map((p) => ({ value: p.id, label: p.name })),
      },
      { name: 'planned_start', label: 'البدء', type: 'date', half: true },
      { name: 'planned_end', label: 'الانتهاء', type: 'date', half: true, value: c.due_on },
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
    ],
    submit: 'إنشاء المهمة',
    onSubmit: async (v) => {
      await api.post(`/commitments/${c.id}/internal-tasks`, { ...v, est_hours: v.est_hours || undefined });
      toast('أُنشئت المهمة', 'ok');
      refresh();
    },
  });
}

function updateDialog(c, refresh) {
  formDialog({
    title: 'تحديث مشترك مع الجهة الطالبة',
    intro: 'يظهر هذا التحديث للجهة الطالبة واللجنة. تفاصيل المهام الداخلية تبقى داخل جهتكم.',
    fields: [{ name: 'note', label: 'نص التحديث', type: 'textarea', required: true }],
    submit: 'نشر التحديث',
    onSubmit: async (v) => {
      await api.post(`/commitments/${c.id}/updates`, v);
      toast('نُشر التحديث', 'ok');
      refresh();
    },
  });
}
