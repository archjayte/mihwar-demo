// Committee workspace: eight working tabs + register of decisions and minutes (spec §8/§9 committee screen).
import { api } from '../api.js';
import { h, icon, toast, badge, fmtDate, fmtDT, formDialog, emptyState, modal } from '../ui.js';
import { reqRow, kv, noticeEl } from '../shared.js';

const KIND_TONE = { decision: 'progress', minutes: 'neutral', referral: 'attention' };
const DEC_STATUS = {
  OPEN: ['مفتوح — بانتظار التنفيذ', 'attention'],
  IMPLEMENTED: ['نُفّذ', 'success'],
  RECORDED: ['مسجّل', 'neutral'],
};

export async function committeeTab({ p, ctx, query, refresh }) {
  const tab = query.tab || 'inbox';
  const c = await api.get(`/projects/${p.id}/committee`, { tab });
  const tabs = h(
    'nav',
    { class: 'tabs sub', 'aria-label': 'صندوق اللجنة' },
    c.tabs.map((t) =>
      h(
        'a',
        { href: `#/p/${p.id}/committee?tab=${t.key}`, 'aria-current': t.key === c.tab ? 'page' : null },
        t.label,
        t.count ? h('span', { class: 'n' }, t.count) : null,
      ),
    ),
  );
  const head = h(
    'div',
    { class: 'card pad' },
    h(
      'div',
      { class: 'grid c3' },
      h('div', null, h('div', { class: 'small muted' }, 'دورك في اللجنة'), h('b', null, c.role_label)),
      h(
        'div',
        null,
        h('div', { class: 'small muted' }, 'الرئيس / النائب / الأمين'),
        h(
          'div',
          { class: 'small' },
          [c.committee.chair, c.committee.deputy, c.committee.secretary].filter(Boolean).join(' · '),
        ),
      ),
      h(
        'div',
        null,
        h('div', { class: 'small muted' }, 'الأعضاء'),
        h('div', { class: 'small' }, c.committee.members.join('، ') || '—'),
      ),
    ),
    h(
      'p',
      { class: 'xs muted', style: { marginBlockStart: '8px' } },
      'الإحالة تنسيقية: لا تُلزم الجهة المختصة ولا تُنشئ التزامًا. القبول والاعتذار من الجهة المختصة وحدها، والصمت لا يُعد قبولًا.',
    ),
  );
  let body;
  if (c.tab === 'decisions') body = decisionsBody(p, c, refresh);
  else
    body = h(
      'div',
      { class: 'card' },
      c.items.length
        ? c.items.map((r) => h('div', null, reqRow(r, ctx.me), extra(r)))
        : emptyState(
            'لا طلبات في هذا التبويب',
            c.tab === 'inbox' ? 'لا وارد جديد ينتظر اللجنة.' : 'ستظهر هنا الطلبات عندما تبلغ هذه المرحلة.',
          ),
    );
  return h('div', { class: 'stack' }, head, tabs, body);
}

function extra(r) {
  const bits = [];
  if (r.waiting_hours != null && r.ball) bits.push(`ينتظر ${r.ball.org_name || 'اللجنة'} منذ ${r.waiting_hours} ساعة`);
  if (r.referral_to) bits.push(`مُحال إلى ${r.referral_to}`);
  if (r.days_to_need != null)
    bits.push(r.impact_days ? `تجاوز الموعد المطلوب ${r.impact_days} يوم` : `مطلوب بعد ${r.days_to_need} يوم`);
  if (r.decline_reason) bits.push(`سبب الاعتذار: ${r.decline_reason}`);
  if (r.dispute?.status === 'OPEN') bits.push('خلاف اختصاص مفتوح');
  return bits.length ? h('div', { class: 'xs muted', style: { padding: '0 16px 10px' } }, bits.join(' · ')) : null;
}

function decisionsBody(p, c, refresh) {
  const actions = h(
    'div',
    { class: 'row' },
    c.can_record_decision
      ? h(
          'button',
          { class: 'btn primary', onclick: () => decisionForm(p, 'decision', refresh) },
          icon('plus', 16),
          'تسجيل قرار',
        )
      : null,
    c.can_record_minutes
      ? h(
          'button',
          { class: 'btn', onclick: () => decisionForm(p, 'minutes', refresh) },
          icon('plus', 16),
          'تسجيل محضر اجتماع',
        )
      : null,
  );
  const list = c.decisions.length
    ? h(
        'ul',
        { class: 'list' },
        c.decisions.map((d) =>
          h(
            'li',
            null,
            h(
              'div',
              { class: 'grow' },
              h(
                'div',
                { class: 'row nowrap' },
                h('b', null, d.title),
                badge(d.kind_ar, KIND_TONE[d.kind] || 'neutral'),
              ),
              h(
                'div',
                { class: 'xs muted' },
                `${d.ref} · ${d.by_name} · ${fmtDT(d.at)}${d.meeting_no ? ' · ' + d.meeting_no : ''}${d.meeting_date ? ' (' + fmtDate(d.meeting_date) + ')' : ''}`,
              ),
              h('p', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, d.body),
              d.basis ? h('div', { class: 'xs' }, `السند: ${d.basis}`) : null,
              d.request_ref ? h('div', { class: 'xs' }, `الطلب المرتبط: ${d.request_ref}`) : null,
              d.close_note ? h('div', { class: 'xs' }, `التنفيذ: ${d.close_note}`) : null,
            ),
            h(
              'div',
              { class: 'col', style: { alignItems: 'flex-end', gap: '6px' } },
              badge(...(DEC_STATUS[d.status] || [d.status, 'neutral'])),
              d.seal
                ? h(
                    'button',
                    { class: 'btn sm', title: 'ختم رقمي صادر عن المنصة (Ed25519)', onclick: () => verifySeal(d) },
                    icon('shield', 14),
                    'مختوم رقميًا — تحقق',
                  )
                : d.kind !== 'minutes'
                  ? h('span', { class: 'xs muted' }, 'سجل قبل تفعيل الختم')
                  : null,
              c.can_record_decision && d.kind !== 'minutes' && d.status === 'OPEN'
                ? h('button', { class: 'btn sm', onclick: () => closeForm(d, refresh) }, 'إقفال بعد التنفيذ')
                : null,
            ),
          ),
        ),
      )
    : emptyState(
        'لا قرارات أو محاضر مسجّلة',
        'يسجّل الرئيس القرارات بسندها، ويسجّل الرئيس أو الأمين محاضر الاجتماعات.',
      );
  return h(
    'div',
    { class: 'stack' },
    noticeEl(
      'القرار يُسجَّل بسنده ولا يُعدَّل بعد تسجيله؛ وأي قرار تنفيذي يتطلب إجراءً رسميًا منفصلًا من الجهة المعنية.',
      '',
      'info',
    ),
    actions,
    h('div', { class: 'card' }, list),
  );
}

async function verifySeal(d) {
  const v = await api.get(`/decisions/${d.id}/verify`);
  modal({
    title: `التحقق من ختم ${d.ref}`,
    body: h(
      'div',
      { class: 'stack' },
      noticeEl(
        v.valid ? 'الختم سليم: نص القرار لم يُعدَّل منذ ختمه.' : 'الختم غير مطابق: قد يكون السجل عُدّل بعد ختمه.',
        v.valid ? 'ok' : 'err',
        v.valid ? 'check' : 'alert',
      ),
      kv([
        ['الخوارزمية', v.alg],
        ['معرّف المفتاح', v.key_id],
        ['صاحب القرار', v.signer_name],
        ['وقت الختم', fmtDT(v.signed_at)],
      ]),
      h('p', { class: 'xs muted' }, v.note),
    ),
  });
}

function decisionForm(p, kind, refresh) {
  const isDec = kind === 'decision';
  formDialog({
    title: isDec ? 'تسجيل قرار للجنة' : 'تسجيل محضر اجتماع',
    wide: true,
    fields: [
      { name: 'title', label: 'العنوان', required: true },
      { name: 'body', label: isDec ? 'نص القرار' : 'ملخص المحضر', type: 'textarea', required: true, rows: 5 },
      ...(isDec
        ? [{ name: 'basis', label: 'سند القرار', required: true, hint: 'رقم المحضر أو الميثاق أو المرجع النظامي' }]
        : []),
      { name: 'meeting_no', label: 'رقم الاجتماع', half: true },
      { name: 'meeting_date', label: 'تاريخ الاجتماع', type: 'date', half: true },
    ],
    submit: 'تسجيل',
    onSubmit: async (v) => {
      await api.post(`/projects/${p.id}/decisions`, { ...v, kind, meeting_date: v.meeting_date || undefined });
      toast(isDec ? 'سُجّل القرار' : 'سُجّل المحضر', 'ok');
      refresh();
    },
  });
}
function closeForm(d, refresh) {
  formDialog({
    title: `إقفال القرار ${d.ref}`,
    fields: [{ name: 'note', label: 'ما الذي نُفّذ؟', type: 'textarea', required: true }],
    submit: 'إقفال',
    onSubmit: async (v) => {
      await api.post(`/decisions/${d.id}/close`, { note: v.note });
      toast('أُقفل القرار', 'ok');
      refresh();
    },
  });
}

/** Top-level «صندوق اللجنة»: jumps straight to the project's committee tab (or lists projects when there are several). */
export async function committeeHome({ ctx, go }) {
  const r = await api.get('/projects');
  const mine = r.items.filter((p) => p.caps.committee_role || p.caps.auditor_view);
  if (mine.length === 1) {
    go(`#/p/${mine[0].id}/committee`);
    return h('div', { class: 'empty' }, 'جارٍ الفتح…');
  }
  return {
    title: 'صندوق اللجنة',
    el: h(
      'div',
      { class: 'stack' },
      h('div', { class: 'page-head' }, h('h1', null, 'صندوق اللجنة')),
      mine.length
        ? h(
            'div',
            { class: 'grid auto' },
            mine.map((p) =>
              h(
                'a',
                { class: 'card link pad col', href: `#/p/${p.id}/committee` },
                h('h3', null, p.name),
                h('div', { class: 'small muted' }, `${p.ref} · ${p.lead_org}`),
              ),
            ),
          )
        : h(
            'div',
            { class: 'card' },
            emptyState(
              'لست عضوًا في لجنة مشروع',
              'يظهر هنا صندوق اللجنة لرئيسها ونائبها وأمينها وأعضائها.',
              null,
              'no-access',
            ),
          ),
    ),
  };
}
