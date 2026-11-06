import { api } from '../api.js';
import { h, mount, icon, toast, badge, ago, formDialog, emptyState, fmtSize } from '../ui.js';
import { noticeEl } from '../shared.js';
import { uploadFile, downloadFile, ALLOWED_ACCEPT } from '../files.js';

const KIND_HINT = {
  project: 'مع ممثلي الجهات المشاركة في المشروع',
  org: 'قناة تضم كل أعضاء جهتك',
  team: 'مجموعة من أعضاء جهتك',
  direct: 'بينك وبين شخص واحد',
  wp: 'نقاش حول حزمة عمل محددة',
  support: 'مع مشغّل المنصة للدعم الفني (لا يطّلع على محتوى المشاريع)',
};

export async function messagesView({ parts, query, ctx, go }) {
  const r = await api.get('/threads');
  const activeId = parts[0] || r.items[0]?.id;
  const list = h(
    'div',
    { class: 'chat-list' },
    r.items.map((t) =>
      h(
        'button',
        { 'aria-current': String(t.id === activeId), onclick: () => go(`#/messages/${t.id}`) },
        h(
          'div',
          { class: 'row nowrap' },
          h('b', { class: 'small grow truncate' }, t.title),
          t.unread ? badge(t.unread, 'attention') : null,
        ),
        h('div', { class: 'xs muted truncate' }, t.last ? `${t.last.by}: ${t.last.text}` : 'لا رسائل'),
        h(
          'div',
          { class: 'xs muted' },
          `${t.kind_label} · ${t.project_name || 'بلا مشروع'} · ${t.last ? ago(t.last.at) : ''}`,
        ),
      ),
    ),
  );
  const pane = h('div', { class: 'chat-pane' });
  if (activeId) {
    const t = await api.get(`/threads/${activeId}`);
    api.post(`/threads/${activeId}/read`).catch(() => {});
    const msgEl = (x) =>
      h(
        'div',
        { class: `msg${x.mine ? ' mine' : ''}${x.mentioned_me ? ' mentioned' : ''}` },
        h(
          'div',
          { class: 'by' },
          `${x.by} — ${x.org} · ${ago(x.at)}`,
          x.mentioned_me
            ? h('span', { class: 'xs', style: { marginInlineStart: '6px', color: 'var(--brand)' } }, '(أشار إليك)')
            : null,
        ),
        x.text ? h('div', { style: { whiteSpace: 'pre-wrap' } }, x.text) : null,
        (x.attachments || []).length
          ? h(
              'div',
              { class: 'row', style: { marginBlockStart: '6px', gap: '6px' } },
              x.attachments.map((a) =>
                a.can_download
                  ? h(
                      'button',
                      {
                        class: 'btn sm',
                        title: 'تنزيل المرفق',
                        onclick: () => downloadFile({ id: a.file_id, name: a.name }),
                      },
                      icon('doc', 14),
                      `${a.name} (${fmtSize(a.size)})`,
                    )
                  : h('span', { class: 'xs muted' }, `${a.name} — غير متاح لك`),
              ),
            )
          : null,
      );
    const msgs = h('div', { class: 'chat-msgs', tabindex: '0', 'aria-label': 'الرسائل' });
    const drawMsgs = (arr) =>
      mount(msgs, arr.length ? arr.map(msgEl) : h('div', { class: 'empty small' }, 'ابدأ المحادثة بأول رسالة'));
    drawMsgs(t.messages);
    const input = h('input', {
      placeholder: 'اكتب رسالة… (اكتب @ للإشارة إلى عضو)',
      'aria-label': 'رسالة',
      autocomplete: 'off',
    });
    const mentionIds = new Map(); // name -> id for @mentions inserted from the picker
    const sug = h('div', { class: 'mention-list hide', role: 'listbox', 'aria-label': 'اقتراحات الإشارة' });
    const members = t.thread.members.filter((m) => m.id !== ctx.me.user.id);
    const updateSug = () => {
      const m = /@([^\s@]*)$/.exec(input.value.slice(0, input.selectionStart ?? input.value.length));
      if (!m) {
        sug.classList.add('hide');
        return;
      }
      const hits = members.filter((x) => x.name.includes(m[1])).slice(0, 5);
      if (!hits.length) {
        sug.classList.add('hide');
        return;
      }
      mount(
        sug,
        hits.map((x) =>
          h(
            'button',
            {
              type: 'button',
              role: 'option',
              class: 'btn sm ghost',
              onclick: () => {
                const pos = input.selectionStart ?? input.value.length;
                const before = input.value.slice(0, pos).replace(/@([^\s@]*)$/, `@${x.name} `);
                input.value = before + input.value.slice(pos);
                mentionIds.set(x.name, x.id);
                sug.classList.add('hide');
                input.focus();
              },
            },
            `@${x.name}`,
            h('span', { class: 'xs muted', style: { marginInlineStart: '6px' } }, x.org),
          ),
        ),
      );
      sug.classList.remove('hide');
    };
    input.addEventListener('input', updateSug);
    // attachments: real upload into the thread's project, then referenced by id (members receive a scoped read grant server-side)
    const pending = h('div', {
      class: 'xs muted',
      role: 'status',
      'aria-live': 'polite',
      style: { padding: '0 16px' },
    });
    const chips = h('div', { class: 'row', style: { padding: '0 16px', gap: '6px' } });
    const files = [];
    const drawChips = () =>
      mount(
        chips,
        files.map((f, i) =>
          h(
            'span',
            { class: 'chip' },
            f.name,
            h(
              'button',
              {
                type: 'button',
                class: 'btn ghost sm',
                'aria-label': `إزالة ${f.name}`,
                onclick: () => {
                  files.splice(i, 1);
                  drawChips();
                },
              },
              '×',
            ),
          ),
        ),
      );
    const picker = h('input', {
      type: 'file',
      accept: ALLOWED_ACCEPT,
      class: 'sr-only',
      'aria-label': 'إرفاق ملف',
      tabindex: '-1',
    });
    picker.addEventListener('change', async () => {
      const f = picker.files[0];
      picker.value = '';
      if (!f) return;
      mount(pending, 'جارٍ رفع المرفق وفحصه…');
      try {
        const up = await uploadFile(t.thread.project_id, f);
        files.push(up);
        drawChips();
        mount(pending, '');
      } catch (e) {
        mount(pending, h('span', { style: { color: 'var(--danger)' } }, `تعذّر الإرفاق: ${e.message}`));
      }
    });
    let shown = t.messages.length;
    const send = async (payload, key) => {
      const text = payload ? payload.text : input.value.trim();
      const fl = payload ? payload.file_ids : files.map((f) => f.id);
      if (!text && !fl.length) return;
      const mentions = payload
        ? payload.mentions
        : [...mentionIds].filter(([n]) => text.includes(`@${n}`)).map(([, id]) => id);
      if (!payload) {
        input.value = '';
        files.length = 0;
        drawChips();
        mentionIds.clear();
      }
      const k = key || crypto.randomUUID?.() || String(Date.now());
      mount(pending, 'جارٍ الإرسال…');
      try {
        await api.post(`/threads/${activeId}/messages`, { text, mentions, file_ids: fl }, k);
        mount(pending, '');
        const fresh = await api.get(`/threads/${activeId}`);
        shown = fresh.messages.length;
        drawMsgs(fresh.messages);
        msgs.scrollTop = msgs.scrollHeight;
      } catch (e) {
        mount(
          pending,
          h('span', { style: { color: 'var(--danger)' } }, `تعذّر الإرسال: ${e.message} `),
          h(
            'button',
            { class: 'btn sm', onclick: () => send({ text, mentions, file_ids: fl }, k) },
            'إعادة المحاولة (لن تتكرر الرسالة)',
          ),
        );
      }
    };
    // live delivery to every open session of the other members (short polling; stops when this view is replaced)
    const timer = setInterval(async () => {
      if (!msgs.isConnected) {
        clearInterval(timer);
        return;
      }
      try {
        const fresh = await api.get(`/threads/${activeId}`);
        if (fresh.messages.length !== shown) {
          const atEnd = msgs.scrollTop + msgs.clientHeight >= msgs.scrollHeight - 40;
          shown = fresh.messages.length;
          drawMsgs(fresh.messages);
          if (atEnd) msgs.scrollTop = msgs.scrollHeight;
          api.post(`/threads/${activeId}/read`).catch(() => {});
        }
      } catch {
        /* offline: try again next tick */
      }
    }, 2500);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      }
      if (e.key === 'Escape') sug.classList.add('hide');
    });
    const canAttach = !!t.thread.project_id && t.thread.kind !== 'support';
    mount(
      pane,
      h(
        'div',
        { class: 'row', style: { padding: '10px 16px', borderBlockEnd: '1px solid var(--line)' } },
        h(
          'div',
          { class: 'grow' },
          h('b', null, t.thread.title),
          h('div', { class: 'xs muted' }, `${t.thread.kind_label} · `, t.thread.members.map((m) => m.name).join('، ')),
        ),
        t.thread.request_id
          ? h('a', { class: 'btn sm', href: `#/requests/${t.thread.request_id}` }, `فتح ${t.thread.request_ref}`)
          : null,
      ),
      h(
        'div',
        { style: { padding: '8px 16px' } },
        noticeEl(
          'المحادثة للتنسيق والاستفسار فقط. لا تُعد قبولًا ولا اعتذارًا ولا قرارًا رسميًا — القرارات تُسجَّل من صفحة الطلب.',
          '',
          'info',
        ),
      ),
      msgs,
      pending,
      chips,
      sug,
      h(
        'div',
        { class: 'chat-form' },
        input,
        canAttach
          ? [
              picker,
              h(
                'button',
                { type: 'button', class: 'btn', 'aria-label': 'إرفاق ملف', onclick: () => picker.click() },
                icon('doc', 16),
              ),
            ]
          : null,
        h('button', { class: 'btn primary', onclick: () => send() }, icon('send', 16), 'إرسال'),
      ),
    );
    setTimeout(() => {
      msgs.scrollTop = msgs.scrollHeight;
    }, 0);
  } else
    mount(pane, emptyState('لا محادثات', 'ابدأ محادثة جديدة مع فريق جهتك أو مع ممثلي المشروع.', null, 'empty-chat'));
  const el = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'page-head-main' }, h('h1', null, 'المحادثات')),
      h('button', { class: 'btn primary', onclick: () => newThread(ctx, go) }, icon('plus', 16), 'محادثة جديدة'),
    ),
    h('div', { class: 'card chat', style: { overflow: 'hidden' } }, list, pane),
  );
  if (query.new) setTimeout(() => newThread(ctx, go), 60);
  return { title: 'المحادثات', el };
}

async function newThread(ctx, go) {
  const projects = (await api.get('/projects')).items.filter((p) => p.caps.level === 'member');
  const people = await api.get('/demo/users');
  const wps = [];
  for (const p of projects) {
    try {
      const w = await api.get(`/projects/${p.id}/work-packages`);
      w.items.forEach((x) => wps.push({ value: x.id, label: `${x.ref || ''} ${x.title} — ${p.name}` }));
    } catch {
      /* not visible */
    }
  }
  const me = ctx.me.user;
  const KINDS = [
    ['project', 'قناة مشروع (مع جهات أخرى)'],
    ['direct', 'محادثة فردية'],
    ['team', 'فريق داخل جهتي'],
    ['org', 'قناة جهتي كاملة'],
    ['wp', 'حول حزمة عمل'],
    ['support', 'دعم المنصة'],
  ];
  formDialog({
    title: 'محادثة جديدة',
    fields: [
      {
        name: 'kind',
        label: 'النوع',
        type: 'select',
        placeholder: false,
        half: true,
        options: KINDS.map(([value, label]) => ({ value, label })),
        value: 'project',
        hint: Object.values(KIND_HINT).join(' · '),
      },
      { name: 'title', label: 'عنوان المحادثة (اختياري لحزمة العمل)', half: true },
      {
        name: 'project_id',
        label: 'المشروع',
        type: 'select',
        half: true,
        options: projects.map((p) => ({ value: p.id, label: p.name })),
        value: projects[0]?.id,
      },
      { name: 'wp_id', label: 'حزمة العمل (لنوع «حزمة عمل»)', type: 'select', half: true, options: wps },
      {
        name: 'member_ids',
        label: 'المشاركون (لا حاجة لهم في الدعم؛ وللقناة الكاملة يُضاف كل أعضاء الجهة)',
        type: 'checks',
        options: people.users
          .filter((u) => u.id !== me.id && !['platform', 'registry'].includes(u.org_id))
          .map((u) => ({ value: u.id, label: `${u.name} — ${u.org_name}` })),
      },
    ],
    submit: 'إنشاء',
    note: h(
      'div',
      { class: 'small muted' },
      'يرفض النظام إضافة من ليس من أطراف المشروع، وللمحادثات الداخلية أعضاء جهتك فقط. محادثة الدعم تصل إلى مشغّل المنصة وحده ولا يُرفق فيها محتوى مشاريع.',
    ),
    onSubmit: async (v) => {
      const r = await api.post('/threads', v);
      toast('أُنشئت المحادثة', 'ok');
      go(`#/messages/${r.thread.id}`);
    },
  });
}
