// DOM helpers, icons, formatting, overlays. Text is always inserted via textContent (no HTML injection).
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props)
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html')
        el.innerHTML = v; // only ever called with static icon markup
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const mount = (el, ...kids) => {
  el.replaceChildren();
  add(el, kids);
  return el;
};
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const P = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  folder: 'M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z',
  inbox: 'M3 13h5l1.5 3h5L16 13h5M4.5 5h15L21 13v6H3v-6z',
  users:
    'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM20 19v-1.2a3.2 3.2 0 0 0-2.4-3.1M15.5 4.8a3.2 3.2 0 0 1 0 6.1',
  check: 'M4.5 12.5l5 5 10-11',
  task: 'M9 6h11M9 12h11M9 18h11M4 6.5l1 1 2-2M4 12.5l1 1 2-2M4 18.5l1 1 2-2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  chat: 'M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  shield: 'M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.500-7.5-5-7.5-9.5V6z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20.5 20.500l-4.500-4.500',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.500 2h-15zM10 21h4',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  menu: 'M4 6.500h16M4 12h16M4 17.500h16',
  alert: 'M12 4l9.500 16h-19zM12 10v4.500M12 17.500v.1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.800v.1',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  flag: 'M5 21V4M5 4h11l-1.500 4 1.500 4H5',
  gantt: 'M4 6h9M8 12h12M6 18h8',
  board: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v13h-4z',
  chev: 'M15 6l-6 6 6 6',
  send: 'M21 3L10 14M21 3l-7 18-4-7-7-4z',
  moon: 'M20 14.500A8 8 0 0 1 9.500 4 8 8 0 1 0 20 14.500z',
  print: 'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z',
  lock: 'M6 11h12v9H6zM8.500 11V8a3.500 3.500 0 0 1 7 0v3',
  doc: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
};
export const icon = (name, size = 20) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name] || P.info);
  s.append(p);
  return s;
};

// ---------- formatting ----------
const dFmt = new Intl.DateTimeFormat('ar-AE-u-nu-latn-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' });
const dtFmt = new Intl.DateTimeFormat('ar-AE-u-nu-latn-ca-gregory', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
export const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  return isNaN(d) ? '—' : dFmt.format(d);
};
export const fmtDT = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d) ? '—' : dtFmt.format(d);
};
export function ago(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} د`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `قبل ${hr} س`;
  const d = Math.round(hr / 24);
  if (d < 31) return d === 1 ? 'أمس' : `قبل ${d} يومًا`;
  return fmtDate(iso);
}
export const pct = (n) => `${Math.round(n || 0)}٪`.replace(/\d/g, (c) => c);
export const num = (n) => h('span', { class: 'num' }, n);
export const initials = (name = '') =>
  name
    .replace(/^(د\.|م\.|أ\.)\s*/, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
export const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export const badge = (text, tone = 'neutral') => h('span', { class: `badge t-${tone}` }, text);
export const progressBar = (verified, operational, thin) =>
  h(
    'div',
    {
      class: `progress${thin ? ' thin' : ''}`,
      role: 'img',
      'aria-label': `منجز معتمد ${verified}٪ — تقدّم تشغيلي ${operational}٪`,
    },
    h('i', { class: 'op', style: { width: `${Math.min(100, operational || 0)}%` } }),
    h('i', { class: 'ver', style: { width: `${Math.min(100, verified || 0)}%` } }),
  );
export const avatar = (name, sm) =>
  h('span', { class: `avatar${sm ? ' sm' : ''}`, 'aria-hidden': 'true' }, initials(name));
const ARTS = new Set(['empty-requests', 'empty-tasks', 'empty-results', 'no-access', 'error', 'empty-chat']);
export const emptyState = (title, text, action, art) =>
  h(
    'div',
    { class: 'empty' },
    ARTS.has(art) &&
      h('img', { class: 'empty-art', src: `/assets/${art}.svg`, alt: '', width: 160, height: 107, loading: 'lazy' }),
    h('b', null, title),
    text && h('div', null, text),
    action,
  );

// ---------- toasts ----------
export function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, h('span', null, msg));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3800);
}

// ---------- overlays ----------
const layer = () => $('#layer');
const focusables = (root) =>
  $$(
    'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
    root,
  ).filter((e) => e.offsetParent !== null || e === document.activeElement);
function trap(root, onClose) {
  const prev = document.activeElement;
  const key = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
    if (e.key === 'Tab') {
      const f = focusables(root);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  root.addEventListener('keydown', key);
  // closing a dialog hands focus to the dialog that is still open (e.g. a completion dialog opened by a form that closes itself), otherwise back to the opener
  return () => {
    root.removeEventListener('keydown', key);
    const top = [...document.querySelectorAll('#layer [role=dialog]')]
      .filter((d) => d !== root && !root.contains(d))
      .pop();
    if (top) {
      if (!top.contains(document.activeElement)) focusables(top)[0]?.focus?.();
    } else if (prev?.isConnected) prev.focus();
    else document.getElementById('main')?.focus?.({ preventScroll: true });
  };
}

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const scrim = h('div', { class: 'scrim' });
  let release = () => {};
  const close = () => {
    release();
    scrim.remove();
    onClose?.();
  };
  const box = h(
    'div',
    { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(
      'header',
      null,
      h('h2', null, title),
      h('button', { class: 'iconbtn', 'aria-label': 'إغلاق', onclick: close }, icon('x')),
    ),
    h('div', { class: 'body' }, body),
    actions.length ? h('footer', null, actions) : null,
  );
  scrim.append(box);
  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) close();
  });
  layer().append(scrim);
  release = trap(scrim, close);
  (focusables(box).find((e) => e.matches('input,textarea,select')) || focusables(box)[0])?.focus();
  return { close, box };
}

export function drawer({ title, sub, body, footer, onClose }) {
  const scrim = h('div', { class: 'drawer-scrim' });
  let release = () => {};
  const close = () => {
    release();
    scrim.remove();
    panel.remove();
    onClose?.();
  };
  const panel = h(
    'aside',
    { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(
      'header',
      null,
      h('div', null, h('h2', null, title), sub && h('div', { class: 'small muted' }, sub)),
      h('button', { class: 'iconbtn', 'aria-label': 'إغلاق', onclick: close }, icon('x')),
    ),
    h('div', { class: 'body' }, body),
    footer ? h('footer', null, footer) : null,
  );
  scrim.addEventListener('mousedown', close);
  layer().append(scrim, panel);
  release = trap(panel, close);
  focusables(panel)[1]?.focus?.();
  return {
    close,
    panel,
    setBody: (...k) => mount($('.body', panel), ...k),
    setFooter: (...k) => {
      const f = $('footer', panel);
      if (f) mount(f, ...k);
    },
  };
}

/** Declarative form dialog. fields: [{name,label,type,required,options,hint,value,full,rows}] — returns after submit/cancel. */
export function formDialog({
  title,
  intro,
  fields,
  submit = 'حفظ',
  danger = false,
  onSubmit,
  wide = false,
  note,
  onClose,
}) {
  const inputs = {};
  const errId = `err_${Math.random().toString(36).slice(2, 7)}`;
  const errBox = h('div', { class: 'notice err hide', role: 'alert', id: errId, tabindex: '-1' });
  const form = h('form', { class: 'form-grid', novalidate: true });
  for (const f of fields) {
    let ctrl;
    if (f.type === 'textarea')
      ctrl = h('textarea', { name: f.name, rows: f.rows || 4, placeholder: f.placeholder }, f.value || '');
    else if (f.type === 'select')
      ctrl = h(
        'select',
        { name: f.name },
        f.placeholder !== false && h('option', { value: '' }, f.placeholder || '— اختر —'),
        (f.options || []).map((o) =>
          h('option', { value: o.value, selected: String(o.value) === String(f.value) ? true : null }, o.label),
        ),
      );
    else if (f.type === 'checks') {
      ctrl = h(
        'div',
        { class: 'col', style: { gap: '6px' } },
        (f.options || []).map((o) =>
          h(
            'label',
            { class: 'chk' },
            h('input', { type: 'checkbox', value: o.value, checked: (f.value || []).includes(o.value) ? true : null }),
            h('span', null, o.label),
          ),
        ),
      );
    } else if (f.type === 'lines')
      ctrl = h(
        'textarea',
        { name: f.name, rows: f.rows || 3, placeholder: f.placeholder || 'اكتب كل بند في سطر مستقل' },
        (f.value || []).join('\n'),
      );
    else
      ctrl = h('input', {
        name: f.name,
        type: f.type || 'text',
        value: f.value ?? '',
        placeholder: f.placeholder,
        min: f.min,
        max: f.max,
        dir: f.dir,
      });
    // FORM-001/002/003: required state is programmatic, autocomplete tokens and input modes help browsers and virtual keyboards
    if (f.required && ctrl.tagName !== 'DIV') ctrl.setAttribute('aria-required', 'true');
    if (ctrl.tagName === 'INPUT') {
      // FORM-002/003: tokens only where the value really is the signed-in person's own data. A member's or a project's «name» is somebody else's, so autofill is switched off there.
      const AC = new Map([
        ['email', 'email'],
        ['phone', 'tel'],
        ['mobile', 'tel'],
        ['username', 'username'],
        ['password', 'current-password'],
        ['current', 'current-password'],
        ['next', 'new-password'],
        ['otp', 'one-time-code'],
        ['code', 'one-time-code'],
      ]);
      const ac = f.autocomplete || AC.get(f.name) || 'off';
      ctrl.setAttribute('autocomplete', ac);
      if (/^(otp|code)$/.test(f.name)) {
        ctrl.setAttribute('inputmode', 'numeric');
        ctrl.setAttribute('dir', 'ltr');
      }
      if (/^(password|current|next)$/.test(f.name) && !f.type) ctrl.type = 'password';
      if (ctrl.type === 'number' && !ctrl.hasAttribute('inputmode'))
        ctrl.setAttribute('inputmode', f.step && String(f.step).includes('.') ? 'decimal' : 'numeric');
      if (/email|mail/.test(f.name) && !f.type) ctrl.type = 'email';
      if (/phone|mobile/.test(f.name) && !f.type) {
        ctrl.type = 'tel';
        ctrl.setAttribute('inputmode', 'tel');
      }
      if (ctrl.type === 'email' || ctrl.type === 'tel' || ctrl.type === 'url') ctrl.setAttribute('dir', 'ltr');
    }
    inputs[f.name] = { ctrl, f };
    form.append(
      h(
        'div',
        {
          class: `field${f.full === false ? '' : ' full'}${f.half ? '' : ''}`,
          style: f.half ? { gridColumn: 'span 1' } : undefined,
        },
        h(
          'label',
          { class: f.required ? 'req' : '', for: f.type === 'checks' ? undefined : undefined },
          f.label,
          ctrl.tagName === 'DIV' ? null : null,
        ),
        ctrl,
        f.hint && h('div', { class: 'hint' }, f.hint),
        h('div', { class: 'field-err hide', id: `fe_${errId}_${f.name}` }),
      ),
    );
    // associate label
    const lab = form.lastChild.firstChild;
    if (ctrl.tagName !== 'DIV') {
      const id = `f_${f.name}_${Math.random().toString(36).slice(2, 6)}`;
      ctrl.id = id;
      lab.setAttribute('for', id);
    }
  }
  const collect = () => {
    const out = {};
    for (const [name, { ctrl, f }] of Object.entries(inputs)) {
      if (f.type === 'checks') out[name] = [...ctrl.querySelectorAll('input:checked')].map((i) => i.value);
      else if (f.type === 'lines')
        out[name] = ctrl.value
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
      else if (f.type === 'number') out[name] = ctrl.value === '' ? null : Number(ctrl.value);
      else out[name] = ctrl.value.trim();
    }
    return out;
  };
  // FORM-006: the message is an error summary that receives focus; the offending field is marked invalid and linked to it
  const slot = (name) => form.querySelector(`#fe_${errId}_${CSS.escape(name)}`);
  const clearInvalid = () =>
    Object.entries(inputs).forEach(([name, { ctrl }]) => {
      ctrl.removeAttribute('aria-invalid');
      if (
        (ctrl.getAttribute('aria-describedby') || '').includes('fe_' + errId) ||
        ctrl.getAttribute('aria-describedby') === errId
      )
        ctrl.removeAttribute('aria-describedby');
      const sl = slot(name);
      if (sl) {
        sl.textContent = '';
        sl.classList.add('hide');
      }
    });
  const mark = (name, msg) => {
    const c = inputs[name]?.ctrl;
    if (!c) return false;
    const sl = slot(name);
    if (sl) {
      sl.textContent = msg;
      sl.classList.remove('hide');
    }
    if (c.tagName !== 'DIV') {
      c.setAttribute('aria-invalid', 'true');
      c.setAttribute('aria-describedby', sl ? sl.id : errId);
    }
    return true;
  };
  // one message (optionally tied to one field) or the server's {field: message} map: inline message per field + a focused summary that links to each field
  const showErr = (m, field, fields) => {
    clearInvalid();
    errBox.replaceChildren();
    const known = Object.entries(fields || {}).filter(([k]) => inputs[k]);
    if (known.length) {
      errBox.append(
        h('b', null, known.length === 1 ? 'راجع الحقل التالي:' : `راجع ${known.length} حقول:`),
        h(
          'ul',
          null,
          known.map(([k, msg]) => {
            mark(k, msg);
            return h(
              'li',
              null,
              h(
                'a',
                {
                  href: '#',
                  onclick: (e) => {
                    e.preventDefault();
                    inputs[k].ctrl.querySelector?.('input,select,textarea')?.focus?.();
                    inputs[k].ctrl.focus?.();
                  },
                },
                `${inputs[k].f.label}: ${msg}`,
              ),
            );
          }),
        ),
      );
    } else {
      errBox.textContent = m;
      if (field) mark(field, m);
    }
    errBox.classList.remove('hide');
    errBox.focus?.({ preventScroll: false });
  };
  const go = async () => {
    const vals = collect();
    for (const [name, { f }] of Object.entries(inputs)) {
      const v = vals[name];
      if (f.required && (v === '' || v === null || (Array.isArray(v) && !v.length))) {
        showErr(`الحقل «${f.label}» مطلوب`, name);
        return;
      }
    }
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    errBox.classList.add('hide');
    try {
      await onSubmit(vals);
      m.close();
    } catch (e) {
      btn.removeAttribute('aria-busy');
      showErr(
        e.status === 0
          ? `${e.message} لم يُفقد ما كتبتَه: اضغط «${submit}» مجددًا عند عودة الاتصال.`
          : e.message || 'تعذّر الحفظ',
        e.details?.field,
        e.details?.fields,
      );
      btn.disabled = false;
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    go();
  });
  const btn = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: go }, submit);
  const m = modal({
    title,
    wide,
    onClose,
    body: [intro && h('p', { class: 'muted' }, intro), note, form, errBox],
    actions: [btn, h('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'إلغاء')],
  });
  return m;
}

export function confirmDialog({ title, text, ok = 'تأكيد', danger = false }) {
  return new Promise((res) => {
    let done = false;
    const fin = (v) => {
      if (!done) {
        done = true;
        res(v);
      }
    };
    const m = modal({
      title,
      body: h('p', null, text),
      onClose: () => fin(false),
      actions: [
        h(
          'button',
          {
            class: `btn ${danger ? 'danger' : 'primary'}`,
            onclick: () => {
              fin(true);
              m.close();
            },
          },
          ok,
        ),
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'إلغاء'),
      ],
    });
  });
}

export function popover(anchor, content, { onClose } = {}) {
  const r = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'popover' }, content);
  const scrim = h('div', { style: { position: 'fixed', inset: 0, zIndex: 119 } });
  layer().append(scrim, pop);
  const w = pop.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left));
  Object.assign(pop.style, { top: `${r.bottom + 6}px`, left: `${left}px` });
  // CMP/A11Y-015: the trigger exposes whether its popup is open
  anchor.setAttribute('aria-haspopup', 'true');
  anchor.setAttribute('aria-expanded', 'true');
  const close = () => {
    anchor.setAttribute('aria-expanded', 'false');
    release();
    scrim.remove();
    pop.remove();
    onClose?.();
  };
  const release = trap(pop, close);
  scrim.addEventListener('mousedown', close);
  return { close, el: pop };
}

/** Runs an async action with a busy state on the button, surfaces API errors as toasts. */
export async function run(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try {
    const r = await fn();
    if (okMsg) toast(okMsg, 'ok');
    return r;
  } catch (e) {
    toast(e.message || 'تعذّر تنفيذ الإجراء', 'err');
    throw e;
  } finally {
    if (btn) btn.disabled = false;
  }
}
