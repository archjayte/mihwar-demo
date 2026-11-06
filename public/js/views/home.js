import { api } from '../api.js';
import { h, mount, icon, toast, badge, fmtDate, ago, modal, emptyState, progressBar, avatar } from '../ui.js';
import { section } from '../shared.js';
import { chartCard, donut, hbars, columns, lines, legend, applyWidths } from '../charts.js';

const TITLES = {
  charts: 'الرسوم البيانية',
  action_center: 'ما ينتظرني الآن',
  my_tasks: 'مهامي القريبة',
  pipeline: 'مسار الطلبات',
  projects: 'المشاريع',
  workload: 'حمل الفريق',
  upcoming: 'المواعيد القادمة',
  activity: 'آخر النشاط',
  sla: 'زمن استجابة الجهات',
  decline: 'أسباب الاعتذار',
  mini_gantt: 'مخطط زمني مصغّر',
  delays: 'التأخيرات',
  blockers: 'المعوّقات المفتوحة',
  deliverables: 'أداء المخرجات',
  meetings: 'القرارات والمحاضر',
  comments: 'آخر التعليقات',
};
const SIDE = ['pipeline', 'upcoming', 'sla', 'decline', 'blockers', 'meetings', 'comments'];
const SIZE_AR = { sm: 'صغير', md: 'متوسط', lg: 'كبير' };
const orderOf = (d) => {
  const known = d.catalog || d.order;
  const saved = (d.prefs?.order || []).filter((k) => known.includes(k));
  const rest = [...d.order, ...known].filter((k, i, a) => a.indexOf(k) === i && !saved.includes(k));
  return [...saved, ...rest].filter((k) => k !== 'kpis');
};
const defaultHidden = (d) => (d.catalog || []).filter((k) => !d.order.includes(k));

export async function homeView({ ctx, refresh, go }) {
  const d = await api.get('/dashboard');
  const me = ctx.me;
  if (d.widgets.platform) return { title: 'الرئيسية', el: platformHome(d, me) };
  const hidden = d.prefs ? d.prefs.hidden || [] : defaultHidden(d);
  const sizes = d.prefs?.sizes || {};
  const R = {
    charts: (c) => {
      const cards = [];
      const wp = c.wp_status.filter((x) => x.count);
      const wpTot = c.wp_status.reduce((a, b) => a + b.count, 0);
      if (wpTot)
        cards.push(
          chartCard({
            title: 'حزم العمل حسب الحالة',
            summary: `حزم العمل ${wpTot}: ` + wp.map((x) => `${x.label} ${x.count}`).join('، '),
            figure: h('div', { class: 'ch-donut' }, donut(c.wp_status, { centre: 'حزمة' })),
            legend: legend(
              c.wp_status.filter((x) => x.count).map((x) => ({ tone: x.tone, label: x.label, value: x.count })),
            ),
            table: { head: ['الحالة', 'العدد'], rows: c.wp_status.map((x) => [x.label, x.count]) },
          }),
        );
      const tkTot = c.tasks_status.reduce((a, b) => a + b.count, 0);
      if (tkTot)
        cards.push(
          chartCard({
            title: 'المهام حسب الحالة',
            caption: 'مهام جهتك أو المسندة إليك',
            summary:
              `المهام ${tkTot}: ` +
              c.tasks_status
                .filter((x) => x.count)
                .map((x) => `${x.label} ${x.count}`)
                .join('، '),
            figure: hbars(c.tasks_status.map((x) => ({ label: x.label, value: x.count, tone: x.tone }))),
            table: { head: ['الحالة', 'العدد'], rows: c.tasks_status.map((x) => [x.label, x.count]) },
          }),
        );
      const pl = c.pipeline;
      const plTot = pl.reduce((a, b) => a + b.count, 0);
      if (plTot)
        cards.push(
          chartCard({
            title: 'الطلبات بين الجهات حسب المرحلة',
            summary:
              `الطلبات المفتوحة ${plTot}: ` +
              pl
                .filter((x) => x.count)
                .map((x) => `${x.label} ${x.count}`)
                .join('، '),
            figure: hbars(pl.map((x) => ({ label: x.label, value: x.count, tone: x.count ? 'info' : 'neutral' }))),
            table: { head: ['المرحلة', 'العدد'], rows: pl.map((x) => [x.label, x.count]) },
          }),
        );
      const dw = c.due_weeks;
      const dwTot = dw.reduce((a, b) => a + b.wp + b.tasks + b.requests, 0);
      if (dwTot) {
        const lab = (i) => (i === 0 ? 'الآن' : String(i));
        cards.push(
          chartCard({
            title: 'الاستحقاقات خلال ٨ أسابيع',
            caption: 'الأرقام = أسابيع من اليوم؛ «الآن» يشمل المتأخر',
            summary: `استحقاقات ${dwTot} خلال ثمانية أسابيع`,
            figure: columns(
              dw.map((x, i) => ({
                label: lab(i),
                parts: [
                  { value: x.wp, cls: 'ch-info', label: 'حزم' },
                  { value: x.tasks, cls: 'ch-progress', label: 'مهام' },
                  { value: x.requests, cls: 'ch-attention', label: 'طلبات' },
                ],
              })),
            ),
            legend: legend([
              { tone: 'info', label: 'حزم' },
              { tone: 'progress', label: 'مهام' },
              { tone: 'attention', label: 'طلبات' },
            ]),
            table: {
              head: ['الأسبوع', 'حزم', 'مهام', 'طلبات'],
              rows: dw.map((x, i) => [`${fmtDate(x.from)} – ${fmtDate(x.to)}`, x.wp, x.tasks, x.requests]),
            },
          }),
        );
      }
      const dl = c.delay_org.filter((x) => x.days > 0);
      if (dl.length)
        cards.push(
          chartCard({
            title: 'التأخير المحتسب حسب الجهة',
            caption: 'بالأيام، بعد خصم العوائق الخارجية المعتمدة',
            summary: 'التأخير المحتسب: ' + dl.map((x) => `${x.org} ${x.days} يومًا`).join('، '),
            figure: hbars(
              dl.map((x) => ({ label: x.org, value: x.days, tone: 'danger', note: `${x.late} من ${x.open} حزمة` })),
              {},
            ),
            table: {
              head: ['الجهة', 'أيام التأخير', 'حزم متأخرة', 'حزم مفتوحة'],
              rows: dl.map((x) => [x.org, x.days, x.late, x.open]),
            },
          }),
        );
      if (c.scurve.length) {
        const holder = h('div');
        let cur = c.scurve[0];
        const draw = () => {
          holder.replaceChildren(
            h('div', { class: 'ch-fig' }, lines(cur.points, { today: cur.today })),
            legend([
              { cls: 'ln-plan', label: 'المخطّط (خط الأساس)' },
              { cls: 'ln-acc', label: 'المقبول فعليًا' },
            ]),
            h(
              'details',
              { class: 'ch-table' },
              h('summary', null, 'عرض كجدول'),
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
                      ['الشهر', 'المخطّط ٪', 'المقبول ٪'].map((x) => h('th', { scope: 'col' }, x)),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    cur.points.map((p) =>
                      h(
                        'tr',
                        null,
                        h('th', { scope: 'row' }, p.at.slice(0, 7)),
                        h('td', { class: 'num' }, p.planned),
                        h('td', { class: 'num' }, p.accepted == null ? '—' : p.accepted),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          );
          holder
            .querySelector('svg')
            .setAttribute(
              'aria-label',
              `منحنى التقدّم التراكمي لمشروع ${cur.name}: المخطّط ${cur.points.at(-1).planned}٪ عند النهاية`,
            );
        };
        const sel =
          c.scurve.length > 1
            ? h(
                'select',
                {
                  'aria-label': 'المشروع',
                  onchange: (e) => {
                    cur = c.scurve.find((x) => x.id === e.target.value);
                    draw();
                    applyWidths(holder);
                  },
                },
                c.scurve.map((x) => h('option', { value: x.id }, x.name)),
              )
            : null;
        draw();
        const card = h(
          'figure',
          { class: 'card ch-card wide', 'aria-label': 'منحنى التقدّم' },
          h(
            'figcaption',
            { class: 'ch-h' },
            h('h2', null, 'منحنى التقدّم: المخطّط مقابل المقبول'),
            h('div', { class: 'xs muted' }, 'النسبة المقبولة بالأوزان والأدلة فقط، وليست تقديرًا تشغيليًا'),
            sel,
          ),
          holder,
        );
        cards.push(card);
      }
      if (!cards.length) return null;
      const grid = h('div', { class: 'ch-grid' }, cards);
      queueMicrotask(() => applyWidths(grid));
      return grid;
    },
    action_center: (w) =>
      section(
        TITLES.action_center,
        w.items.length
          ? h(
              'div',
              { class: 'actions-list', style: { margin: '-16px' } },
              w.items.map((a) =>
                h(
                  'a',
                  {
                    class: `act${a.urgency === 'high' ? ' high' : ''}`,
                    href: a.link,
                    style: { color: 'inherit', textDecoration: 'none' },
                  },
                  h(
                    'span',
                    { class: 'ic' },
                    icon(
                      a.icon === 'inbox'
                        ? 'inbox'
                        : a.icon === 'check'
                          ? 'check'
                          : a.icon === 'flag'
                            ? 'flag'
                            : a.icon === 'task'
                              ? 'task'
                              : 'alert',
                      20,
                    ),
                  ),
                  h(
                    'div',
                    { class: 'grow' },
                    h('div', { class: 't' }, a.title),
                    h('div', { class: 's' }, `${a.sub}${a.project ? ' · ' + a.project : ''}`),
                  ),
                  h('span', { class: 'btn sm primary' }, a.cta),
                ),
              ),
            )
          : h(
              'div',
              { class: 'empty' },
              h('b', null, 'لا شيء ينتظرك'),
              'عندما تصبح الكرة عندك في طلب أو مراجعة أو تصريح سيظهر هنا بإجراء واحد واضح.',
            ),
        w.total > w.items.length ? h('span', { class: 'badge t-attention' }, `${w.total} إجراء`) : null,
      ),
    pipeline: (w) =>
      section(
        TITLES.pipeline,
        h(
          'div',
          { class: 'pipeline', style: { margin: '-16px -10px' } },
          w.map((s) =>
            h(
              'div',
              null,
              h('div', { class: `n num${s.count ? ' hot' : ''}` }, s.count),
              h('div', { class: 'l' }, s.label),
            ),
          ),
        ),
        h('a', { href: '#/requests', class: 'small' }, 'عرض الطلبات'),
      ),
    projects: (w) =>
      section(
        TITLES.projects,
        w.length
          ? h(
              'div',
              { class: 'col', style: { gap: '14px' } },
              w.map((p) =>
                h(
                  'a',
                  { href: `#/p/${p.id}/overview`, style: { color: 'inherit', textDecoration: 'none' } },
                  h(
                    'div',
                    { class: 'row nowrap' },
                    h('b', { class: 'grow' }, p.name),
                    p.delayed ? badge(`${p.delayed} متأخرة`, 'danger') : null,
                    p.awaiting ? badge(`${p.awaiting} تنتظر`, 'attention') : null,
                  ),
                  h('div', { style: { marginBlock: '6px' } }, progressBar(p.progress.verified, p.progress.operational)),
                  h(
                    'div',
                    { class: 'xs muted' },
                    `معتمد ${p.progress.verified}% · تشغيلي ${p.progress.operational}% · ينتهي ${fmtDate(p.end)}`,
                  ),
                ),
              ),
            )
          : emptyState('لا مشاريع'),
        h('a', { href: '#/projects', class: 'small' }, 'كل المشاريع'),
      ),
    my_tasks: (w) =>
      w.length
        ? section(
            TITLES.my_tasks,
            h(
              'ul',
              { class: 'list', style: { margin: '-16px' } },
              w
                .slice(0, 6)
                .map((t) =>
                  h(
                    'li',
                    { class: 'click', onclick: () => go(`#/tasks?task=${t.id}`) },
                    h(
                      'div',
                      { class: 'grow' },
                      h('div', null, t.title),
                      h('div', { class: 'xs muted' }, `${t.project} · حتى ${fmtDate(t.end)}`),
                    ),
                    t.overdue ? badge('متأخرة', 'danger') : badge(t.status_ar, t.tone),
                  ),
                ),
            ),
          )
        : null,
    workload: (w) =>
      w.length
        ? section(
            TITLES.workload,
            h(
              'div',
              { class: 'col' },
              w.map((p) =>
                h(
                  'div',
                  { class: 'row nowrap' },
                  avatar(p.name, true),
                  h(
                    'div',
                    { class: 'grow' },
                    p.name,
                    h('div', { class: 'xs muted' }, `${p.open} مفتوحة · ${p.hours} ساعة`),
                  ),
                  p.overdue ? badge(`${p.overdue} متأخرة`, 'danger') : badge('منتظم', 'success'),
                ),
              ),
            ),
          )
        : null,
    upcoming: (w) =>
      section(
        TITLES.upcoming,
        w.length
          ? h(
              'ul',
              { class: 'list', style: { margin: '-16px' } },
              w.map((u) =>
                h(
                  'li',
                  { class: 'click', onclick: () => go(u.link) },
                  h(
                    'div',
                    { class: 'grow' },
                    h('div', { class: 'small' }, u.title),
                    h('div', { class: 'xs muted' }, `${u.kind} · ${u.sub}`),
                  ),
                  h('span', { class: `badge t-${u.late ? 'danger' : 'neutral'}` }, fmtDate(u.date)),
                ),
              ),
            )
          : h('div', { class: 'small muted' }, 'لا مواعيد قريبة'),
      ),
    activity: (w) =>
      w.length
        ? section(
            TITLES.activity,
            h(
              'ul',
              { class: 'list', style: { margin: '-16px' } },
              w
                .slice(0, 7)
                .map((a) =>
                  h(
                    'li',
                    { class: 'click', onclick: () => go(a.link) },
                    h(
                      'div',
                      { class: 'grow' },
                      h('div', { class: 'small' }, a.text),
                      h('div', { class: 'xs muted' }, `${a.ref} · ${a.who} · ${ago(a.at)}`),
                    ),
                  ),
                ),
            ),
          )
        : null,
    sla: (w) =>
      w.length
        ? section(
            TITLES.sla,
            h(
              'div',
              null,
              h(
                'table',
                { class: 'tbl' },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    ['الجهة', 'طلبات', 'متوسط الاستجابة'].map((x) => h('th', null, x)),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  w.map((o) =>
                    h(
                      'tr',
                      null,
                      h('td', null, o.org_name),
                      h('td', null, o.received),
                      h('td', null, o.avg_hours != null ? `${o.avg_hours} ساعة` : '—'),
                    ),
                  ),
                ),
              ),
              h(
                'p',
                { class: 'xs muted', style: { marginBlockStart: '8px' } },
                'مؤشر وصفي للمتابعة لا للمحاسبة؛ التأخر يعرض تذكيرًا وتصعيدًا فقط، ولا يعني القبول.',
              ),
            ),
          )
        : null,
    decline: (w) =>
      w.items.length
        ? section(
            TITLES.decline,
            h(
              'div',
              null,
              w.items.map((x) =>
                h(
                  'div',
                  { class: 'bar-h' },
                  h('span', null, x.label),
                  progressBar(0, Math.min(100, x.count * 25), true),
                  h('b', { class: 'num' }, x.count),
                ),
              ),
              h('p', { class: 'xs muted' }, w.note),
            ),
          )
        : null,
    mini_gantt: (w) =>
      w.length
        ? section(
            TITLES.mini_gantt,
            h(
              'div',
              { class: 'mini-gantt', role: 'list' },
              (() => {
                const a = w.map((x) => Date.parse(x.start)),
                  b = w.map((x) => Date.parse(x.end));
                const lo = Math.min(...a),
                  hi = Math.max(...b, lo + 864e5),
                  span = hi - lo;
                const t = Date.parse(w[0].today);
                return w.map((x) =>
                  h(
                    'a',
                    {
                      class: 'mg-row',
                      role: 'listitem',
                      href: x.link,
                      title: `${x.title} — ${x.org} (${fmtDate(x.start)} → ${fmtDate(x.end)})`,
                    },
                    h('span', { class: 'mg-l' }, `${x.ref} ${x.title}`),
                    h(
                      'span',
                      { class: 'mg-t' },
                      h('i', {
                        class: `mg-b s-${x.status}`,
                        style: {
                          insetInlineStart: `${((Date.parse(x.start) - lo) / span) * 100}%`,
                          inlineSize: `${Math.max(3, ((Date.parse(x.end) - Date.parse(x.start)) / span) * 100)}%`,
                        },
                      }),
                      t >= lo && t <= hi
                        ? h('i', { class: 'mg-today', style: { insetInlineStart: `${((t - lo) / span) * 100}%` } })
                        : null,
                    ),
                  ),
                );
              })(),
            ),
            h('p', { class: 'xs muted' }, 'الخط الرأسي = اليوم. افتح الخط الزمني الكامل من صفحة المشروع.'),
          )
        : null,
    delays: (w) =>
      w.length
        ? section(
            TITLES.delays,
            h(
              'ul',
              { class: 'list', style: { margin: '-16px' } },
              w.map((x) =>
                h(
                  'li',
                  { class: 'click', onclick: () => go(x.link) },
                  h(
                    'div',
                    { class: 'grow' },
                    h('div', { class: 'small' }, `${x.ref} ${x.title}`),
                    h(
                      'div',
                      { class: 'xs muted' },
                      `${x.org} · الفعلي ${x.actual} يوم${x.external_approved ? ` · منها ${x.external_approved} معتمدة خارجية` : ''}`,
                    ),
                  ),
                  badge(`${x.accountable} يوم محسوب`, x.accountable ? 'danger' : 'neutral'),
                ),
              ),
            ),
          )
        : null,
    blockers: (w) =>
      w.length
        ? section(
            TITLES.blockers,
            h(
              'ul',
              { class: 'list', style: { margin: '-16px' } },
              w.map((x) =>
                h(
                  'li',
                  { class: 'click', onclick: () => go(x.link) },
                  h(
                    'div',
                    { class: 'grow' },
                    h('div', { class: 'small' }, x.title),
                    h('div', { class: 'xs muted' }, `${x.wp_ref || ''} · ${x.days} يوم`),
                  ),
                  badge(x.status === 'OPEN' ? 'مفتوح' : 'مقترح', 'attention'),
                ),
              ),
            ),
          )
        : null,
    deliverables: (w) =>
      w.length
        ? section(
            TITLES.deliverables,
            h(
              'div',
              { class: 'col' },
              w.map((x) =>
                h(
                  'a',
                  { href: x.link, style: { color: 'inherit', textDecoration: 'none' } },
                  h(
                    'div',
                    { class: 'row nowrap' },
                    h('b', { class: 'grow small' }, x.project),
                    x.submitted ? badge(`${x.submitted} بانتظار القبول`, 'attention') : null,
                  ),
                  progressBar(x.total ? Math.round((x.accepted / x.total) * 100) : 0, 0, true),
                  h('div', { class: 'xs muted' }, `${x.accepted} من ${x.total} حزم عمل مقبولة`),
                ),
              ),
            ),
          )
        : null,
    meetings: (w) =>
      w.length
        ? section(
            TITLES.meetings,
            h(
              'ul',
              { class: 'list', style: { margin: '-16px' } },
              w.map((x) =>
                h(
                  'li',
                  { class: 'click', onclick: () => go(x.link) },
                  h(
                    'div',
                    { class: 'grow' },
                    h('div', { class: 'small' }, x.title),
                    h(
                      'div',
                      { class: 'xs muted' },
                      `${x.ref}${x.meeting_no ? ' · ' + x.meeting_no : ''} · ${fmtDate(x.at)}`,
                    ),
                  ),
                  badge(x.kind, 'neutral'),
                ),
              ),
            ),
          )
        : null,
    comments: (w) =>
      w.length
        ? section(
            TITLES.comments,
            h(
              'ul',
              { class: 'list', style: { margin: '-16px' } },
              w.map((x) =>
                h(
                  'li',
                  { class: 'click', onclick: () => go(x.link) },
                  h(
                    'div',
                    { class: 'grow' },
                    h('div', { class: 'small' }, `${x.by}: ${x.text}`),
                    h('div', { class: 'xs muted' }, `${x.thread} · ${ago(x.at)}`),
                  ),
                ),
              ),
            ),
          )
        : null,
  };
  const keys = orderOf(d).filter((k) => !hidden.includes(k) && R[k] && d.widgets[k] !== undefined);
  const render = (k) => {
    const el = R[k](d.widgets[k]);
    if (el && sizes[k]) el.dataset.size = sizes[k];
    if (el) el.dataset.widget = k;
    return el;
  };
  const main = h('div', { class: 'stack' }, keys.filter((k) => !SIDE.includes(k)).map(render));
  const side = h('div', { class: 'stack' }, keys.filter((k) => SIDE.includes(k)).map(render));
  const name = me.user.name.replace(/^(د\.|م\.|أ\.)\s*/, '').split(' ')[0];
  const guide =
    d.guide && !me.prefs?.dismissed_guide
      ? h(
          'div',
          { class: 'guide' },
          h(
            'div',
            { class: 'row' },
            h('b', { class: 'grow' }, d.guide.title),
            h(
              'button',
              {
                class: 'btn ghost sm',
                onclick: async () => {
                  await api.put('/me/prefs', { dismissed_guide: true });
                  ctx.me.prefs = { ...(ctx.me.prefs || {}), dismissed_guide: true };
                  refresh();
                },
              },
              'إخفاء',
            ),
          ),
          h(
            'ol',
            null,
            d.guide.steps.map((s) => h('li', null, s)),
          ),
        )
      : null;
  const el = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'hero' },
      h(
        'div',
        { style: { flex: 1 } },
        h('h1', null, `مرحبًا ${name}`),
        h('div', { class: 'muted' }, `${me.user.title} — ${me.user.org_name} · ${d.persona}`),
      ),
      h(
        'button',
        { class: 'btn sm', onclick: () => customize(d, hidden, sizes, refresh, ctx) },
        icon('gear', 16),
        'تخصيص الصفحة',
      ),
    ),
    guide,
    // only counters with something in them: a row of zeros is noise
    d.widgets.kpis?.some((k) => k.value)
      ? h(
          'div',
          { class: 'kpi-row' },
          d.widgets.kpis.filter((k) => k.value).map((k) =>
            h(
              'a',
              {
                class: `kpi${k.tone === 'danger' && k.value ? ' t-danger' : k.value && k.tone === 'attention' ? ' hot' : ''}`,
                href: k.link,
              },
              h('span', { class: 'v num' }, k.value),
              h('span', { class: 'l' }, k.label),
              h('span', { class: 'h' }, k.hint),
            ),
          ),
        )
      : null,
    h('div', { class: 'home-grid' }, main, side),
  );
  return { title: 'الرئيسية', el };
}

function customize(d, hidden, sizes, refresh, ctx) {
  const order = orderOf(d);
  const hid = new Set(hidden);
  const sz = { ...sizes };
  const list = h('ul', { class: 'list' });
  const draw = () =>
    mount(
      list,
      order.map((k, i) =>
        h(
          'li',
          null,
          h(
            'label',
            { class: 'chk grow' },
            h('input', {
              type: 'checkbox',
              checked: !hid.has(k) ? true : null,
              onchange: (e) => {
                e.target.checked ? hid.delete(k) : hid.add(k);
              },
            }),
            h('span', null, TITLES[k] || k),
          ),
          h(
            'select',
            {
              'aria-label': `حجم ${TITLES[k] || k}`,
              class: 'sel-sm',
              onchange: (e) => {
                sz[k] = e.target.value;
              },
            },
            Object.entries(SIZE_AR).map(([v, l]) =>
              h('option', { value: v, selected: (sz[k] || 'md') === v ? true : null }, l),
            ),
          ),
          h(
            'button',
            {
              class: 'btn ghost sm',
              'aria-label': 'أعلى',
              disabled: i === 0 ? true : null,
              onclick: () => {
                [order[i - 1], order[i]] = [order[i], order[i - 1]];
                draw();
              },
            },
            '↑',
          ),
          h(
            'button',
            {
              class: 'btn ghost sm',
              'aria-label': 'أسفل',
              disabled: i === order.length - 1 ? true : null,
              onclick: () => {
                [order[i + 1], order[i]] = [order[i], order[i + 1]];
                draw();
              },
            },
            '↓',
          ),
        ),
      ),
    );
  draw();
  const m = modal({
    title: 'تخصيص الصفحة الرئيسية',
    body: [
      h(
        'p',
        { class: 'muted small' },
        'أضف أو أخفِ العناصر، رتّبها، واختر حجم كل عنصر. يُحفظ اختيارك لحسابك فقط، ولا تظهر في أي عنصر إلا البيانات المصرّح لك بها.',
      ),
      list,
    ],
    actions: [
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            const r = await api.put('/me/prefs', { widgets: { order, hidden: [...hid], sizes: sz } });
            ctx.me.prefs = r.prefs;
            m.close();
            toast('حُفظ التخصيص', 'ok');
            refresh();
          },
        },
        'حفظ',
      ),
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'إلغاء'),
    ],
  });
}

function platformHome(d, me) {
  const p = d.widgets.platform;
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'hero' },
      h(
        'div',
        null,
        h('h1', null, d.persona),
        h('div', { class: 'muted' }, 'مؤشرات تشغيلية مجمّعة فقط — لا يُعرض محتوى الجهات.'),
      ),
    ),
    h(
      'div',
      { class: 'grid c4 keep2' },
      [
        ['users', 'مستخدمون'],
        ['orgs', 'جهات'],
        ['projects', 'مشاريع'],
        ['requests', 'طلبات'],
      ].map(([k, l]) =>
        h('div', { class: 'kpi' }, h('span', { class: 'v num' }, p.counts[k]), h('span', { class: 'l' }, l)),
      ),
    ),
    section(
      'سلامة سجل التدقيق',
      h(
        'div',
        { class: 'row' },
        badge(p.audit.ok ? 'السلسلة سليمة' : 'اكتُشف عبث', p.audit.ok ? 'success' : 'danger'),
        h('span', { class: 'small muted' }, `${p.audit.total} سجل · الرأس ${p.audit.head || '—'}`),
      ),
    ),
    d.widgets.projects
      ? section(
          'المشاريع (بيانات وصفية)',
          h(
            'table',
            { class: 'tbl' },
            h(
              'tbody',
              null,
              d.widgets.projects.map((x) =>
                h(
                  'tr',
                  null,
                  h('td', null, x.name),
                  h('td', null, x.lead_org),
                  h('td', null, `${x.progress.verified}% معتمد`),
                ),
              ),
            ),
          ),
        )
      : null,
  );
}
