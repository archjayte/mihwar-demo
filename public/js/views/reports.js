import { api } from '../api.js';
import { h, icon, badge, fmtDT, progressBar, emptyState, drawer } from '../ui.js';
import { section } from '../shared.js';

export async function reportsView({ query, go }) {
  const projects = await api.get('/projects');
  const pid = query.project || '';
  const r = await api.get('/reports', { project_id: pid });
  const sel = h(
    'select',
    {
      'aria-label': 'المشروع',
      style: { width: 'auto' },
      onchange: (e) => go(`#/reports${e.target.value ? '?project=' + e.target.value : ''}`),
    },
    h('option', { value: '' }, 'كل مشاريعي'),
    projects.items.map((p) => h('option', { value: p.id, selected: p.id === pid ? true : null }, p.name)),
  );
  const kpis = h(
    'div',
    { class: 'grid c4 keep2' },
    r.kpis.map((k) =>
      h(
        'div',
        { class: 'kpi' },
        h(
          'span',
          { class: 'v num' },
          k.value == null ? '—' : k.value,
          k.value != null && k.unit ? h('span', { class: 'small muted' }, ` ${k.unit}`) : null,
        ),
        h('span', { class: 'l' }, k.label),
        h('span', { class: 'h' }, k.hint),
        h('span', { class: 'xs muted' }, `المصدر: ${k.source}`),
      ),
    ),
  );
  const drill = (k) => {
    let d;
    d = drawer({
      title: `${k.label} (${k.value}${k.unit || ''})`,
      sub: `${k.label_en} — المصدر: ${k.source}`,
      body: k.records.length
        ? h(
            'ul',
            { class: 'list' },
            k.records.map((x) =>
              h(
                'li',
                null,
                h('a', { class: 'grow', href: x.link, onclick: () => d.close() }, h('b', null, x.ref), ' — ', x.title),
                badge(x.status_ar, 'neutral'),
              ),
            ),
          )
        : h('div', { class: 'small muted' }, 'لا سجلات ضمن ما يحق لك الاطلاع عليه.'),
      footer: h('span', { class: 'xs muted' }, `آخر تحديث ${fmtDT(k.updated_at)} · يعرض السجلات المصرّح لك بها فقط`),
    });
  };
  const pk = section(
    'مؤشرات المشروع (اضغط الرقم لفتح السجلات المصدر)',
    h(
      'div',
      { class: 'grid c4 keep2' },
      r.project_kpis.map((k) =>
        h(
          'button',
          { class: 'kpi link', onclick: () => drill(k), 'aria-label': `${k.label}: ${k.value}. افتح السجلات المصدر` },
          h('span', { class: 'v num' }, k.value, k.unit ? h('span', { class: 'small muted' }, k.unit) : null),
          h('span', { class: 'l' }, k.label),
          h('span', { class: 'xs muted' }, k.label_en),
        ),
      ),
    ),
    h(
      'div',
      { class: 'xs muted', style: { marginBlockStart: '8px' } },
      `آخر تحديث للأرقام: ${fmtDT(r.generated_at)} — الإنجاز المعتمد = مجموع أوزان المخرجات المقبولة، لا متوسط التصريحات الذاتية.`,
    ),
  );
  const ds = r.delay_split;
  const fair = section(
    'فصل أنواع التأخير (إنصاف)',
    h(
      'div',
      { class: 'grid c4 keep2' },
      [
        ['تأخر التوجيه (اللجنة)', ds.routing, 'ساعة'],
        ['تأخر رد الجهة', ds.org_response, 'ساعة'],
        ['تأخر التنفيذ القابل للمساءلة', ds.execution_days, 'يوم'],
        ['تأخر عائق خارجي معتمد', ds.external_days, 'يوم'],
      ].map(([l, v, u]) =>
        h(
          'div',
          { class: 'kpi' },
          h(
            'span',
            { class: 'v num' },
            v == null ? '—' : v,
            v != null ? h('span', { class: 'small muted' }, ` ${u}`) : null,
          ),
          h('span', { class: 'l' }, l),
        ),
      ),
    ),
    h(
      'p',
      { class: 'xs muted' },
      'تُحسب الأنواع الأربعة منفصلة؛ فتأخر التوجيه لا يُحمَّل على الجهة المنفذة، والعائق الخارجي لا يُخصم إلا بدليل واعتماد. ارتفاع الاعتذارات لا يعني ضعف الأداء وفق سبب كل اعتذار.',
    ),
  );
  const rl = r.routing_log?.length
    ? section(
        'سجل التوجيه والرد',
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
                ['الطلب', 'وقت التوجيه', 'من وجّه', 'الجهة', 'من استلم', 'من ردّ', 'القرار', 'الحالة الآن'].map((x) =>
                  h('th', null, x),
                ),
              ),
            ),
            h(
              'tbody',
              null,
              r.routing_log.map((x) =>
                h(
                  'tr',
                  { class: x.superseded ? 'muted' : '' },
                  h(
                    'td',
                    null,
                    h('a', { href: `#/requests/${x.request_id}` }, x.ref),
                    h('div', { class: 'xs muted' }, x.title),
                  ),
                  h('td', null, fmtDT(x.routed_at)),
                  h('td', null, x.routed_by),
                  h('td', null, x.target_org, x.superseded ? h('div', { class: 'xs muted' }, '(أُعيد توجيهه)') : null),
                  h('td', null, x.received_by ? `${x.received_by} · ${fmtDT(x.received_at)}` : '—'),
                  h('td', null, x.answered_by ? `${x.answered_by} · ${fmtDT(x.answered_at)}` : '—'),
                  h('td', null, x.decision),
                  h('td', null, x.status_now),
                ),
              ),
            ),
          ),
        ),
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
        h('h1', null, 'التقارير'),
        h(
          'div',
          { class: 'sub' },
          `${r.scope} · أُنشئ ${fmtDT(r.generated_at)} — كل رقم محسوب من سجلات مصرّح لك برؤيتها.`,
        ),
      ),
      sel,
      h('button', { class: 'btn', onclick: () => window.print() }, icon('print', 16), 'طباعة'),
    ),
    pk,
    kpis,
    fair,
    section(
      'الإنجاز: المعتمد مقابل التشغيلي',
      r.progress.length
        ? h(
            'div',
            { class: 'col', style: { gap: '18px' } },
            h(
              'div',
              { class: 'legend' },
              h('span', null, h('i', { style: { background: 'var(--brand)' } }), 'معتمد = أوزان الحزم المقبولة فقط'),
              h(
                'span',
                null,
                h('i', { style: { background: 'color-mix(in srgb, var(--brand) 32%, transparent)' } }),
                'تشغيلي = تقدير الجهات الذاتي',
              ),
            ),
            r.progress.map(progressBlock),
          )
        : emptyState('لا بيانات'),
    ),
    r.delays.length
      ? section(
          'التأخر المحتسب على الجهات',
          h(
            'div',
            { class: 'col' },
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
                    ['الحزمة', 'الجهة', 'الحالة', 'التأخر الفعلي', 'استثناء خارجي معتمد', 'المحتسب'].map((x) =>
                      h('th', null, x),
                    ),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  r.delays.map((d) =>
                    h(
                      'tr',
                      null,
                      h('td', null, `${d.ref} — ${d.title}`),
                      h('td', null, d.org),
                      h('td', null, d.status_ar),
                      h('td', null, `${d.actual} يوم`),
                      h('td', null, `${d.external_approved} يوم`),
                      h('td', null, badge(`${d.accountable} يوم`, d.accountable ? 'danger' : 'success')),
                    ),
                  ),
                ),
              ),
            ),
            h('p', { class: 'xs muted' }, r.delay_note),
          ),
        )
      : null,
    h(
      'div',
      { class: 'grid c2' },
      section(
        'الطلبات حسب الحالة',
        r.by_status.length
          ? h(
              'div',
              null,
              r.by_status.map((s) =>
                h(
                  'div',
                  { class: 'bar-h' },
                  h('span', null, s.label),
                  progressBar(0, r.requests_total ? (s.count / r.requests_total) * 100 : 0, true),
                  h('b', { class: 'num' }, s.count),
                ),
              ),
            )
          : h('div', { class: 'small muted' }, 'لا طلبات'),
      ),
      section(
        'أسباب الاعتذار',
        r.decline_reasons.length
          ? h(
              'div',
              null,
              r.decline_reasons.map((s) =>
                h(
                  'div',
                  { class: 'bar-h' },
                  h('span', null, s.label),
                  progressBar(0, Math.min(100, s.count * 25), true),
                  h('b', { class: 'num' }, s.count),
                ),
              ),
              h('p', { class: 'xs muted' }, r.decline_note),
            )
          : h('div', { class: 'small muted' }, 'لا اعتذارات مسجلة'),
      ),
    ),
    r.orgs?.length
      ? section(
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
                  Object.keys(r.orgs[0])
                    .filter((k) => !['id', 'org_id'].includes(k))
                    .map((k) => h('th', null, ORG_COL[k] || k)),
                ),
              ),
              h(
                'tbody',
                null,
                r.orgs.map((o) =>
                  h(
                    'tr',
                    null,
                    Object.entries(o)
                      .filter(([k]) => !['id', 'org_id'].includes(k))
                      .map(([, v]) => h('td', null, v == null ? '—' : String(v))),
                  ),
                ),
              ),
            ),
            h(
              'p',
              { class: 'xs muted' },
              'مؤشرات وصفية للمتابعة، وليست تقييمًا لأداء الجهات؛ عبء الفريق والمهام المفتوحة تظهر لجهتك فقط.',
            ),
          ),
        )
      : null,
    rl,
    h('p', { class: 'credit' }, 'إعداد وتصميم: د.م. جراح جمال الطير'),
  );
  return { title: 'التقارير', el };
}
const ORG_COL = {
  org_name: 'الجهة',
  received: 'واردة',
  outgoing: 'صادرة',
  accepted: 'مقبولة',
  declined: 'اعتذارات',
  counter: 'مقترحات بديلة',
  need_info: 'طلبات استكمال',
  pending: 'قيد الدراسة',
  avg_hours: 'متوسط الرد الأول (ساعة)',
  overdue_now: 'متجاوزة المدة الآن',
  completion_pct: 'نسبة الالتزامات المنجزة ٪',
  active_commitments: 'التزامات سارية',
  open_tasks: 'مهام مفتوحة',
  team_load_hours: 'عبء الفريق (ساعة)',
  accountable_delay_days: 'تأخر قابل للمساءلة (يوم)',
  deliverables_submitted: 'مخرجات مرفوعة',
  deliverables_accepted: 'مخرجات معتمدة',
  decline_reasons: 'أسباب الاعتذار',
};

function progressBlock(p) {
  const rows = p.wp.map((w) =>
    h(
      'tr',
      null,
      h('td', null, `${w.ref} — ${w.title}`),
      h('td', null, w.org),
      h('td', null, badge(w.status_ar, w.tone)),
      h('td', { class: 'num' }, `وزن ${w.weight}%`),
    ),
  );
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'row nowrap' },
      h('b', { class: 'grow' }, p.name),
      h('span', { class: 'small' }, `معتمد ${p.verified}% · تشغيلي ${p.operational}%`),
    ),
    h('div', { style: { marginBlock: '6px 10px' } }, progressBar(p.verified, p.operational)),
    h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('tbody', null, rows))),
  );
}
