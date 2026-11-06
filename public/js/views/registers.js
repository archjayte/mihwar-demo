// Platform-level screens: decisions & permits, evidence register, executive overview.
import { api } from '../api.js';
import { h, icon, badge, fmtDate, fmtDT, emptyState, fmtSize } from '../ui.js';
import { section, noticeEl, colMenu, rowMenu } from '../shared.js';
import { downloadFile } from '../files.js';

const filterBar = (fields, query, base, go) => {
  const get = () => Object.fromEntries(fields.map((f) => [f.name, f.el.value]).filter(([, v]) => v));
  const apply = () => go(`#${base}?${new URLSearchParams(get()).toString()}`);
  return h(
    'form',
    {
      class: 'row filters',
      role: 'search',
      onsubmit: (e) => {
        e.preventDefault();
        apply();
      },
    },
    fields.map((f) => h('label', { class: 'field inline' }, h('span', { class: 'xs muted' }, f.label), f.el)),
    h('button', { class: 'btn sm primary', type: 'submit' }, 'تصفية'),
    h('a', { class: 'btn sm ghost', href: `#${base}` }, 'مسح'),
  );
};
const sel = (name, value, opts, label) => ({
  name,
  label,
  el: h(
    'select',
    { name, 'aria-label': label },
    h('option', { value: '' }, 'الكل'),
    opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) ? true : null }, l)),
  ),
});
const inp = (name, value, label, type = 'search') => ({
  name,
  label,
  el: h('input', { name, type, value: value || '', 'aria-label': label }),
});

export async function decisionsView({ query, go }) {
  const r = await api.get('/registers/decisions', query);
  const TYPE = {
    committee: 'قرارات اللجنة',
    org_decision: 'قرارات الجهات',
    permit: 'تصاريح البدء',
    baseline: 'خط الأساس',
  };
  const tone = { committee: 'info', org_decision: 'neutral', permit: 'success', baseline: 'attention' };
  const kp = h(
    'div',
    { class: 'grid c4 keep2' },
    Object.entries(TYPE).map(([k, l]) =>
      h(
        'a',
        { class: 'kpi', href: `#/decisions?type=${k}`, 'aria-label': `${l}: ${r.types[k] || 0}` },
        h('span', { class: 'v num' }, r.types[k] || 0),
        h('span', { class: 'l' }, l),
      ),
    ),
  );
  const fb = filterBar(
    [
      sel('type', query.type, Object.entries(TYPE), 'النوع'),
      sel(
        'project_id',
        query.project_id,
        r.projects.map((p) => [p.id, p.name]),
        'المشروع',
      ),
      inp('from', query.from, 'من', 'date'),
      inp('to', query.to, 'إلى', 'date'),
      inp('q', query.q, 'بحث'),
    ],
    query,
    '/decisions',
    go,
  );
  const rows = r.items.map((x) =>
    h(
      'tr',
      null,
      h('td', null, badge(x.type_label, tone[x.type] || 'neutral')),
      h('td', null, h('a', { href: x.link }, h('b', null, x.ref || '—')), h('div', { class: 'small' }, x.title)),
      h('td', { class: 'small' }, x.project_name),
      h('td', { class: 'small' }, x.outcome || '—'),
      h('td', { class: 'small' }, [x.by_name, x.org_name].filter(Boolean).join(' — ')),
      h('td', { class: 'small muted' }, x.basis || '—'),
      h('td', { class: 'small num' }, fmtDT(x.at)),
      h(
        'td',
        null,
        rowMenu([
          [
            'فتح السجل الأصلي',
            () => {
              location.hash = x.link;
            },
          ],
          ['نسخ المرجع', () => navigator.clipboard?.writeText(x.ref || '')],
          ['تصفية بهذا المشروع', () => go(`#/decisions?project_id=${x.project_id}`)],
        ]),
      ),
    ),
  );
  const dtable = h(
    'table',
    { class: 'tbl' },
    h(
      'thead',
      null,
      h('tr', null, [
        ...['النوع', 'المرجع', 'المشروع', 'النتيجة', 'صدر عن', 'السند', 'الوقت'].map((x) => h('th', null, x)),
        h('th', { 'aria-label': 'إجراءات' }),
      ]),
    ),
    h('tbody', null, rows),
  );
  const dcols = colMenu(dtable, 'decisions', ['النوع', 'المرجع', 'المشروع', 'النتيجة', 'صدر عن', 'السند', 'الوقت']);
  return {
    title: 'القرارات والتصاريح',
    el: h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'page-head' },
        h(
          'div',
          { class: 'page-head-main' },
          h('h1', null, 'القرارات والتصاريح'),
          h(
            'div',
            { class: 'sub' },
            'سجل واحد لقرارات اللجان والجهات وتصاريح بدء حزم العمل وتغييرات خط الأساس، كلٌّ بسنده',
          ),
        ),
      ),
      r.items.length || r.total ? kp : null,
      fb,
      noticeEl(r.note, '', 'info'),
      r.items.length
        ? h(
            'div',
            { class: 'card scroll-x' },
            h('div', { class: 'row', style: { padding: '8px 12px' } }, h('div', { class: 'grow' }), dcols),
            dtable,
            h(
              'div',
              { class: 'xs muted', style: { padding: '8px 12px' } },
              `${r.total} سجل${r.total > r.items.length ? ` (عُرض ${r.items.length})` : ''}`,
            ),
          )
        : h(
            'div',
            { class: 'card' },
            emptyState('لا سجلات مطابقة', 'غيّر المرشحات أو وسّع النطاق الزمني.', null, 'empty-results'),
          ),
    ),
  };
}

export async function evidenceView({ query, go }) {
  const r = await api.get('/registers/evidence', query);
  const fb = filterBar(
    [
      sel(
        'source',
        query.source,
        [
          ['wp', 'حزم العمل'],
          ['request', 'الطلبات'],
        ],
        'المصدر',
      ),
      sel(
        'project_id',
        query.project_id,
        r.projects.map((p) => [p.id, p.name]),
        'المشروع',
      ),
      inp('from', query.from, 'من', 'date'),
      inp('to', query.to, 'إلى', 'date'),
      inp('q', query.q, 'بحث (عنوان، ملف، بصمة)'),
    ],
    query,
    '/evidence',
    go,
  );
  const kp = r.counts
    ? h(
        'div',
        { class: 'grid c4 keep2' },
        [
          ['دليل على حزم العمل', r.counts.wp],
          ['دليل على الطلبات', r.counts.request],
          ['ملفات مرفوعة فعلًا', r.counts.files],
          ['متاحة لك للتنزيل', r.counts.downloadable],
        ].map(([l, v]) => h('div', { class: 'kpi' }, h('span', { class: 'v num' }, v), h('span', { class: 'l' }, l))),
      )
    : null;
  const rows = r.items.map((x) =>
    h(
      'tr',
      null,
      h(
        'td',
        null,
        h('b', null, x.title),
        x.file_name
          ? h(
              'div',
              { class: 'xs muted', dir: 'ltr', style: { textAlign: 'start' } },
              `${x.file_name}${x.size ? ' · ' + fmtSize(x.size) : ''}${x.version ? ' · v' + x.version : ''}`,
            )
          : h('div', { class: 'xs muted' }, 'سجل بيانات فقط'),
      ),
      h(
        'td',
        null,
        badge(x.source_label, x.source === 'wp' ? 'info' : 'neutral'),
        h('div', null, h('a', { href: x.link }, x.object_ref)),
        h('div', { class: 'xs muted' }, x.object_title),
      ),
      h('td', { class: 'small' }, x.project_name, h('div', { class: 'xs muted' }, x.org_name)),
      h('td', { class: 'small' }, x.status || '—'),
      h(
        'td',
        { class: 'xs muted num', dir: 'ltr', title: x.sha256 || '' },
        x.sha256 ? x.sha256.slice(0, 12) + '…' : '—',
      ),
      h('td', { class: 'small' }, x.by_name, h('div', { class: 'xs muted num' }, fmtDate(x.at))),
      h(
        'td',
        null,
        x.file_id
          ? x.can_download
            ? h(
                'button',
                { class: 'btn sm', onclick: () => downloadFile({ id: x.file_id, name: x.file_name }) },
                icon('doc', 14),
                'تنزيل',
              )
            : h('span', { class: 'xs muted' }, 'بلا منحة اطلاع')
          : null,
      ),
      h(
        'td',
        null,
        rowMenu([
          [
            'فتح الحزمة أو الطلب',
            () => {
              location.hash = x.link;
            },
          ],
          ...(x.sha256 ? [['نسخ البصمة SHA-256', () => navigator.clipboard?.writeText(x.sha256)]] : []),
          ['تصفية بهذا المشروع', () => go(`#/evidence?project_id=${x.project_id}`)],
        ]),
      ),
    ),
  );
  const etable = h(
    'table',
    { class: 'tbl' },
    h(
      'thead',
      null,
      h('tr', null, [
        ...['الدليل', 'مرتبط بـ', 'المشروع', 'الحالة', 'البصمة SHA-256', 'أرفقه', 'تنزيل'].map((x) => h('th', null, x)),
        h('th', { 'aria-label': 'إجراءات' }),
      ]),
    ),
    h('tbody', null, rows),
  );
  const ecols = colMenu(etable, 'evidence', [
    'الدليل',
    'مرتبط بـ',
    'المشروع',
    'الحالة',
    'البصمة SHA-256',
    'أرفقه',
    'تنزيل',
  ]);
  return {
    title: 'الأدلة',
    el: h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'page-head' },
        h(
          'div',
          { class: 'page-head-main' },
          h('h1', null, 'الأدلة'),
          h(
            'div',
            { class: 'sub' },
            'كل دليل أُرفق بحزمة عمل أو طلب، ببصمته وصاحبه، دون أن يمنح ظهوره في الجدول حق تنزيله',
          ),
        ),
      ),
      kp,
      fb,
      noticeEl(r.note, '', 'shield'),
      r.items.length
        ? h(
            'div',
            { class: 'card scroll-x' },
            h('div', { class: 'row', style: { padding: '8px 12px' } }, h('div', { class: 'grow' }), ecols),
            etable,
            h('div', { class: 'xs muted', style: { padding: '8px 12px' } }, `${r.total} دليل`),
          )
        : h(
            'div',
            { class: 'card' },
            emptyState(
              r.total === 0 && !query.q ? 'لا أدلة ظاهرة لك' : 'لا نتائج مطابقة',
              'تظهر الأدلة بعد إرفاقها بحزمة عمل أو بطلب في نطاق رؤيتك.',
              null,
              'empty-results',
            ),
          ),
    ),
  };
}

export async function overviewView() {
  const r = await api.get('/overview');
  const HEALTH = { green: ['سليم', 'success'], amber: ['يحتاج متابعة', 'attention'], red: ['متعثر', 'danger'] };
  const bar = (v, cls = '') =>
    h('div', { class: `bar ${cls}`, role: 'img', 'aria-label': `${v}٪` }, h('i', { style: { width: `${v}%` } }));
  const k = r.kpi;
  const kpis = h(
    'div',
    { class: 'grid c4 keep2' },
    [
      ['المشاريع الجارية', k.projects],
      ['متعثرة', k.red],
      ['تحتاج متابعة', k.amber],
      ['طلبات مفتوحة', k.open_requests],
      ['ردود متأخرة', k.overdue_requests],
      ['عوائق معطِّلة', k.blockers],
      ['حزم متأخرة', k.late_wps],
    ].map(([l, v]) => h('div', { class: 'kpi' }, h('span', { class: 'v num' }, v), h('span', { class: 'l' }, l))),
  );
  const projects = r.projects.map((p) =>
    h(
      'tr',
      null,
      h(
        'td',
        null,
        h('a', { href: p.link }, h('b', null, p.name)),
        h(
          'div',
          { class: 'xs muted' },
          p.baseline_version ? `خط الأساس v${p.baseline_version}` : 'خط الأساس غير معتمد',
        ),
      ),
      h('td', null, badge(HEALTH[p.health][0], HEALTH[p.health][1])),
      h(
        'td',
        { style: { minWidth: '150px' } },
        h('div', { class: 'xs' }, `المعتمد ${p.approved_pct}٪`),
        bar(p.approved_pct),
        h('div', { class: 'xs muted' }, `التقدم التشغيلي ${p.operational_pct}٪ (منفصل عن المعتمد)`),
      ),
      h('td', { class: 'num' }, p.wp_count),
      h('td', { class: 'num' }, p.late_wps),
      h('td', { class: 'num' }, p.open_requests),
      h('td', { class: 'num' }, p.overdue_requests),
      h('td', { class: 'num' }, p.blockers),
    ),
  );
  return {
    title: 'النظرة التنفيذية',
    el: h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'page-head' },
        h(
          'div',
          { class: 'page-head-main' },
          h('h1', null, 'النظرة التنفيذية'),
          h('div', { class: 'sub' }, 'صحة المحفظة، وما ينتظر قرارًا، وما يوشك على الانتهاء'),
        ),
      ),
      noticeEl(r.note, '', 'info'),
      kpis,
      section(
        'المحفظة',
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
                ['المشروع', 'الصحة', 'الإنجاز', 'حزم', 'متأخرة', 'طلبات', 'ردود متأخرة', 'عوائق'].map((x) =>
                  h('th', null, x),
                ),
              ),
            ),
            h('tbody', null, projects),
          ),
        ),
      ),
      h(
        'div',
        { class: 'grid c2' },
        section(
          'ما ينتظر قرارًا',
          r.waiting.length
            ? h(
                'ul',
                { class: 'list' },
                r.waiting.map((w) =>
                  h(
                    'li',
                    null,
                    h(
                      'div',
                      { class: 'grow' },
                      h('a', { href: w.link }, h('b', null, w.ref)),
                      h('div', { class: 'small' }, w.title),
                      h('div', { class: 'xs muted' }, `${w.status_ar} — عند: ${w.ball}`),
                    ),
                    w.due
                      ? badge(
                          `الرد قبل ${fmtDate(w.due)}`,
                          w.due < new Date().toISOString().slice(0, 10) ? 'danger' : 'neutral',
                        )
                      : null,
                  ),
                ),
              )
            : emptyState('لا طلبات تنتظر قرارًا'),
        ),
        section(
          'الطلبات المفتوحة بحسب المرحلة',
          Object.keys(r.stages).length
            ? h(
                'ul',
                { class: 'list' },
                Object.entries(r.stages).map(([s, n]) =>
                  h('li', null, h('span', { class: 'grow' }, s), h('b', { class: 'num' }, n)),
                ),
              )
            : emptyState('لا طلبات مفتوحة'),
        ),
      ),
      r.expiring_delegations.length
        ? section(
            'تفويضات تنتهي خلال 30 يومًا',
            h(
              'ul',
              { class: 'list' },
              r.expiring_delegations.map((d) =>
                h(
                  'li',
                  null,
                  h(
                    'span',
                    { class: 'grow' },
                    `${d.user_name} — ${d.action_label}`,
                    h('div', { class: 'xs muted' }, d.org_name),
                  ),
                  badge(`حتى ${fmtDate(d.valid_to)}`, 'attention'),
                ),
              ),
            ),
          )
        : null,
    ),
  };
}
