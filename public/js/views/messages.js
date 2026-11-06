import { api } from '../api.js';
import { h, mount, icon, toast, ago, formDialog, emptyState, fmtSize, initials } from '../ui.js';
import { uploadFile, downloadFile, ALLOWED_ACCEPT } from '../files.js';

const KIND_HINT = {
  project: 'مع ممثلي الجهات المشاركة في المشروع',
  org: 'قناة تضم كل أعضاء جهتك',
  team: 'مجموعة من أعضاء جهتك',
  direct: 'بينك وبين شخص واحد',
  wp: 'نقاش حول حزمة عمل محددة',
  support: 'مع مشغّل المنصة للدعم الفني (لا يطّلع على محتوى المشاريع)',
};

// chat list filters (WhatsApp-style chips): direct conversations vs. project-bound ones vs. internal agency channels
const FILTERS = [
  ['all', 'الكل', () => true],
  ['unread', 'غير مقروءة', (t) => t.unread > 0],
  ['direct', 'مباشرة', (t) => t.kind === 'direct'],
  ['project', 'المشاريع', (t) => ['project', 'wp', 'request'].includes(t.kind)],
  ['org', 'جهتي', (t) => ['org', 'team', 'support'].includes(t.kind)],
];
const KIND_ICON = { project: 'folder', wp: 'gantt', request: 'inbox', org: 'home', team: 'task', support: 'shield' };
let chatFilter = 'all';

const dayKey = (iso) => new Date(iso).toDateString();
const clock = (iso) => new Date(iso).toLocaleTimeString('ar-AE-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'اليوم';
  if (d.toDateString() === y.toDateString()) return 'أمس';
  return d.toLocaleDateString('ar-AE-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
};
/** List timestamp: time for today, «أمس», otherwise a short date. */
const listTime = (iso) => {
  if (!iso) return '';
  const l = dayLabel(iso);
  if (l === 'اليوم') return clock(iso);
  if (l === 'أمس') return l;
  return new Date(iso).toLocaleDateString('ar-AE-u-nu-latn', { day: 'numeric', month: 'numeric' });
};
// a stable colour per sender in group chats (like WhatsApp's coloured names)
const senderTone = (id) => [...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 6;

const threadAvatar = (t, meId) => {
  if (t.kind === 'direct') {
    const other = t.members.find((m) => m.id !== meId) || t.members[0];
    return h('span', { class: 'chat-av', 'aria-hidden': 'true' }, initials(other?.name || t.title));
  }
  return h('span', { class: `chat-av k-${t.kind}`, 'aria-hidden': 'true' }, icon(KIND_ICON[t.kind] || 'chat', 20));
};

export async function messagesView({ parts, query, ctx, go }) {
  const r = await api.get('/threads');
  const meId = ctx.me.user.id;
  const items = [...r.items].sort((a, b) => (b.last?.at || '').localeCompare(a.last?.at || ''));
  // on a phone the list and the conversation are separate screens; on a wide screen the first conversation opens beside the list
  const activeId = parts[0] || (window.innerWidth > 760 ? items[0]?.id : null);
  const search = h('input', {
    type: 'search',
    class: 'chat-search',
    placeholder: 'بحث في المحادثات',
    'aria-label': 'بحث في المحادثات',
  });
  const chipsBar = h('div', { class: 'chat-filters', role: 'group', 'aria-label': 'تصفية المحادثات' });
  const listBody = h('div', { class: 'chat-items' });
  const drawList = () => {
    const q = search.value.trim();
    const pass = FILTERS.find(([k]) => k === chatFilter)[2];
    const shown = items.filter(
      (t) => pass(t) && (!q || `${t.title} ${t.project_name || ''} ${t.last?.text || ''}`.includes(q)),
    );
    mount(
      chipsBar,
      FILTERS.map(([k, l]) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(k === chatFilter),
            onclick: () => {
              chatFilter = k;
              drawList();
            },
          },
          l,
          k === 'unread' && items.some((t) => t.unread) ? ` ${items.filter((t) => t.unread).length}` : '',
        ),
      ),
    );
    mount(
      listBody,
      shown.length
        ? shown.map((t) =>
            h(
              'button',
              {
                class: `chat-item${t.unread ? ' unread' : ''}`,
                'aria-current': String(t.id === activeId),
                onclick: () => go(`#/messages/${t.id}`),
              },
              threadAvatar(t, meId),
              h(
                'span',
                { class: 'chat-item-main' },
                h(
                  'span',
                  { class: 'chat-item-top' },
                  h('b', { class: 'truncate' }, t.title),
                  h('span', { class: 'chat-time' }, listTime(t.last?.at)),
                ),
                h(
                  'span',
                  { class: 'chat-item-bottom' },
                  h(
                    'span',
                    { class: 'truncate' },
                    t.last ? `${t.last.by === ctx.me.user.name ? 'أنت' : t.last.by}: ${t.last.text}` : 'لا رسائل بعد',
                  ),
                  t.unread ? h('span', { class: 'chat-unread' }, t.unread) : null,
                ),
                h(
                  'span',
                  { class: 'chat-item-meta truncate' },
                  t.kind_label,
                  t.project_name ? ` · ${t.project_name}` : '',
                ),
              ),
            ),
          )
        : h('div', { class: 'empty small' }, q ? 'لا نتائج' : 'لا محادثات في هذا التصنيف'),
    );
  };
  search.addEventListener('input', drawList);
  drawList();
  const list = h(
    'div',
    { class: 'chat-list' },
    h('div', { class: 'chat-list-head' }, search, chipsBar),
    listBody,
  );
  const pane = h('div', { class: 'chat-pane' });
  if (activeId) {
    const t = await api.get(`/threads/${activeId}`);
    api.post(`/threads/${activeId}/read`).catch(() => {});
    const group = t.thread.kind !== 'direct';
    const msgEl = (x, prev) => {
      const cont = prev && prev.user_id === x.user_id && dayKey(prev.at) === dayKey(x.at);
      return h(
        'div',
        {
          class: `msg${x.mine ? ' mine' : ''}${x.mentioned_me ? ' mentioned' : ''}${cont ? ' cont' : ''}`,
        },
        !x.mine && group && !cont
          ? h('div', { class: `by tone-${senderTone(x.user_id)}` }, x.by, h('span', { class: 'org' }, x.org))
          : null,
        x.mentioned_me ? h('div', { class: 'xs mention-flag' }, 'أشار إليك') : null,
        x.text ? h('div', { class: 'msg-text' }, x.text) : null,
        (x.attachments || []).length
          ? h(
              'div',
              { class: 'msg-files' },
              x.attachments.map((a) =>
                a.can_download
                  ? h(
                      'button',
                      {
                        class: 'msg-file',
                        title: 'تنزيل المرفق',
                        onclick: () => downloadFile({ id: a.file_id, name: a.name }),
                      },
                      icon('doc', 18),
                      h('span', { class: 'truncate' }, a.name),
                      h('span', { class: 'xs muted' }, fmtSize(a.size)),
                    )
                  : h('span', { class: 'xs muted' }, `${a.name} — غير متاح لك`),
              ),
            )
          : null,
        h('time', { class: 'msg-time', datetime: x.at, title: ago(x.at) }, clock(x.at)),
      );
    };
    const msgs = h('div', { class: 'chat-msgs', tabindex: '0', 'aria-label': 'الرسائل' });
    const drawMsgs = (arr) => {
      const out = [
        h(
          'div',
          { class: 'chat-sys' },
          icon('lock', 13),
          'المحادثة للتنسيق والاستفسار فقط، ولا تُعد قبولًا ولا اعتذارًا ولا قرارًا رسميًا — القرارات تُسجَّل من صفحة الطلب.',
        ),
      ];
      arr.forEach((x, i) => {
        if (!i || dayKey(arr[i - 1].at) !== dayKey(x.at)) out.push(h('div', { class: 'chat-day' }, dayLabel(x.at)));
        out.push(msgEl(x, arr[i - 1]));
      });
      if (!arr.length) out.push(h('div', { class: 'chat-day' }, 'ابدأ المحادثة بأول رسالة'));
      mount(msgs, out);
    };
    drawMsgs(t.messages);
    const input = h('textarea', {
      rows: '1',
      placeholder: 'اكتب رسالة… (@ للإشارة إلى عضو)',
      'aria-label': 'رسالة',
      autocomplete: 'off',
    });
    const grow = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    };
    input.addEventListener('input', grow);
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
        grow();
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
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
      if (e.key === 'Escape') sug.classList.add('hide');
    });
    const canAttach = !!t.thread.project_id && t.thread.kind !== 'support';
    const th = t.thread;
    const others = th.members.filter((m) => m.id !== meId);
    const subtitle =
      th.kind === 'direct'
        ? others[0]?.org || ''
        : [th.kind_label, th.project_name, th.wp_ref, `${th.members.length} أعضاء`].filter(Boolean).join(' · ');
    const membersBox = h(
      'div',
      { class: 'chat-members', hidden: true },
      th.members.map((m) =>
        h('span', { class: 'chip' }, m.id === meId ? 'أنت' : m.name, h('span', { class: 'muted' }, ` · ${m.org}`)),
      ),
    );
    mount(
      pane,
      h(
        'div',
        { class: 'chat-head' },
        h(
          'a',
          { class: 'btn ghost sm chat-back', href: '#/messages/', 'aria-label': 'العودة إلى قائمة المحادثات' },
          icon('chev', 18),
        ),
        threadAvatar(th, meId),
        h(
          'button',
          {
            type: 'button',
            class: 'chat-head-main',
            'aria-expanded': 'false',
            title: 'عرض الأعضاء',
            onclick: (e) => {
              membersBox.hidden = !membersBox.hidden;
              e.currentTarget.setAttribute('aria-expanded', String(!membersBox.hidden));
            },
          },
          h('b', { class: 'truncate' }, th.title),
          h('span', { class: 'xs muted truncate' }, subtitle),
        ),
        th.request_id ? h('a', { class: 'btn sm', href: `#/requests/${th.request_id}` }, `فتح ${th.request_ref}`) : null,
        th.project_id && th.kind !== 'support'
          ? h(
              'a',
              { class: 'btn ghost sm', href: `#/projects/${th.project_id}`, 'aria-label': 'فتح المشروع', title: 'فتح المشروع' },
              icon('folder', 16),
            )
          : null,
      ),
      membersBox,
      msgs,
      pending,
      chips,
      sug,
      h(
        'div',
        { class: 'chat-form' },
        canAttach
          ? [
              picker,
              h(
                'button',
                {
                  type: 'button',
                  class: 'chat-round',
                  'aria-label': 'إرفاق ملف',
                  title: 'إرفاق ملف',
                  onclick: () => picker.click(),
                },
                icon('doc', 18),
              ),
            ]
          : null,
        input,
        h(
          'button',
          { class: 'chat-round send', 'aria-label': 'إرسال', title: 'إرسال (Enter) — سطر جديد Shift+Enter', onclick: () => send() },
          icon('send', 18),
        ),
      ),
    );
    setTimeout(() => {
      msgs.scrollTop = msgs.scrollHeight;
    }, 0);
  } else
    mount(
      pane,
      h(
        'div',
        { class: 'chat-blank' },
        emptyState(
          items.length ? 'اختر محادثة' : 'لا محادثات',
          items.length
            ? 'اختر محادثة من القائمة لعرض رسائلها.'
            : 'ابدأ محادثة جديدة مع فريق جهتك أو مع ممثلي المشروع.',
          null,
          'empty-chat',
        ),
      ),
    );
  const el = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'page-head-main' }, h('h1', null, 'المحادثات')),
      h('button', { class: 'btn primary', onclick: () => newThread(ctx, go) }, icon('plus', 16), 'محادثة جديدة'),
    ),
    h('div', { class: `card chat${activeId ? ' has-active' : ''}` }, list, pane),
  );
  // the chat fills exactly the space left under the page header (and above the phone's bottom bar), so the composer is always on screen
  const box = el.querySelector('.chat');
  const fit = () => {
    if (!box.isConnected) return window.removeEventListener('resize', fit);
    const bottomBar = [...document.querySelectorAll('nav')].find(
      (n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().top > window.innerHeight / 2,
    );
    const bottom = bottomBar ? window.innerHeight - bottomBar.getBoundingClientRect().top : 0;
    box.style.height = `${Math.max(380, window.innerHeight - box.getBoundingClientRect().top - bottom - 12)}px`;
  };
  window.addEventListener('resize', fit);
  setTimeout(fit, 0);
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
