// Small local SVG chart kit (no external library). Every chart: role=img with a text summary, direct value labels, and an equivalent data table behind a toggle.
// Colours come from CSS classes (CSP forbids inline styles); status colours are never the only carrier of meaning — labels and numbers are always drawn.
import { h } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  kids.flat().forEach((c) => {
    if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return el;
};
const rtl = () => document.documentElement.dir === 'rtl';
const num = (n) => new Intl.NumberFormat(document.documentElement.lang === 'en' ? 'en' : 'ar-AE-u-nu-latn').format(n);
const TONES = ['neutral', 'info', 'attention', 'success', 'danger', 'progress', 'done'];
const tone = (t) => `ch-${TONES.includes(t) ? t : 'neutral'}`;

// A chart card: title, optional caption, the figure, a legend, and "show as table".
export function chartCard({ title, caption, summary, figure, legend, table, wide }) {
  const tbl = table
    ? h(
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
                table.head.map((x) => h('th', { scope: 'col' }, x)),
              ),
            ),
            h(
              'tbody',
              null,
              table.rows.map((r) =>
                h(
                  'tr',
                  null,
                  r.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, c) : h('td', { class: 'num' }, c))),
                ),
              ),
            ),
          ),
        ),
      )
    : null;
  const wrap = h(
    'figure',
    { class: `card ch-card${wide ? ' wide' : ''}`, 'aria-label': title },
    h('figcaption', { class: 'ch-h' }, h('h2', null, title), caption ? h('div', { class: 'xs muted' }, caption) : null),
    figure,
    legend || null,
    tbl,
  );
  if (summary)
    (figure.matches('svg') ? figure : figure.querySelector('svg') || figure).setAttribute('aria-label', summary);
  return wrap;
}

export const legend = (items) =>
  h(
    'ul',
    { class: 'ch-legend' },
    items.map((i) =>
      h(
        'li',
        null,
        h('i', { class: `sw ${i.cls || tone(i.tone)}` }),
        i.label,
        i.value != null ? h('b', { class: 'num' }, num(i.value)) : null,
      ),
    ),
  );

// Donut with the total in the centre. items: [{label,count,tone}]
export function donut(items, { size = 180, centre = 'الإجمالي' } = {}) {
  const total = items.reduce((a, b) => a + b.count, 0);
  const R = 70,
    r = 46,
    c = size / 2;
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', class: 'ch-svg' });
  if (!total) {
    svg.append(
      s('circle', { cx: c, cy: c, r: (R + r) / 2, class: 'ch-track', 'stroke-width': R - r, fill: 'none' }),
      s('text', { x: c, y: c + 5, class: 'ch-ctr', 'text-anchor': 'middle' }, '٠'),
    );
    return svg;
  }
  let a0 = -Math.PI / 2;
  const pt = (rad, a) => [c + rad * Math.cos(a), c + rad * Math.sin(a)];
  const live = items.filter((i) => i.count > 0);
  for (const it of live) {
    const frac = it.count / total;
    const a1 = a0 + (live.length === 1 ? 2 * Math.PI - 0.0001 : frac * 2 * Math.PI - 0.02);
    const [x0, y0] = pt(R, a0),
      [x1, y1] = pt(R, a1),
      [x2, y2] = pt(r, a1),
      [x3, y3] = pt(r, a0);
    const big = a1 - a0 > Math.PI ? 1 : 0;
    svg.append(
      s(
        'path',
        {
          d: `M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z`,
          class: `ch-fill ${tone(it.tone)}`,
        },
        s('title', {}, `${it.label}: ${num(it.count)}`),
      ),
    );
    a0 += frac * 2 * Math.PI;
  }
  svg.append(
    s('text', { x: c, y: c + 2, class: 'ch-ctr', 'text-anchor': 'middle' }, num(total)),
    s('text', { x: c, y: c + 20, class: 'ch-sub', 'text-anchor': 'middle' }, centre),
  );
  return svg;
}

// Horizontal bars; each row: label, bar, value. rows: [{label,value,tone,note}]
export function hbars(rows, { max, unit = '' } = {}) {
  const m = max || Math.max(1, ...rows.map((r) => r.value));
  return h(
    'div',
    { class: 'ch-hbars', role: 'img' },
    rows.map((r) =>
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'l' }, r.label),
        h(
          'span',
          { class: 'track' },
          h('span', { class: `fill ${tone(r.tone)}`, dataset: { w: Math.round((r.value / m) * 100) } }),
        ),
        h('b', { class: 'v num' }, `${num(r.value)}${unit}`),
        r.note ? h('span', { class: 'xs muted n' }, r.note) : null,
      ),
    ),
  );
}

// Stacked columns. cols: [{label, parts:[{value,cls,label}]}]
export function columns(cols, { height = 150 } = {}) {
  const W = Math.max(320, cols.length * 56);
  const pad = { t: 14, b: 34, l: 6, r: 6 };
  const H = height + pad.t + pad.b;
  const tot = cols.map((c) => c.parts.reduce((a, b) => a + b.value, 0));
  const max = Math.max(1, ...tot);
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'ch-svg wide',
    role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
  });
  const bw = Math.min(30, (W - pad.l - pad.r) / cols.length - 10);
  svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: pad.t + height, y2: pad.t + height, class: 'ch-axis' }));
  cols.forEach((c, i) => {
    const slot = (W - pad.l - pad.r) / cols.length;
    const idx = rtl() ? cols.length - 1 - i : i;
    const cx = pad.l + slot * idx + slot / 2;
    let y = pad.t + height;
    for (const p of c.parts) {
      if (!p.value) continue;
      const hh = Math.max(2, (p.value / max) * height);
      y -= hh;
      svg.append(
        s(
          'rect',
          { x: cx - bw / 2, y, width: bw, height: hh, rx: 2, class: `ch-fill ${p.cls}` },
          s('title', {}, `${c.label} — ${p.label}: ${num(p.value)}`),
        ),
      );
    }
    if (tot[i]) svg.append(s('text', { x: cx, y: y - 4, class: 'ch-val', 'text-anchor': 'middle' }, num(tot[i])));
    svg.append(s('text', { x: cx, y: H - 12, class: 'ch-tick', 'text-anchor': 'middle' }, c.label));
  });
  return svg;
}

// Two-series cumulative line chart over months (planned vs accepted). pts: [{at, planned, accepted|null}]. Time runs in reading direction.
export function lines(pts, { today, height = 170 } = {}) {
  const W = 560,
    pad = { t: 16, b: 30, l: 38, r: 38 };
  const H = height + pad.t + pad.b;
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'ch-svg wide',
    role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
  });
  const n = pts.length;
  const iw = W - pad.l - pad.r;
  const X = (i) =>
    rtl() ? pad.l + iw - (n === 1 ? iw / 2 : (i / (n - 1)) * iw) : pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const Y = (v) => pad.t + height - (Math.min(100, v) / 100) * height;
  for (const g of [0, 25, 50, 75, 100])
    svg.append(
      s('line', { x1: pad.l, x2: W - pad.r, y1: Y(g), y2: Y(g), class: g ? 'ch-grid' : 'ch-axis' }),
      s(
        'text',
        { x: rtl() ? W - 4 : 4, y: Y(g) + 4, class: 'ch-tick', 'text-anchor': rtl() ? 'start' : 'start' },
        `${num(g)}٪`,
      ),
    );
  const path = (key) => {
    let d = '';
    pts.forEach((p, i) => {
      if (p[key] == null) return;
      d += `${d ? 'L' : 'M'}${X(i)},${Y(p[key])}`;
    });
    return d;
  };
  if (n > 1)
    svg.append(
      s('path', { d: path('planned'), class: 'ch-line plan', fill: 'none' }),
      s('path', { d: path('accepted'), class: 'ch-line acc', fill: 'none' }),
    );
  pts.forEach((p, i) => {
    svg.append(
      s(
        'circle',
        { cx: X(i), cy: Y(p.planned), r: 3, class: 'ch-dot plan' },
        s('title', {}, `${p.at}: المخطّط ${num(p.planned)}٪`),
      ),
    );
    if (p.accepted != null)
      svg.append(
        s(
          'circle',
          { cx: X(i), cy: Y(p.accepted), r: 3.5, class: 'ch-dot acc' },
          s('title', {}, `${p.at}: المقبول ${num(p.accepted)}٪`),
        ),
      );
  });
  const step = Math.ceil(n / 6);
  const mo = (iso) =>
    new Date(iso + 'T00:00:00Z').toLocaleDateString(document.documentElement.lang === 'en' ? 'en' : 'ar-AE-u-nu-latn', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
  pts.forEach((p, i) => {
    if (i % step === 0 || i === n - 1)
      svg.append(s('text', { x: X(i), y: H - 10, class: 'ch-tick', 'text-anchor': 'middle' }, mo(p.at)));
  });
  if (today) {
    const k = pts.findIndex((p) => p.at >= today);
    if (k >= 0)
      svg.append(
        s('line', { x1: X(k), x2: X(k), y1: pad.t, y2: pad.t + height, class: 'ch-today' }),
        s('text', { x: X(k), y: pad.t - 3, class: 'ch-tick', 'text-anchor': 'middle' }, 'اليوم'),
      );
  }
  return svg;
}

// width is data-driven but styles are CSP-restricted: apply with the CSSOM after insertion
export function applyWidths(root) {
  root.querySelectorAll('[data-w]').forEach((e) => {
    e.style.width = `${e.dataset.w}%`;
  });
}
