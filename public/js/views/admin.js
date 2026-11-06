import { lang, setLang } from '../i18n.js';
import { api, session } from '../api.js';
import { h, icon, toast, badge, fmtDate, fmtDT, formDialog, confirmDialog, emptyState, avatar } from '../ui.js';
import { section, kv, noticeEl, SERVICE_TYPES } from '../shared.js';
import { setTheme } from '../main.js';
import { downloadExport } from '../files.js';

const ACTIONS = {
  login: 'دخول',
  'request.create': 'إنشاء طلب',
  'request.send-for-approval': 'إرسال الطلب للاعتماد',
  'request.submit': 'اعتماد وإرسال الطلب للجنة',
  'request.route-to-chair': 'رفع الطلب للرئيس',
  'request.refer': 'إحالة إلى جهة',
  'request.reroute': 'إعادة توجيه',
  'request.acknowledge': 'استلام الطلب',
  'request.decide.accept': 'قبول الطلب (التزام)',
  'request.decide.decline': 'اعتذار مسبَّب',
  'request.decide.counter': 'مقترح بديل',
  'request.decide.need_info': 'طلب استكمال',
  'request.start-execution': 'بدء التنفيذ',
  'request.submit-deliverable': 'تسليم مخرج',
  'request.review.accept': 'قبول مخرج',
  'request.review.return': 'إعادة مخرج',
  'request.close': 'إغلاق طلب',
  'request.split': 'تفكيك طلب',
  'request.remind': 'تذكير',
  'request.sla.reminder': 'تذكير آلي بتجاوز المدة',
  'request.sla.escalation': 'تصعيد آلي (دون قبول)',
  'project.create': 'إنشاء مشروع',
  'baseline.freeze': 'اعتماد خط الأساس',
  'wp.create': 'إنشاء حزمة',
  'wp.release': 'تصريح بدء',
  'wp.accept': 'قبول مخرج حزمة',
  'wp.return': 'إعادة مخرج حزمة',
  'wp.transition': 'نقل مرحلة حزمة',
  'wp.evidence': 'إرفاق دليل',
  'wp.readiness': 'فحص جاهزية',
  'task.create': 'إنشاء مهمة',
  'task.status': 'تغيير حالة مهمة',
  'cr.create': 'طلب تغيير',
  'delegation.grant': 'منح تفويض',
  'delegation.revoke': 'سحب تفويض',
  'issue.raise': 'تسجيل عائق',
  'issue.approve': 'اعتماد استثناء',
  'commitment.update': 'تحديث التزام',
  'thread.create': 'محادثة جديدة',
};
const actLabel = (a) => (a.startsWith('denied:') ? 'محاولة مرفوضة' : ACTIONS[a] || a);

export async function governanceView({ query, ctx, go }) {
  const tab = query.tab || 'delegations';
  const o = await api.get('/admin/overview').catch(() => null);
  const tabs = [
    ['delegations', 'التفويضات'],
    ...(ctx.me.user.roles.includes('ORG_ADMIN') ? [['members', 'أعضاء الجهة']] : []),
    ['competencies', 'دليل الاختصاصات'],
    ['audit', 'سجل التدقيق'],
    ['breakglass', 'الوصول الاستثنائي'],
    ['system', 'حالة النظام'],
  ];
  const nav = h(
    'nav',
    { class: 'tabs' },
    tabs.map(([k, l]) => h('a', { href: `#/governance?tab=${k}`, 'aria-current': k === tab ? 'page' : null }, l)),
  );
  let body;
  if (tab === 'audit') body = await auditTab(query);
  else if (tab === 'breakglass') body = await breakGlassTab(ctx, () => go('#/governance?tab=breakglass'));
  else if (tab === 'system') body = await systemTab();
  else if (tab === 'members') body = await membersTab(() => go('#/governance?tab=members'));
  else if (tab === 'competencies') body = competencies(o, ctx, () => go('#/governance?tab=competencies'));
  else body = delegations(o, ctx, () => go('#/governance?tab=delegations'));
  return {
    title: 'الحوكمة والتدقيق',
    el: h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'page-head' },
        h(
          'div',
          null,
          h('h1', null, 'الحوكمة والتدقيق'),
          h('div', { class: 'sub' }, 'من يملك أن يقرر باسم جهته، وسجل لا يُعدَّل لما جرى.'),
        ),
      ),
      nav,
      body,
    ),
  };
}

function delegations(o, ctx, refresh) {
  if (!o) return h('div', { class: 'card' }, emptyState('غير متاح', 'هذه الصفحة لمن يملك صلاحية إدارية أو تفويضًا.'));
  const canGrant = [...o.can_grant.org, ...o.can_grant.coord];
  const label = (a) =>
    ({
      submit_request: 'اعتماد وإرسال طلبات الجهة',
      commit: 'قبول أو رفض التزامات الجهة',
      route: 'إحالة الطلبات إلى الجهات المختصة',
      close_request: 'إغلاق الطلبات إداريًا',
      release: 'إصدار تصريح بدء حزم العمل',
      accept_deliverable: 'قبول المخرجات',
      approve_change: 'اعتماد طلبات التغيير',
    })[a] || a;
  const rows = o.delegations
    .filter((d) => !d.revoked)
    .map((d) =>
      h(
        'tr',
        null,
        h('td', null, h('b', null, d.user_name), h('div', { class: 'xs muted' }, d.org_name)),
        h('td', null, d.action_label),
        h(
          'td',
          { class: 'small' },
          d.project_ids.includes('*') ? 'كل المشاريع' : d.project_ids.join('، '),
          d.max_amount != null
            ? h('div', { class: 'xs muted' }, `حد مالي: ${d.max_amount.toLocaleString('en-US')} د.إ`)
            : null,
          d.service_types.includes('*')
            ? ''
            : h('div', { class: 'xs muted' }, d.service_types.map((s) => SERVICE_TYPES[s] || s).join('، ')),
        ),
        h('td', null, fmtDate(d.valid_to)),
        h('td', { class: 'small' }, d.basis),
        h('td', { class: 'small' }, d.granted_by_name),
        h(
          'td',
          null,
          canGrant.length
            ? h(
                'button',
                {
                  class: 'btn sm danger',
                  onclick: () =>
                    formDialog({
                      title: `سحب تفويض ${d.user_name}`,
                      fields: [{ name: 'reason', label: 'سبب السحب', type: 'textarea' }],
                      submit: 'سحب التفويض',
                      danger: true,
                      onSubmit: async (v) => {
                        await api.post(`/admin/delegations/${d.id}/revoke`, v);
                        toast('سُحب التفويض', 'ok');
                        refresh();
                      },
                    }),
                },
                'سحب',
              )
            : null,
        ),
      ),
    );
  const grant = canGrant.length
    ? h(
        'button',
        { class: 'btn primary', onclick: () => grantForm(o, ctx, canGrant, label, refresh) },
        icon('plus', 16),
        'منح تفويض',
      )
    : null;
  return h(
    'div',
    { class: 'stack' },
    noticeEl(
      'التفويض هو ما يسمح لموظف بالقرار الرسمي باسم جهته. لا يقرر أحد باسم جهة أخرى، ولا يمنح أحد نفسه تفويضًا، وكل منح وسحب يُسجَّل.',
      '',
      'shield',
    ),
    section(
      'التفويضات السارية',
      rows.length
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
                  ['الموظف', 'التفويض', 'النطاق', 'ينتهي', 'السند', 'منحه', ''].map((x) => h('th', null, x)),
                ),
              ),
              h('tbody', null, rows),
            ),
          )
        : emptyState('لا تفويضات'),
      grant,
    ),
  );
}

function grantForm(o, ctx, canGrant, label, refresh) {
  const me = ctx.me.user.id;
  formDialog({
    title: 'منح تفويض',
    wide: true,
    intro: 'يُمنح لموظف من جهتك فقط، بسند مكتوب وتاريخ انتهاء.',
    fields: [
      {
        name: 'user_id',
        label: 'الموظف',
        type: 'select',
        required: true,
        options: o.users.filter((u) => u.id !== me).map((u) => ({ value: u.id, label: `${u.name} — ${u.title}` })),
      },
      {
        name: 'action',
        label: 'نوع التفويض',
        type: 'select',
        required: true,
        options: canGrant.map((a) => ({ value: a, label: label(a) })),
      },
      {
        name: 'service_types',
        label: 'يقتصر على أنواع خدمة (اختياري — للقبول والاعتذار)',
        type: 'checks',
        options: Object.entries(SERVICE_TYPES).map(([value, l]) => ({ value, label: l })),
      },
      {
        name: 'max_amount',
        label: 'الحد المالي للتفويض (د.إ، اختياري — فارغ = بلا حد)',
        type: 'number',
        half: true,
        min: 0,
      },
      { name: 'basis', label: 'سند التفويض (رقم القرار أو الكتاب)', required: true, half: true },
      { name: 'valid_to', label: 'ينتهي في', type: 'date', required: true, half: true },
    ],
    submit: 'منح التفويض',
    onSubmit: async (v) => {
      await api.post('/admin/delegations', v);
      toast('مُنح التفويض', 'ok');
      refresh();
    },
  });
}

function competencies(o, ctx, refresh) {
  if (!o) return h('div', { class: 'card' }, emptyState('غير متاح'));
  return section(
    'دليل الاختصاصات',
    h(
      'div',
      { class: 'col' },
      h(
        'p',
        { class: 'small muted' },
        'يساعد اللجنة على اقتراح الجهة المناسبة. هو دليل استرشادي والقرار للجهة نفسها. مدة الرد مرجعية للتذكير والتصعيد فقط.',
      ),
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
              [
                'نوع الخدمة',
                'الجهة المختصة',
                'النطاق',
                'سلطة القبول',
                'الجهة البديلة',
                'السريان',
                'مدة الرد (ساعة)',
                '',
              ].map((x) => h('th', null, x)),
            ),
          ),
          h(
            'tbody',
            null,
            o.competencies.map((c) =>
              h(
                'tr',
                null,
                h('td', null, h('b', null, c.label)),
                h('td', null, c.owner_org_name),
                h('td', { class: 'small' }, c.scope),
                h('td', { class: 'small' }, c.acceptance_authority || '—'),
                h('td', { class: 'small' }, c.substitute_org_name || '—'),
                h('td', { class: 'small' }, `${c.valid_from || '…'} → ${c.valid_to || '…'}`),
                h('td', null, c.sla_hours),
                h(
                  'td',
                  null,
                  o.can_edit_competencies
                    ? h(
                        'button',
                        {
                          class: 'btn sm',
                          onclick: () =>
                            formDialog({
                              title: `تعديل الاختصاص — ${c.label}`,
                              fields: [
                                {
                                  name: 'sla_hours',
                                  label: 'مدة الرد المرجعية (ساعة)',
                                  type: 'number',
                                  required: true,
                                  value: c.sla_hours,
                                  min: 4,
                                  max: 720,
                                  half: true,
                                },
                                {
                                  name: 'acceptance_authority',
                                  label: 'سلطة القبول',
                                  value: c.acceptance_authority || '',
                                  half: true,
                                },
                                {
                                  name: 'valid_from',
                                  label: 'يسري من',
                                  type: 'date',
                                  value: c.valid_from || '',
                                  half: true,
                                },
                                {
                                  name: 'valid_to',
                                  label: 'يسري حتى',
                                  type: 'date',
                                  value: c.valid_to || '',
                                  half: true,
                                },
                                {
                                  name: 'substitute_org_id',
                                  label: 'الجهة البديلة',
                                  type: 'select',
                                  placeholder: false,
                                  value: c.substitute_org_id || '',
                                  options: [
                                    { value: '', label: 'بلا جهة بديلة' },
                                    ...o.orgs
                                      .filter((x) => x.id !== c.owner_org_id)
                                      .map((x) => ({ value: x.id, label: x.name })),
                                  ],
                                },
                                { name: 'reason', label: 'سبب التعديل', type: 'textarea' },
                              ],
                              submit: 'حفظ',
                              onSubmit: async (v) => {
                                await api.patch(`/admin/competencies/${c.id}`, v);
                                toast('حُفظ التعديل', 'ok');
                                refresh();
                              },
                            }),
                        },
                        'تعديل',
                      )
                    : null,
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

async function auditTab(query) {
  const projects = (await api.get('/projects')).items;
  const pid = query.project || '';
  const only = query.denied === '1';
  const r = await api.get('/audit', { project_id: pid, limit: 150 });
  const items = only ? r.items.filter((x) => x.outcome === 'denied') : r.items;
  const sel = h(
    'select',
    {
      style: { width: 'auto' },
      'aria-label': 'المشروع',
      onchange: (e) => {
        location.hash = `#/governance?tab=audit&project=${e.target.value}${only ? '&denied=1' : ''}`;
      },
    },
    h('option', { value: '' }, 'كل ما أستطيع رؤيته'),
    projects.map((p) => h('option', { value: p.id, selected: p.id === pid ? true : null }, p.name)),
  );
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'row' },
      r.verify.ok
        ? badge(`سلسلة التدقيق سليمة — ${r.verify.total} سجل`, 'success')
        : badge(`اكتُشف عبث عند السجل ${r.verify.broken_at}`, 'danger'),
      h('span', { class: 'xs muted num' }, r.verify.head ? `البصمة ${r.verify.head}` : ''),
      h(
        'button',
        {
          class: 'btn sm',
          onclick: async () => {
            try {
              const v = await api.get('/audit/verify');
              toast(
                v.ok ? `السلسلة سليمة — ${v.total} سجل` : `اكتُشف عبث عند السجل ${v.broken_at}`,
                v.ok ? 'ok' : 'err',
              );
            } catch (e) {
              toast(e.message, 'err');
            }
          },
        },
        'تحقق الآن',
      ),
      h(
        'button',
        { class: 'btn sm', onclick: () => downloadExport('audit', {}, 'mihwar-audit.csv') },
        'تصدير CSV (مسجَّل)',
      ),
      h('div', { class: 'grow' }),
      sel,
      h(
        'button',
        {
          class: 'chip',
          'aria-pressed': String(only),
          onclick: () => {
            location.hash = `#/governance?tab=audit${pid ? '&project=' + pid : ''}${only ? '' : '&denied=1'}`;
          },
        },
        'المرفوضة فقط',
      ),
    ),
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
            ['#', 'الوقت', 'من', 'الإجراء', 'الأثر', 'السبب'].map((x) => h('th', null, x)),
          ),
        ),
        h(
          'tbody',
          null,
          items.map((a) =>
            h(
              'tr',
              null,
              h('td', { class: 'num xs muted' }, a.seq),
              h('td', { class: 'small', style: { whiteSpace: 'nowrap' } }, fmtDT(a.at)),
              h('td', { class: 'small' }, a.actor_name),
              h(
                'td',
                null,
                a.outcome === 'denied' ? badge(actLabel(a.action), 'danger') : actLabel(a.action),
                a.delegation_id ? h('div', { class: 'xs muted' }, `بتفويض ${a.delegation_id}`) : null,
              ),
              h('td', { class: 'small' }, a.from || a.to ? `${a.from || ''} ← ${a.to || ''}` : a.detail || a.object_id),
              h('td', { class: 'small' }, a.reason || ''),
            ),
          ),
        ),
      ),
    ),
    items.length ? null : emptyState('لا سجلات'),
    h(
      'p',
      { class: 'xs muted' },
      'السجل مضاف فقط ومترابط بالتجزئة (hash chain): أي تعديل لاحق على سجل قديم يكسر السلسلة ويظهر هنا.',
    ),
  );
}

async function breakGlassTab(ctx, refresh) {
  let r;
  try {
    r = await api.get('/admin/break-glass');
  } catch (e) {
    return h(
      'div',
      { class: 'card' },
      emptyState('غير متاح لدورك', 'الوصول الاستثنائي لمشغّل المنصة، ويعتمده مالك المنصة ومنسّق المشروع.'),
    );
  }
  const me = ctx.me;
  const isOp = me.user.roles.includes('SUPER_ADMIN');
  const ST = {
    PENDING: ['بانتظار الاعتماد', 'attention'],
    ACTIVE: ['فعّال — قراءة فقط', 'success'],
    EXPIRED: ['انتهى', 'neutral'],
    REVOKED: ['أُلغي', 'neutral'],
    REJECTED: ['رُفض', 'danger'],
  };
  const request = isOp
    ? h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            const ps = (await api.get('/projects')).items;
            formDialog({
              title: 'طلب وصول استثنائي',
              intro: `قراءة فقط، حتى ${r.max_hours} ساعات، ويتطلب اعتماد مالك المنصة ومنسّق المشروع. كل قراءة تُسجَّل في التدقيق.`,
              fields: [
                {
                  name: 'project_id',
                  label: 'المشروع',
                  type: 'select',
                  required: true,
                  options: ps.map((p) => ({ value: p.id, label: p.name })),
                },
                {
                  name: 'duration_hours',
                  label: 'المدة (ساعات)',
                  type: 'number',
                  min: 1,
                  max: r.max_hours,
                  value: 1,
                  required: true,
                },
                { name: 'reason', label: 'السبب التشغيلي', type: 'textarea', required: true },
              ],
              submit: 'إرسال الطلب',
              onSubmit: async (v) => {
                await api.post('/admin/break-glass', v);
                toast('أُرسل الطلب للاعتماد', 'ok');
                refresh();
              },
            });
          },
        },
        icon('plus', 16),
        'طلب وصول استثنائي',
      )
    : null;
  const rows = r.items.map((g) =>
    h(
      'li',
      null,
      h(
        'div',
        { class: 'grow' },
        h(
          'div',
          { class: 'row nowrap' },
          h('b', null, g.project_name),
          badge(...(ST[g.status] || [g.status, 'neutral'])),
        ),
        h(
          'div',
          { class: 'xs muted' },
          `${g.requested_by_name} · ${fmtDT(g.requested_at)} · ${g.duration_hours} ساعة${g.active_until ? ' · حتى ' + fmtDT(g.active_until) : ''}`,
        ),
        h('p', { class: 'small' }, g.reason),
        h(
          'div',
          { class: 'xs' },
          g.approvals.length
            ? `اعتمد: ${g.approvals.map((a) => `${a.by_name} (${a.as === 'owner' ? 'مالك المنصة' : 'منسّق المشروع'})`).join('، ')}`
            : 'لا اعتماد بعد',
          g.status === 'PENDING'
            ? ` — ينقص: ${g.need.map((n) => (n === 'owner' ? 'مالك المنصة' : 'منسّق المشروع')).join(' و')}`
            : '',
        ),
      ),
      h(
        'div',
        { class: 'col' },
        g.status === 'PENDING' && !isOp && g.requested_by !== me.user.id
          ? h(
              'button',
              {
                class: 'btn sm primary',
                onclick: async () => {
                  try {
                    await api.post(`/admin/break-glass/${g.id}/approve`, {});
                    toast('سُجّل اعتمادك', 'ok');
                    refresh();
                  } catch (e) {
                    toast(e.message, 'err');
                  }
                },
              },
              'اعتماد',
            )
          : null,
        ['PENDING', 'ACTIVE'].includes(g.status)
          ? h(
              'button',
              {
                class: 'btn sm danger',
                onclick: () =>
                  formDialog({
                    title: 'إلغاء الوصول الاستثنائي',
                    fields: [{ name: 'reason', label: 'السبب', type: 'textarea' }],
                    submit: 'إلغاء',
                    danger: true,
                    onSubmit: async (v) => {
                      await api.post(`/admin/break-glass/${g.id}/revoke`, v);
                      toast('أُلغي', 'ok');
                      refresh();
                    },
                  }),
              },
              'إلغاء',
            )
          : null,
      ),
    ),
  );
  return h(
    'div',
    { class: 'stack' },
    noticeEl(
      'الأصل ألّا يطّلع مشغّل المنصة على محتوى المشاريع. الاستثناء يتطلب اعتمادين، ومدة محدودة، وقراءة فقط، ويظهر كل ما قُرئ في سجل التدقيق.',
      '',
      'shield',
    ),
    request,
    h('div', { class: 'card' }, rows.length ? h('ul', { class: 'list' }, rows) : emptyState('لا طلبات وصول استثنائي')),
  );
}

async function systemTab() {
  let hl, ob;
  try {
    [hl, ob] = await Promise.all([api.get('/system/health'), api.get('/system/outbox')]);
  } catch {
    return h(
      'div',
      { class: 'card' },
      emptyState('غير متاح لدورك', 'حالة النظام لمشغّل المنصة ومالكها، وبأرقام مجمّعة فقط.'),
    );
  }
  const ig = await api.get('/system/integrations').catch(() => null);
  return h(
    'div',
    { class: 'stack' },
    noticeEl(hl.note, '', 'info'),
    h(
      'div',
      { class: 'grid c4 keep2' },
      Object.entries(hl.counts).map(([k, v]) =>
        h(
          'div',
          { class: 'kpi' },
          h('span', { class: 'v num' }, v),
          h(
            'span',
            { class: 'l' },
            {
              users: 'مستخدمون',
              orgs: 'جهات',
              projects: 'مشاريع',
              requests: 'طلبات',
              tasks: 'مهام',
              sessions: 'جلسات',
            }[k] || k,
          ),
        ),
      ),
    ),
    section(
      'سلامة سجل التدقيق',
      h(
        'div',
        { class: 'row' },
        badge(hl.audit.ok ? 'السلسلة سليمة' : 'اكتُشف عبث', hl.audit.ok ? 'success' : 'danger'),
        h('span', { class: 'small muted' }, `${hl.audit.total} سجل`),
      ),
    ),
    ig
      ? section(
          'التكاملات',
          h(
            'div',
            { class: 'col' },
            kv([
              [
                'البريد (SMTP)',
                ig.integrations.email?.configured ? `مفعّل — ${ig.integrations.email.host}` : 'غير مضبوط',
              ],
              [
                'الرسائل النصية (Webhook)',
                ig.integrations.sms?.configured ? `مفعّل — ${ig.integrations.sms.gateway_host}` : 'غير مضبوط',
              ],
              [
                'فاحص الملفات',
                ig.integrations.scanner?.configured
                  ? `مضاد فيروسات خارجي: ${ig.integrations.scanner.engine}`
                  : 'فحص مدمج بالقواعد فقط',
              ],
              [
                'طابور الإرسال',
                Object.entries(ig.queue)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join('، ') || '—',
              ],
            ]),
            h('p', { class: 'xs muted' }, ig.note),
          ),
        )
      : null,
    section('إشعار الصيانة أو الانقطاع', noticeEditor()),
    section(
      'سجل الأحداث المحلي (Outbox)',
      h(
        'div',
        { class: 'col' },
        h(
          'div',
          { class: 'small' },
          `${ob.total} حدث · ${
            Object.entries(ob.by_status)
              .map(([k, v]) => `${k}: ${v}`)
              .join('، ') || '—'
          }`,
        ),
        h('p', { class: 'xs muted' }, ob.note),
      ),
    ),
  );
}

// ============================================================ settings
async function extraSettings(me, go) {
  const ss = await api.get('/me/sessions').catch(() => ({ items: [] }));
  const canExport = !me.user.roles.some((r) => ['SCOPED_VIEWER', 'SUPER_ADMIN'].includes(r));
  return h(
    'div',
    { class: 'grid c2' },
    section(
      'جلساتي',
      h(
        'div',
        { class: 'col' },
        h(
          'ul',
          { class: 'list' },
          ss.items.map((x) =>
            h(
              'li',
              null,
              h(
                'div',
                { class: 'grow' },
                h('div', { class: 'small' }, x.current ? 'هذه الجلسة' : 'جلسة أخرى'),
                h('div', { class: 'xs muted' }, `بدأت ${fmtDT(x.created)} · آخر نشاط ${fmtDT(x.last)}`),
              ),
              x.current
                ? badge('الحالية', 'success')
                : h(
                    'button',
                    {
                      class: 'btn sm danger',
                      onclick: async () => {
                        await api.post(`/me/sessions/${x.id}/revoke`, {});
                        toast('أُنهيت الجلسة', 'ok');
                        go('#/settings');
                      },
                    },
                    'إنهاء',
                  ),
            ),
          ),
        ),
        h('p', { class: 'xs muted' }, 'تنتهي الجلسة تلقائيًا بعد خمول، ويمكنك إنهاء أي جلسة لا تعرفها.'),
      ),
    ),
    section(
      'التصدير',
      h(
        'div',
        { class: 'col' },
        canExport
          ? h(
              'div',
              { class: 'row' },
              h(
                'button',
                { class: 'btn', onclick: () => downloadExport('requests', {}, 'mihwar-requests.csv') },
                'تصدير طلباتي (CSV)',
              ),
            )
          : null,
        h('p', { class: 'xs muted' }, 'كل تصدير مقيَّد بما يحق لك رؤيته ويُسجَّل في التدقيق.'),
      ),
    ),
  );
}

export async function settingsView({ ctx, go }) {
  const me = ctx.me;
  const el = h(
    'div',
    { class: 'stack' },
    h('div', { class: 'page-head' }, h('h1', null, 'الإعدادات')),
    me.limited
      ? noticeEl(
          me.limited === 'PASSWORD_CHANGE_REQUIRED'
            ? 'كلمة مرورك مؤقتة: غيّرها من لوحة «الأمان وكلمة المرور» أدناه قبل متابعة العمل.'
            : 'دورك الإداري يتطلب التحقق الثنائي: فعّله من لوحة «الأمان وكلمة المرور» أدناه قبل متابعة العمل.',
          'warn',
        )
      : null,
    h(
      'div',
      { class: 'grid c2' },
      section(
        'حسابي',
        h(
          'div',
          { class: 'col' },
          h(
            'div',
            { class: 'row' },
            avatar(me.user.name),
            h(
              'div',
              null,
              h('b', null, me.user.name),
              h('div', { class: 'small muted' }, `${me.user.title} — ${me.user.org_name}`),
            ),
          ),
          kv([
            ['الأدوار', me.user.role_labels.join('، ')],
            [
              'اللجنة',
              me.committee.length
                ? me.committee.map((c) => `${c.label} — ${c.project_name}`).join('، ')
                : 'لست عضوًا في لجنة',
            ],
          ]),
        ),
      ),
      section(
        'المظهر والاختصارات',
        h(
          'div',
          { class: 'col' },
          h(
            'div',
            { class: 'row' },
            h('span', { class: 'small' }, 'اللغة'),
            h(
              'div',
              { class: 'seg' },
              [
                ['ar', 'العربية'],
                ['en', 'English'],
              ].map(([k, l]) =>
                h(
                  'button',
                  {
                    'aria-pressed': String(lang === k),
                    lang: k,
                    onclick: () => {
                      if (lang !== k) setLang(k);
                    },
                  },
                  l,
                ),
              ),
            ),
          ),
          h(
            'div',
            { class: 'seg' },
            [
              ['light', 'فاتح'],
              ['dark', 'داكن'],
            ].map(([k, l]) =>
              h(
                'button',
                {
                  'aria-pressed': String(ctx.theme === k),
                  onclick: (e) => {
                    setTheme(k);
                    [...e.currentTarget.parentNode.children].forEach((b) =>
                      b.setAttribute('aria-pressed', String(b === e.currentTarget)),
                    );
                  },
                },
                l,
              ),
            ),
          ),
          h(
            'div',
            { class: 'small muted' },
            'اختصارات: ',
            h('kbd', { class: 'chip' }, '/'),
            ' بحث · ',
            h('kbd', { class: 'chip' }, 'N'),
            ' جديد · ',
            h('kbd', { class: 'chip' }, 'G'),
            ' ثم ',
            h('kbd', { class: 'chip' }, 'H'),
            ' الرئيسية',
          ),
        ),
      ),
      section(
        'تفويضاتي',
        me.delegations.length
          ? h(
              'ul',
              { class: 'check-list' },
              me.delegations.map((d) =>
                h(
                  'li',
                  null,
                  h('span', { class: 'ok' }, icon('shield', 16)),
                  h(
                    'span',
                    null,
                    h('b', null, d.label),
                    h(
                      'div',
                      { class: 'xs muted' },
                      `${d.project_ids.includes('*') ? 'كل المشاريع' : 'مشاريع محددة'} · حتى ${fmtDate(d.valid_to)} · ${d.basis}`,
                    ),
                  ),
                ),
              ),
            )
          : h(
              'div',
              { class: 'small muted' },
              'ليس لديك تفويض قرار رسمي. بإمكانك إعداد المسودات والتوصيات، ويعتمدها المفوّض.',
            ),
      ),
      me.demo
        ? section(
            'النسخة التجريبية',
            h(
              'div',
              { class: 'col' },
              noticeEl(
                'هذه بيانات تخيلية محلية. إعادة التهيئة تمسح كل التغييرات وتعيد السيناريو الابتدائي.',
                'warn',
                'alert',
              ),
              h(
                'button',
                {
                  class: 'btn danger',
                  onclick: async () => {
                    if (
                      await confirmDialog({
                        title: 'إعادة تهيئة البيانات التجريبية',
                        text: 'ستُحذف كل التغييرات التي أجريتها ويعود النظام للبيانات الأولى.',
                        ok: 'إعادة التهيئة',
                        danger: true,
                      })
                    ) {
                      await api.post('/demo/reset');
                      session.set(null);
                      location.hash = '#/login';
                      location.reload();
                    }
                  },
                },
                'إعادة تهيئة البيانات',
              ),
            ),
          )
        : null,
    ),
    await securityPanel(me, go),
    await contactPanel(),
    await extraSettings(me, go),
    h(
      'p',
      { class: 'credit' },
      'إعداد وتصميم: د.م. جراح جمال الطير',
      h('br'),
      'نسخة تجريبية محلية ببيانات تخيلية — لا تمثل جهة حكومية رسمية ولا تدّعي اعتمادًا أو امتثالًا.',
    ),
  );
  return { title: 'الإعدادات', el };
}

// ============================================================ security (password + TOTP)
async function securityPanel(me, go) {
  const sec = await api.get('/me/security').catch(() => null);
  if (!sec || (!sec.has_password && !sec.mfa_required)) return h('div', { class: 'hide' });
  const after = (r) => {
    if (!r.limited) me.limited = null;
    toast('تم', 'ok');
    location.hash = '#/settings';
    setTimeout(() => location.reload(), 150);
  };
  const change = () =>
    formDialog({
      title: 'تغيير كلمة المرور',
      intro: '12 حرفًا على الأقل، وتجمع أحرفًا كبيرة وصغيرة وأرقامًا. تُنهى جلساتك الأخرى بعد التغيير.',
      fields: [
        { name: 'current', label: 'كلمة المرور الحالية', type: 'password', required: true },
        { name: 'next', label: 'كلمة المرور الجديدة', type: 'password', required: true },
      ],
      submit: 'تغيير',
      onSubmit: async (v) => {
        after(await api.post('/me/password', v));
      },
    });
  const setup = async () => {
    const r = await api.post('/me/mfa/setup', {});
    formDialog({
      title: 'تفعيل التحقق الثنائي',
      intro:
        'أضف المفتاح التالي يدويًا في تطبيق المصادقة (TOTP، 6 أرقام، 30 ثانية) ثم أدخل الرمز الظاهر لتأكيد التفعيل.',
      note: h(
        'div',
        { class: 'col' },
        h('code', { dir: 'ltr', style: { userSelect: 'all', wordBreak: 'break-all' } }, r.secret),
        h('div', { class: 'xs muted', dir: 'ltr' }, r.otpauth_uri),
      ),
      fields: [{ name: 'code', label: 'الرمز', required: true }],
      submit: 'تأكيد التفعيل',
      onSubmit: async (v) => {
        after(await api.post('/me/mfa/enable', v));
      },
    });
  };
  return section(
    'الأمان وكلمة المرور',
    h(
      'div',
      { class: 'col' },
      kv([
        ['الدخول', sec.auth === 'password' ? 'بكلمة مرور' : 'انتقاء تجريبي'],
        ['التحقق الثنائي', sec.mfa_enabled ? 'مفعّل' : sec.mfa_required ? 'مطلوب لدورك ولم يُفعّل' : 'غير مفعّل'],
        ['آخر تغيير لكلمة المرور', sec.changed_at ? fmtDT(sec.changed_at) : '—'],
      ]),
      h(
        'div',
        { class: 'row' },
        sec.has_password ? h('button', { class: 'btn', onclick: change }, 'تغيير كلمة المرور') : null,
        sec.has_password && !sec.mfa_enabled
          ? h('button', { class: 'btn primary', onclick: setup }, 'تفعيل التحقق الثنائي')
          : null,
      ),
    ),
  );
}

// ============================================================ organisation members (ORG_ADMIN)
async function membersTab(refresh) {
  const r = await api.get('/org/members');
  const reveal = (title, pw) =>
    formDialog({
      title,
      intro: 'تُعرض كلمة المرور المؤقتة هذه المرة فقط. سلّمها للموظف بقناة آمنة؛ سيُلزم بتغييرها عند أول دخول.',
      note: h('code', { dir: 'ltr', style: { userSelect: 'all', fontSize: '1.1rem' } }, pw),
      fields: [],
      submit: 'تم',
      onSubmit: async () => {},
    });
  const add = () =>
    formDialog({
      title: 'إضافة موظف إلى الجهة',
      fields: [
        { name: 'name', label: 'الاسم', required: true, half: true },
        { name: 'title', label: 'المسمى الوظيفي', half: true },
        { name: 'roles', label: 'الدور', type: 'checks', options: r.assignable_roles, value: ['ORG_EXECUTIVE'] },
        { name: 'capacity_week', label: 'السعة الأسبوعية (ساعة)', type: 'number', value: 40, min: 4, max: 60 },
      ],
      submit: 'إضافة',
      onSubmit: async (v) => {
        const x = await api.post('/org/members', { ...v, roles: v.roles?.length ? v.roles : ['ORG_EXECUTIVE'] });
        toast('أُضيف الموظف', 'ok');
        refresh();
        if (x.temporary_password) reveal(`كلمة مرور ${x.member.name}`, x.temporary_password);
      },
    });
  const edit = (m) =>
    formDialog({
      title: `تعديل ${m.name}`,
      fields: [
        { name: 'title', label: 'المسمى', value: m.title, half: true },
        {
          name: 'capacity_week',
          label: 'السعة الأسبوعية',
          type: 'number',
          value: m.capacity_week,
          half: true,
          min: 4,
          max: 60,
        },
        { name: 'roles', label: 'الدور', type: 'checks', options: r.assignable_roles, value: m.roles },
      ],
      submit: 'حفظ',
      onSubmit: async (v) => {
        await api.patch(`/org/members/${m.id}`, { ...v, roles: v.roles?.length ? v.roles : m.roles });
        toast('حُفظ', 'ok');
        refresh();
      },
    });
  const toggle = (m) =>
    formDialog({
      title: m.active ? `إيقاف ${m.name}` : `إعادة تفعيل ${m.name}`,
      intro: m.active ? 'يُسحب كل تفويضه وتنتهي جلساته فورًا، وتبقى سجلاته محفوظة.' : '',
      fields: [{ name: 'reason', label: 'السبب', type: 'textarea', required: m.active }],
      submit: m.active ? 'إيقاف' : 'تفعيل',
      danger: m.active,
      onSubmit: async (v) => {
        await api.patch(`/org/members/${m.id}`, { active: !m.active, reason: v.reason });
        toast('تم', 'ok');
        refresh();
      },
    });
  const reset = (m) =>
    formDialog({
      title: `إعادة تعيين كلمة مرور ${m.name}`,
      intro: 'تُنهى جلساته ويُلزم بتغيير الكلمة المؤقتة عند أول دخول.',
      fields: [],
      submit: 'إعادة التعيين',
      danger: true,
      onSubmit: async () => {
        const x = await api.post(`/admin/users/${m.id}/reset-password`, {});
        refresh();
        reveal(`كلمة مرور ${m.name}`, x.temporary_password);
      },
    });
  const rows = r.items.map((m) =>
    h(
      'tr',
      null,
      h('td', null, h('b', null, m.name), h('div', { class: 'xs muted' }, m.title)),
      h('td', { class: 'small' }, m.role_labels.join('، ')),
      h('td', { class: 'small' }, m.delegations ? `${m.delegations} تفويض` : '—'),
      h(
        'td',
        null,
        m.active ? badge('نشط', 'success') : badge('موقوف', 'neutral'),
        m.mfa_enabled ? h('span', { class: 'xs muted', style: { marginInlineStart: '6px' } }, 'MFA') : null,
      ),
      h(
        'td',
        null,
        m.roles.every((x) => r.assignable_roles.some((a) => a.value === x))
          ? h(
              'div',
              { class: 'row nowrap' },
              h('button', { class: 'btn sm', onclick: () => edit(m) }, 'تعديل'),
              r.password_mode ? h('button', { class: 'btn sm', onclick: () => reset(m) }, 'كلمة مرور') : null,
              h(
                'button',
                { class: `btn sm${m.active ? ' danger' : ''}`, onclick: () => toggle(m) },
                m.active ? 'إيقاف' : 'تفعيل',
              ),
            )
          : h('span', { class: 'xs muted' }, 'تُدار من مالك المنصة'),
      ),
    ),
  );
  return h(
    'div',
    { class: 'stack' },
    noticeEl(
      'تضيف هنا موظفي جهتك فقط. منح التفويضات من تبويب «التفويضات»، وأدوار اللجنة والإدارة العليا من مالك المنصة. الإيقاف يسحب تفويضات الموظف وينهي جلساته.',
      '',
      'shield',
    ),
    section(
      'أعضاء الجهة',
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
              ['الموظف', 'الدور', 'التفويضات', 'الحالة', ''].map((x) => h('th', null, x)),
            ),
          ),
          h('tbody', null, rows),
        ),
      ),
      h('button', { class: 'btn primary', onclick: add }, icon('plus', 16), 'إضافة موظف'),
    ),
  );
}

// ============================================================ notification channels (e-mail / SMS) — opt-in, generic text only
async function contactPanel() {
  const r = await api.get('/me/contact').catch(() => null);
  if (!r) return h('div', { class: 'hide' });
  const c = r.contact;
  const e = h('input', { type: 'email', value: c.email, dir: 'ltr', autocomplete: 'email', id: 'ct-email' });
  const p = h('input', {
    type: 'tel',
    value: c.phone,
    dir: 'ltr',
    placeholder: '+9715XXXXXXXX',
    autocomplete: 'tel',
    id: 'ct-phone',
  });
  const ne = h('input', { type: 'checkbox', checked: c.notify_email ? true : null });
  const ns = h('input', { type: 'checkbox', checked: c.notify_sms ? true : null });
  const err = h('div', { class: 'notice err hide', role: 'alert' });
  return section(
    'قنوات الإشعار',
    h(
      'div',
      { class: 'col' },
      h(
        'p',
        { class: 'small muted' },
        'الإشعارات تصل داخل المنصة دائمًا. يمكنك اختياريًا استلام تنبيه عام بالبريد أو الرسائل النصية. الرسالة الخارجية لا تتضمن عنوان الطلب ولا تفاصيله، وتصل فقط إذا ضُبطت بوابة الإرسال على الخادم.',
      ),
      h('div', { class: 'field' }, h('label', { for: 'ct-email' }, 'البريد الإلكتروني'), e),
      h('label', { class: 'chk' }, ne, h('span', null, 'أرسل تنبيهًا بالبريد')),
      h('div', { class: 'field' }, h('label', { for: 'ct-phone' }, 'الجوال (صيغة دولية)'), p),
      h('label', { class: 'chk' }, ns, h('span', null, 'أرسل تنبيهًا بالرسائل النصية')),
      err,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              err.classList.add('hide');
              try {
                await api.put('/me/contact', {
                  email: e.value.trim(),
                  phone: p.value.trim(),
                  notify_email: ne.checked,
                  notify_sms: ns.checked,
                });
                toast('حُفظت قنوات الإشعار', 'ok');
              } catch (x) {
                err.textContent = x.message;
                err.classList.remove('hide');
              }
            },
          },
          'حفظ',
        ),
      ),
    ),
  );
}

// UX-012 / OPS-008: operator-published banner shown to every signed-in user (and before sign-in).
function noticeEditor() {
  const cur = h('div', { class: 'small muted' }, 'جارٍ التحميل…');
  api
    .get('/system/notice')
    .then((r) => {
      cur.textContent = r.notice ? `قائم الآن: ${r.notice.text}` : 'لا يوجد إشعار قائم.';
    })
    .catch(() => {});
  return h(
    'div',
    { class: 'stack' },
    cur,
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        {
          class: 'btn',
          onclick: () =>
            formDialog({
              title: 'نشر إشعار للمستخدمين',
              fields: [
                {
                  name: 'level',
                  label: 'النوع',
                  type: 'select',
                  options: [
                    { value: 'info', label: 'معلومة' },
                    { value: 'warn', label: 'صيانة مجدولة' },
                    { value: 'outage', label: 'انقطاع' },
                  ],
                  required: true,
                },
                { name: 'text', label: 'نص الإشعار', type: 'textarea', required: true, rows: 3 },
                { name: 'until', label: 'ينتهي في (اختياري)', type: 'datetime-local' },
              ],
              submit: 'نشر',
              onSubmit: async (v) => {
                await api.put('/system/notice', {
                  level: v.level,
                  text: v.text,
                  until: v.until ? new Date(v.until).toISOString() : undefined,
                });
                toast('نُشر الإشعار', 'ok');
                location.reload();
              },
            }),
        },
        'نشر إشعار',
      ),
      h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            await api.put('/system/notice', { text: '' });
            toast('أُزيل الإشعار', 'ok');
            location.reload();
          },
        },
        'إزالة الإشعار',
      ),
    ),
  );
}
