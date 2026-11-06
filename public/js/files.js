// File helpers: real upload (base64 → /files), authenticated download, and the owner's access-grant dialog.
import { api, authHeaders } from './api.js';
import { h, toast, modal, formDialog, badge, fmtSize, fmtDT } from './ui.js';

export const ALLOWED_ACCEPT = '.pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx';
export const MAX_MB = 8;

const toBase64 = (buf) => {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Uploads one chosen file into a project's file store; returns the stored file record. Server checks type, size, content and signature. */
export async function uploadFile(projectId, file, { supersedes, onStatus } = {}) {
  if (!file) return null;
  if (file.size > MAX_MB * 1048576) throw Object.assign(new Error(`حجم الملف أكبر من ${MAX_MB} م.ب`), { status: 413 });
  onStatus?.(`جارٍ رفع «${file.name}» (${fmtSize(file.size)}) وفحصه…`);
  try {
    const content_base64 = toBase64(await file.arrayBuffer());
    const f = (
      await api.post('/files', {
        project_id: projectId,
        name: file.name,
        content_base64,
        supersedes_file_id: supersedes,
      })
    ).file;
    onStatus?.(`تم رفع «${file.name}» وفحصه`);
    return f;
  } catch (e) {
    onStatus?.(`تعذّر رفع «${file.name}»: ${e.message}`);
    throw e;
  }
}

/** A labelled file input with a hint of what is accepted. */
export function fileField(label = 'الملف') {
  // CMP-013/014: the label, the allowed types/size and a live status line are all programmatically tied to the input; ids are unique per field
  const uid = Math.random().toString(36).slice(2, 7);
  const input = h('input', {
    type: 'file',
    accept: ALLOWED_ACCEPT,
    id: `file_${uid}`,
    'aria-describedby': `file-hint-${uid} file-state-${uid}`,
  });
  const hint = h(
    'div',
    { class: 'xs muted', id: `file-hint-${uid}` },
    `المسموح: PDF، صور PNG/JPG، نص/CSV، DOCX، XLSX — حتى ${MAX_MB} م.ب. يُفحص نوع الملف ومحتواه في الخادم، وتُحسب بصمته SHA-256.`,
  );
  const state = h('div', { class: 'xs', id: `file-state-${uid}`, role: 'status', 'aria-live': 'polite' });
  input.addEventListener('change', () => {
    const f = input.files[0];
    state.textContent = f
      ? `المختار: ${f.name} (${fmtSize(f.size)})${f.size > MAX_MB * 1048576 ? ` — أكبر من الحد ${MAX_MB} م.ب` : ''}`
      : '';
  });
  return {
    input,
    el: h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hint, state),
    state,
    hint,
    status: (m) => {
      state.textContent = m;
    },
  };
}

/** Authenticated download (the session header cannot be sent by a plain link). */
export async function downloadFile(file) {
  try {
    const res = await fetch(`/api/v1/files/${file.id || file}/download`, { headers: authHeaders() });
    if (!res.ok) {
      let m = 'لا تملك منحة الاطلاع على هذا الملف';
      try {
        m = (await res.json()).error?.message || m;
      } catch {
        /* keep */
      }
      toast(m, 'err');
      return;
    }
    const blob = await res.blob();
    const a = h('a', { href: URL.createObjectURL(blob), download: file.name || 'file' });
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  } catch {
    toast('تعذّر تنزيل الملف', 'err');
  }
}

/** Download button shown only when the server says the viewer holds a grant. */
export const fileButton = (e, share = {}) =>
  e.file_id && e.can_download
    ? h(
        'span',
        { class: 'row nowrap' },
        h('button', { class: 'btn sm', onclick: () => downloadFile({ id: e.file_id, name: e.file_name }) }, 'تنزيل'),
        e.can_grant
          ? h('button', { class: 'btn sm', onclick: () => grantsDialog(e.file_meta, share) }, 'من يطّلع؟')
          : null,
      )
    : e.file_id
      ? h('span', { class: 'xs muted' }, 'الملف غير متاح لجهتك')
      : h('span', { class: 'xs muted' }, 'سجل بيانات فقط');

/** Owner view: who can read the file; grant / revoke with a written reason. */
export async function grantsDialog(file, { orgs = [], users = [] } = {}) {
  if (!orgs.length && file.project_id) {
    try {
      const t = await api.get(`/projects/${file.project_id}/team`);
      orgs = t.orgs.filter((o) => o.id !== undefined).map((o) => ({ id: o.id, name: o.name }));
    } catch {
      /* the owner can still grant to the committee */
    }
  }
  let list;
  try {
    list = (await api.get(`/files/${file.id}/grants`)).items;
  } catch (e) {
    toast(e.message, 'err');
    return;
  }
  const rows = list
    .filter((g) => !g.revoked)
    .map((g) =>
      h(
        'li',
        null,
        h(
          'div',
          { class: 'grow' },
          h('b', null, g.grantee_label),
          h('div', { class: 'xs muted' }, `${g.by_name || ''} · ${fmtDT(g.at)} — ${g.reason || ''}`),
        ),
        g.grantee_type === 'role' || g.grantee_type === 'committee'
          ? badge(g.grantee_type === 'role' ? 'تلقائي' : 'اللجنة', 'neutral')
          : null,
        h(
          'button',
          {
            class: 'btn sm danger',
            onclick: async () => {
              try {
                await api.post(`/files/${file.id}/grants/${g.id}/revoke`);
                toast('سُحبت المنحة', 'ok');
                m.close();
                grantsDialog(file, { orgs, users });
              } catch (e) {
                toast(e.message, 'err');
              }
            },
          },
          'سحب',
        ),
      ),
    );
  const m = modal({
    title: `الاطلاع على الملف — ${file.name}`,
    wide: true,
    body: [
      h(
        'p',
        { class: 'small muted' },
        `${fmtSize(file.size)} · الإصدار ${file.version} · SHA-256 ${String(file.sha256 || '').slice(0, 16)}… — لا يطّلع على الملف إلا من يملك منحة صريحة.`,
      ),
      rows.length
        ? h('ul', { class: 'list' }, rows)
        : h('div', { class: 'small muted' }, 'لا منح حالية غير مالك الملف.'),
    ],
    actions: [
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () =>
            formDialog({
              title: 'منح اطلاع',
              fields: [
                {
                  name: 'grantee_type',
                  label: 'المستفيد',
                  type: 'select',
                  placeholder: false,
                  options: [
                    { value: 'org', label: 'جهة مشاركة' },
                    { value: 'user', label: 'شخص' },
                    { value: 'committee', label: 'لجنة المشروع' },
                  ],
                  value: 'org',
                },
                {
                  name: 'grantee_id',
                  label: 'الجهة / الشخص',
                  type: 'select',
                  options: [
                    ...orgs.map((o) => ({ value: o.id, label: `جهة: ${o.name}` })),
                    ...users.map((u) => ({ value: u.id, label: `شخص: ${u.name}` })),
                  ],
                  hint: 'اتركه فارغًا عند اختيار «لجنة المشروع»',
                },
                { name: 'reason', label: 'سبب المنح', type: 'textarea', required: true },
              ],
              submit: 'منح الاطلاع',
              onSubmit: async (v) => {
                await api.post(`/files/${file.id}/grants`, v);
                toast('مُنح الاطلاع وسُجّل في التدقيق', 'ok');
                m.close();
                grantsDialog(file, { orgs, users });
              },
            }),
        },
        'منح اطلاع جديد',
      ),
      h('button', { class: 'btn ghost', onclick: () => m.close() }, 'إغلاق'),
    ],
  });
}

/** Restricted CSV export (server checks role, scope, logs it to the audit trail). */
export async function downloadExport(what, params = {}, filename) {
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`/api/v1/export/${what}${qs ? '?' + qs : ''}`, { headers: authHeaders() });
    if (!res.ok) {
      let m = 'التصدير غير متاح لدورك';
      try {
        m = (await res.json()).error?.message || m;
      } catch {
        /* keep */
      }
      toast(m, 'err');
      return;
    }
    const blob = await res.blob();
    const a = h('a', { href: URL.createObjectURL(blob), download: filename || `mihwar-${what}.csv` });
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
    toast('نُزّل الملف وسُجّل التصدير في التدقيق', 'ok');
  } catch {
    toast('تعذّر التصدير', 'err');
  }
}
