// «النماذج الجاهزة»: catalogue (search, sector → specialty, tabs), template preview, and entry points to the plan wizard (template-wizard.js).
// Numbers come from the API (the imported catalogue), never from literals. A template is a proposal: nothing here approves, commits or assigns anyone.
import { api } from '../api.js';
import { h, mount, toast, badge, formDialog, confirmDialog, emptyState } from '../ui.js';
import { breadcrumb, noticeEl } from '../shared.js';

export const KIND = {
  INTERNAL_TASK: ['مهمة داخلية', 'info'],
  INTERAGENCY_REQUEST_CANDIDATE: ['طلب مقترح لجهة أخرى', 'attention'],
  MILESTONE_GATE: ['بوابة تحقق', 'done'],
};
export const fmtN = (n) =>
  new Intl.NumberFormat(document.documentElement.lang === 'en' ? 'en' : 'ar-AE-u-nu-latn').format(n);
const DAYS = [
  ['', 'أي مدة'],
  ['0-30', 'حتى 30 يوم عمل'],
  ['31-60', '31 – 60 يوم عمل'],
  ['61-100', '61 – 100 يوم عمل'],
  ['101-', 'أكثر من 100 يوم عمل'],
];

// width/offset are data-driven and the CSP forbids inline styles: set them with the CSSOM after insertion
export function applyBars(root) {
  root.querySelectorAll('[data-l]').forEach((e) => {
    e.style.insetInlineStart = `${e.dataset.l}%`;
    if (e.dataset.w) e.style.width = `${e.dataset.w}%`;
  });
}

export function gantt(tasks, sc, phases, { names = true } = {}) {
  if (!sc) return h('div', { class: 'muted' }, 'لا جدول');
  const L = Math.max(1, sc.length);
  const phName = new Map(phases.map((p) => [p.id, p.name]));
  const crit = new Set(sc.critical_ids);
  const rows = [...tasks].sort(
    (a, b) => sc.items[a.id].es - sc.items[b.id].es || (a.kind === 'MILESTONE_GATE') - (b.kind === 'MILESTONE_GATE'),
  );
  const tbl = h(
    'div',
    { class: 'g-table', role: 'table', 'aria-label': 'الجدول الزمني بأيام العمل' },
    h(
      'div',
      { class: 'g-head', role: 'row' },
      h('span', { role: 'columnheader' }, 'العنصر'),
      h('span', { role: 'columnheader', class: 'g-axis' }, `من اليوم 1 إلى ${fmtN(sc.length)} من أيام العمل`),
    ),
    rows.map((t) => {
      const it = sc.items[t.id];
      const gate = t.kind === 'MILESTONE_GATE';
      const c = crit.has(t.id);
      const bar = gate
        ? h(
            'span',
            {
              class: `g-gate${c ? ' crit' : ''}`,
              dataset: { l: Math.min(99.2, (it.ef / L) * 100).toFixed(2) },
              title: `${t.name} — ${it.end}`,
            },
            '◆',
          )
        : h('span', {
            class: `g-bar k-${t.kind === 'INTERAGENCY_REQUEST_CANDIDATE' ? 'req' : 'task'}${c ? ' crit' : ''}`,
            dataset: { l: ((it.es / L) * 100).toFixed(2), w: Math.max(1.2, ((it.ef - it.es) / L) * 100).toFixed(2) },
            title: `${t.name}: ${it.start} → ${it.end}`,
          });
      return h(
        'div',
        { class: 'g-row', role: 'row' },
        h(
          'span',
          { class: 'g-name', role: 'cell' },
          names ? h('span', { class: 'xs muted' }, phName.get(t.phase_id) || '', ' · ') : null,
          t.name,
          gate ? h('span', { class: 'sr-only' }, ' (بوابة تحقق)') : null,
          c ? h('span', { class: 'g-crit-tag' }, 'حرج') : null,
        ),
        h(
          'span',
          {
            class: 'g-track',
            role: 'cell',
            'aria-label': gate ? `بوابة في ${it.end}` : `${t.duration_workdays} يوم عمل من ${it.start} إلى ${it.end}`,
          },
          bar,
        ),
      );
    }),
  );
  const el = h('div', { class: 'gantt' }, tbl);
  requestAnimationFrame(() => applyBars(el));
  return el;
}

export async function templatesView({ parts, query, ctx, go }) {
  if (parts[0] === 'draft') {
    const m = await import('./template-wizard.js');
    return m.wizardView({ id: parts[1], step: Number(query.step) || 3, ctx, go });
  }
  if (parts[0]) return previewView(parts[0], ctx, go);
  return catalogView(query, ctx, go);
}

// ============================================================ catalogue
async function catalogView(query, ctx, go) {
  const [meta, drafts] = await Promise.all([
    api.get('/templates/meta'),
    api.get('/template-drafts').catch(() => ({ items: [] })),
  ]);
  const F = {
    q: query.q || '',
    sector: query.sector || '',
    specialty: query.specialty || '',
    tab: query.tab || 'all',
    days: '',
    sort: '',
    offset: 0,
  };
  const grid = h('div', { class: 'grid auto tpl-grid', 'aria-live': 'polite' });
  const more = h('div', { class: 'row', style: { justifyContent: 'center' } });
  const count = h('div', { class: 'small muted', role: 'status' });
  const chips = h('div', { class: 'tpl-chips', role: 'group', 'aria-label': 'المجال' });
  const spec = h('div', { class: 'tpl-chips', role: 'group', 'aria-label': 'التخصص' });
  const tabsEl = h('div', { class: 'seg', role: 'group', 'aria-label': 'مصدر النماذج' });
  const cur = () => meta.sectors.find((s) => s.id === F.sector);
  const params = (extra = {}) => {
    const [lo, hi] = (F.days || '').split('-');
    return {
      q: F.q || undefined,
      sector: F.sector || undefined,
      specialty: F.specialty || undefined,
      tab: F.tab,
      min_days: lo || undefined,
      max_days: hi || undefined,
      sort: F.sort || undefined,
      limit: 24,
      ...extra,
    };
  };
  const cardEl = (t) => {
    const fav = h(
      'button',
      {
        class: 'iconbtn',
        'aria-pressed': String(t.favorite),
        'aria-label': t.favorite ? `إزالة ${t.name_ar} من المفضلة` : `إضافة ${t.name_ar} إلى المفضلة`,
        onclick: async (e) => {
          const b = e.currentTarget;
          const r = await api.post(`/templates/${t.id}/favorite`, { on: b.getAttribute('aria-pressed') !== 'true' });
          b.setAttribute('aria-pressed', String(r.favorite));
          b.textContent = r.favorite ? '★' : '☆';
          meta.counts.favorites = r.count;
          drawTabs();
        },
      },
      t.favorite ? '★' : '☆',
    );
    const use = h(
      'button',
      {
        class: 'btn primary sm',
        disabled: meta.can_create_project ? null : true,
        title: meta.can_create_project ? null : 'إنشاء المشاريع لمنسّق الجهة القائدة؛ يمكنك المعاينة',
        onclick: () => useTemplate(t.id, go),
      },
      'استخدام النموذج',
    );
    return h(
      'article',
      { class: 'card pad tpl-card', 'aria-label': t.name_ar },
      h(
        'div',
        { class: 'row' },
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'xs muted' }, `${t.sector_name_ar} ← ${t.specialty_name_ar}`),
          h('h3', null, h('a', { href: `#/templates/${t.id}` }, t.name_ar)),
        ),
        fav,
      ),
      h('p', { class: 'small' }, t.short_description_ar),
      h('div', { class: 'small' }, h('b', null, 'المخرج: '), t.primary_deliverable_ar),
      h(
        'div',
        { class: 'tpl-stats' },
        h('span', null, `${fmtN(t.phase_count)} مراحل`),
        h('span', null, `${fmtN(t.work_items)} مهمة`),
        h('span', null, `${fmtN(t.gates)} بوابات`),
        h('span', { class: 'tpl-days' }, `~${fmtN(t.estimated_total_workdays)} يوم عمل`),
      ),
      h(
        'div',
        { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } },
        t.origin !== 'official' ? badge(t.origin === 'org' ? 'نموذج جهتنا' : 'نموذجي', 'info') : null,
        t.archived ? badge('مؤرشف', 'neutral') : null,
        ...t.org_roles.slice(0, 3).map((r) => h('span', { class: 'chip' }, r)),
      ),
      h('div', { class: 'row' }, h('a', { class: 'btn sm', href: `#/templates/${t.id}` }, 'معاينة'), use),
    );
  };
  const load = async (append) => {
    const r = await api.get('/templates', params({ offset: append ? F.offset : 0 }));
    F.offset = (append ? F.offset : 0) + r.items.length;
    if (!append) mount(grid);
    r.items.forEach((t) => grid.append(cardEl(t)));
    count.textContent = r.total ? `${fmtN(r.total)} نموذج` : 'لا توجد نتائج';
    mount(
      more,
      r.has_more
        ? h('button', { class: 'btn', onclick: () => load(true) }, `عرض المزيد (${fmtN(r.total - F.offset)})`)
        : null,
    );
    if (!r.total && !append)
      mount(
        grid,
        h(
          'div',
          { class: 'card pad', style: { gridColumn: '1 / -1' } },
          emptyState(
            'لا نموذج بهذا الوصف',
            'جرّب مجالًا قريبًا أو كلمات أقل، أو ابدأ بمشروع فارغ.',
            h(
              'div',
              { class: 'row' },
              h(
                'button',
                {
                  class: 'btn',
                  onclick: () => {
                    Object.assign(F, { q: '', sector: '', specialty: '', days: '' });
                    redraw();
                  },
                },
                'مسح التصفية',
              ),
              h('a', { class: 'btn primary', href: '#/projects?new=1' }, 'مشروع فارغ'),
            ),
          ),
        ),
      );
  };
  const drawChips = () => {
    mount(
      chips,
      h(
        'button',
        {
          class: 'chip',
          'aria-pressed': String(!F.sector),
          onclick: () => {
            F.sector = '';
            F.specialty = '';
            redraw();
          },
        },
        'كل المجالات',
      ),
      meta.sectors.map((s) =>
        h(
          'button',
          {
            class: 'chip',
            'aria-pressed': String(F.sector === s.id),
            onclick: () => {
              F.sector = s.id;
              F.specialty = '';
              redraw();
            },
          },
          s.name_ar,
          ' ',
          h('span', { class: 'n' }, fmtN(s.count)),
        ),
      ),
    );
    const s = cur();
    mount(
      spec,
      s
        ? [
            h('span', { class: 'small muted' }, 'التخصص:'),
            h(
              'button',
              {
                class: 'chip',
                'aria-pressed': String(!F.specialty),
                onclick: () => {
                  F.specialty = '';
                  redraw();
                },
              },
              'الكل',
            ),
            ...s.specialties.map((x) =>
              h(
                'button',
                {
                  class: 'chip',
                  'aria-pressed': String(F.specialty === x.name),
                  onclick: () => {
                    F.specialty = x.name;
                    redraw();
                  },
                },
                x.name,
                ' ',
                h('span', { class: 'n' }, fmtN(x.count)),
              ),
            ),
          ]
        : null,
    );
  };
  const TABS = [
    ['all', 'كل القوالب', meta.counts.all],
    ['mine', 'قوالبي', meta.counts.mine],
    ['org', 'قوالب المؤسسة', meta.counts.org],
    ['favorites', 'المفضلة', meta.counts.favorites],
    ['recent', 'المستخدمة حديثًا', null],
  ];
  const drawTabs = () =>
    mount(
      tabsEl,
      TABS.map(([k, l, n]) =>
        h(
          'button',
          {
            'aria-pressed': String(F.tab === k),
            onclick: () => {
              F.tab = k;
              redraw();
            },
          },
          l,
          n != null ? ` (${fmtN(n)})` : '',
        ),
      ),
    );
  const redraw = () => {
    drawChips();
    drawTabs();
    load(false);
  };
  const q = h('input', {
    type: 'search',
    class: 'tpl-search',
    'aria-label': 'ابحث عن نوع مشروع أو تخصص أو اسم قالب',
    placeholder: 'ابحث عن نوع مشروع أو تخصص أو اسم قالب',
    value: F.q,
    oninput: (e) => {
      clearTimeout(q.t);
      q.t = setTimeout(() => {
        F.q = e.target.value;
        load(false);
      }, 250);
    },
  });
  const days = h(
    'select',
    {
      'aria-label': 'المدة التقديرية',
      onchange: (e) => {
        F.days = e.target.value;
        load(false);
      },
    },
    DAYS.map(([v, l]) => h('option', { value: v }, l)),
  );
  const sort = h(
    'select',
    {
      'aria-label': 'الترتيب',
      onchange: (e) => {
        F.sort = e.target.value;
        load(false);
      },
    },
    [
      ['', 'الأنسب'],
      ['days', 'الأقصر مدة'],
      ['name', 'الاسم'],
    ].map(([v, l]) => h('option', { value: v }, l)),
  );
  const draftsEl = drafts.items.length
    ? h(
        'section',
        { class: 'card pad' },
        h('h2', null, 'مسوداتك قيد التعديل'),
        h(
          'ul',
          { class: 'list' },
          drafts.items.map((d) =>
            h(
              'li',
              { class: 'row' },
              h(
                'div',
                { class: 'grow' },
                h('b', null, d.name),
                h('div', { class: 'xs muted' }, `${d.template_id} · ${fmtN(d.tasks)} عنصرًا`),
              ),
              h('a', { class: 'btn sm primary', href: `#/templates/draft/${d.id}?step=3` }, 'متابعة'),
              h(
                'button',
                {
                  class: 'btn sm danger',
                  onclick: async () => {
                    if (
                      await confirmDialog({
                        title: 'تجاهل المسودة؟',
                        text: 'تُحذف المسودة فقط؛ النموذج الأصلي لا يتأثر.',
                        ok: 'تجاهل المسودة',
                        danger: true,
                      })
                    ) {
                      await api.post(`/template-drafts/${d.id}/discard`);
                      go('#/templates');
                    }
                  },
                },
                'تجاهل',
              ),
            ),
          ),
        ),
      )
    : null;
  const el = h(
    'div',
    { class: 'stack' },
    breadcrumb([['المشاريع', '#/projects'], ['النماذج الجاهزة']]),
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', null, 'النماذج الجاهزة'),
        h(
          'div',
          { class: 'sub' },
          meta.loaded
            ? `${fmtN(meta.counts.official)} نموذجًا في ${fmtN(meta.sectors.length)} مجالًا. اختر نوع مشروعك ثم عدّل الخطة قبل إنشاء المشروع.`
            : 'لم يُحمَّل كتالوج النماذج',
        ),
      ),
      h('a', { class: 'btn', href: '#/projects?new=1&blank=1' }, 'مشروع فارغ بدل ذلك'),
    ),
    noticeEl(
      meta.note + ' استخدام النموذج ينشئ مسودة تخطيط فقط: لا موافقة ولا التزام ولا إسناد لموظفي جهة أخرى.',
      '',
      'info',
    ),
    draftsEl,
    h(
      'div',
      { class: 'card pad stack' },
      q,
      chips,
      spec,
      h(
        'div',
        { class: 'row tpl-filters', style: { flexWrap: 'wrap' } },
        tabsEl,
        h('div', { class: 'grow' }),
        days,
        sort,
        count,
      ),
    ),
    grid,
    more,
  );
  return { title: 'النماذج الجاهزة', el, after: redraw };
}

export async function useTemplate(id, go) {
  try {
    const r = await api.post('/template-drafts', { template_id: id });
    toast('أُنشئت مسودة الخطة — عدّلها ثم أنشئ المشروع', 'ok');
    go(`#/templates/draft/${r.draft.id}?step=3`);
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ============================================================ preview
async function previewView(id, ctx, go) {
  const [{ template: t }, meta] = await Promise.all([api.get(`/templates/${id}`), api.get('/templates/meta')]);
  const sc = t.schedule ? { ok: true, ...t.schedule } : null;
  const nameOf = new Map(t.tasks.map((x) => [x.id, x.name]));
  let tab = 'steps';
  const body = h('div');
  const steps = () =>
    h(
      'div',
      { class: 'stack' },
      t.phases.map((p) => {
        const ts = t.tasks.filter((x) => x.phase_id === p.id);
        return h(
          'details',
          { class: 'card pad tpl-phase', open: p.order === 1 ? true : null },
          h(
            'summary',
            null,
            h('b', null, `${fmtN(p.order)}. ${p.name}`),
            h(
              'span',
              { class: 'muted small' },
              ` — ${fmtN(ts.filter((x) => x.kind !== 'MILESTONE_GATE').length)} عناصر + بوابة`,
            ),
          ),
          h(
            'ul',
            { class: 'list' },
            ts.map((x) =>
              h(
                'li',
                { class: 'tpl-task' },
                h(
                  'div',
                  { class: 'row' },
                  h('b', { class: 'grow' }, x.name),
                  badge(KIND[x.kind][0], KIND[x.kind][1]),
                  x.kind !== 'MILESTONE_GATE'
                    ? h('span', { class: 'num small' }, `${fmtN(x.duration_workdays)} يوم`)
                    : null,
                ),
                h(
                  'div',
                  { class: 'xs muted' },
                  `المسؤول الوظيفي: ${x.responsible_role}`,
                  x.depends_on.length ? ` · بعد: ${x.depends_on.map((d) => nameOf.get(d)).join('، ')}` : '',
                ),
                h('div', { class: 'xs' }, `الأدلة: ${x.evidence_required.join('، ')}`),
              ),
            ),
          ),
        );
      }),
    );
  const views = {
    steps,
    timeline: () =>
      h(
        'div',
        { class: 'card pad stack' },
        h(
          'div',
          { class: 'small' },
          `المسار الحرج ${fmtN(sc.length)} يوم عمل، بينما مجموع أيام العناصر ${fmtN(sc.sequential)}؛ الفرق ناتج عن العمل المتوازي.`,
        ),
        gantt(t.tasks, sc, t.phases),
      ),
    orgs: () =>
      h(
        'div',
        { class: 'stack' },
        noticeEl(
          'الجهات والأدوار هنا اقتراحات غير ملزمة: لا تقبل جهة مشاركةً بمجرد ذكرها، وتُرفع الطلبات عبر اللجنة لتقرر الجهة المختصة بالقبول أو الاعتذار المسبَّب.',
          'warn',
          'shield',
        ),
        h(
          'div',
          { class: 'card pad' },
          h('h3', null, 'جهات مقترحة'),
          h(
            'ul',
            { class: 'list' },
            t.suggested_org_roles.map((r) => h('li', null, r.role_name_ar, ' ', badge('اقتراح فقط', 'neutral'))),
          ),
        ),
        h(
          'div',
          { class: 'card pad' },
          h('h3', null, 'أدوار داخلية'),
          h(
            'div',
            { class: 'row', style: { flexWrap: 'wrap', gap: '6px' } },
            t.suggested_internal_roles.map((r) => h('span', { class: 'chip' }, r)),
          ),
        ),
        h(
          'div',
          { class: 'card pad' },
          h('h3', null, 'طلبات مقترحة لجهات أخرى'),
          h(
            'ul',
            { class: 'list' },
            t.tasks
              .filter((x) => x.kind === 'INTERAGENCY_REQUEST_CANDIDATE')
              .map((x) =>
                h(
                  'li',
                  null,
                  h('b', null, x.name),
                  h('div', { class: 'xs muted' }, 'تتحول إلى مسودة طلب تنسيق عبر اللجنة، ولا تُنشئ مهمة لدى أي جهة.'),
                ),
              ),
          ),
        ),
      ),
    risks: () =>
      h(
        'div',
        { class: 'card pad' },
        h('h3', null, 'مخاطر أولية'),
        h(
          'ul',
          null,
          t.suggested_risks_ar.map((r) => h('li', null, r)),
        ),
      ),
  };
  const TABS = [
    ['steps', 'الخطوات'],
    ['timeline', 'الجدول الزمني'],
    ['orgs', 'الجهات المقترحة'],
    ['risks', 'المخاطر'],
  ];
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'أقسام المعاينة' });
  const draw = () => {
    mount(
      seg,
      TABS.map(([k, l]) =>
        h(
          'button',
          {
            'aria-pressed': String(tab === k),
            onclick: () => {
              tab = k;
              draw();
            },
          },
          l,
        ),
      ),
    );
    mount(body, views[tab]());
    requestAnimationFrame(() => applyBars(body));
  };
  draw();
  const fav = h(
    'button',
    {
      class: 'btn',
      'aria-pressed': String(t.favorite),
      onclick: async (e) => {
        const r = await api.post(`/templates/${id}/favorite`, { on: !t.favorite });
        t.favorite = r.favorite;
        e.currentTarget.setAttribute('aria-pressed', String(r.favorite));
        e.currentTarget.textContent = r.favorite ? '★ في المفضلة' : '☆ أضف للمفضلة';
      },
    },
    t.favorite ? '★ في المفضلة' : '☆ أضف للمفضلة',
  );
  const fork = h(
    'button',
    {
      class: 'btn',
      onclick: () =>
        formDialog({
          title: 'نسخ إلى نموذج جهتي',
          intro: 'تُنشأ نسخة خاصة بجهتك يمكن تعديلها؛ نموذج المكتبة يبقى كما هو.',
          fields: [{ name: 'name', label: 'اسم النسخة', value: `${t.name_ar} — نسخة جهتنا`, required: true }],
          submit: 'إنشاء النسخة',
          onSubmit: async (v) => {
            const r = await api.post(`/templates/${id}/fork`, v);
            toast('أُنشئت نسخة جهتك', 'ok');
            go(`#/templates/${r.template.id}`);
          },
        }),
    },
    'نسخ لجهتي',
  );
  const el = h(
    'div',
    { class: 'stack' },
    breadcrumb([['النماذج الجاهزة', '#/templates'], [t.sector_name_ar], [t.name_ar]]),
    h(
      'div',
      { class: 'card pad stack' },
      h(
        'div',
        { class: 'row', style: { flexWrap: 'wrap' } },
        h(
          'div',
          { class: 'grow' },
          h(
            'div',
            { class: 'small muted' },
            `${t.sector_name_ar} ← ${t.specialty_name_ar} · ${t.id} · الإصدار ${t.version}`,
          ),
          h('h1', null, t.name_ar),
          h('p', null, t.short_description_ar),
        ),
        h(
          'div',
          { class: 'row', style: { flexWrap: 'wrap' } },
          fav,
          fork,
          h(
            'button',
            {
              class: 'btn primary',
              disabled: meta.can_create_project ? null : true,
              title: meta.can_create_project ? null : 'إنشاء المشاريع لمنسّق الجهة القائدة',
              onclick: () => useTemplate(id, go),
            },
            'استخدام النموذج',
          ),
        ),
      ),
      h(
        'dl',
        { class: 'tpl-facts' },
        [
          ['المخرج', t.primary_deliverable_ar],
          ['المدة الاسترشادية', `${fmtN(t.estimated_total_workdays)} يوم عمل`],
          ['المراحل', fmtN(t.phase_count)],
          ['المهام والطلبات', fmtN(t.work_items)],
          ['بوابات التحقق', fmtN(t.gates)],
          ['التعقيد', t.complexity],
        ].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]),
      ),
      noticeEl(t.disclaimer + ' ' + (t.source || ''), 'warn', 'info'),
    ),
    seg,
    body,
  );
  return { title: t.name_ar, el };
}
