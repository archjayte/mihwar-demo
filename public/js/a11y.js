// Runtime accessibility/RTL enhancer (WCAG 1.3.1, 1.3.2; factory controls A11Y-019, RTL-005).
//  - every data table gets a caption (visually hidden) and scoped header cells
//  - reference numbers / Latin identifiers / phone numbers are isolated with <bdi> so they never reorder inside Arabic text
// Idempotent: running it twice changes nothing, so the debounced MutationObserver settles after one pass.
const REF =
  /\b(?:[A-Z]{1,6}-)+[A-Z0-9]{1,}(?:-[A-Z0-9]+)*\b|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|\+?\d[\d\s-]{8,}\d/g;
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'BDI', 'CODE', 'PRE', 'OPTION', 'NOSCRIPT']);

function labelFor(table) {
  const own = table.getAttribute('aria-label');
  if (own) return own;
  const sec = table.closest('section, [role=dialog], .drawer, .card');
  const hd = sec?.querySelector('h2, h3, h4, [id$=-title]');
  if (hd?.textContent.trim()) return hd.textContent.trim();
  const dlg = table.closest('[aria-label]');
  if (dlg) return dlg.getAttribute('aria-label');
  return document.querySelector('#main h1')?.textContent.trim() || document.title;
}

export function enhanceTables(root = document) {
  root.querySelectorAll('table').forEach((t) => {
    if (!t.caption) {
      const c = document.createElement('caption');
      c.className = 'sr-only';
      c.textContent = labelFor(t);
      t.prepend(c);
    }
    t.querySelectorAll('thead th:not([scope])').forEach((th) => th.setAttribute('scope', 'col'));
    // header-less key/value tables: the first cell of each row is a row header
    if (!t.tHead)
      t.querySelectorAll('tbody tr').forEach((tr) => {
        const first = tr.firstElementChild;
        if (first && first.tagName === 'TH' && !first.hasAttribute('scope')) first.setAttribute('scope', 'row');
      });
    t.querySelectorAll('tbody th:not([scope])').forEach((th) => th.setAttribute('scope', 'row'));
  });
}

// CMP-010: tables with a header row and at least three plain rows get sortable column headers (button inside th, aria-sort on the th, announced through a polite status).
// Sorting is local to the loaded rows; numbers and dates in the cell text sort numerically/chronologically, other text with the Arabic collation.
let sortStatus;
const collator = new Intl.Collator(['ar', 'en'], { numeric: true, sensitivity: 'base' });
const cellKey = (td) => {
  const t = (td?.getAttribute('data-sort') ?? td?.textContent ?? '').trim();
  const n = Number(t.replace(/[,٬\s%]/g, ''));
  return t !== '' && isFinite(n) ? n : t;
};
export function enhanceSortable(root = document) {
  root.querySelectorAll('table').forEach((t) => {
    const head = t.tHead?.rows[0];
    const body = t.tBodies[0];
    if (
      !head ||
      !body ||
      t.dataset.nosort != null ||
      body.rows.length < 3 ||
      t.querySelector('[rowspan],[colspan]') ||
      head.dataset.sortInit
    )
      return;
    head.dataset.sortInit = '1';
    [...head.cells].forEach((th, col) => {
      const name = th.textContent.trim();
      if (!name || th.classList.contains('nosort')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sort-btn';
      btn.append(...th.childNodes);
      btn.setAttribute('aria-label', `ترتيب حسب ${name}`);
      th.append(btn);
      th.setAttribute('aria-sort', 'none');
      btn.addEventListener('click', () => {
        const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
        [...head.cells].forEach((x) => x.hasAttribute('aria-sort') && x.setAttribute('aria-sort', 'none'));
        th.setAttribute('aria-sort', dir);
        const rows = [...body.rows];
        const f = dir === 'ascending' ? 1 : -1;
        rows.sort((a, b) => {
          const x = cellKey(a.cells[col]),
            y = cellKey(b.cells[col]);
          return f * (typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y)));
        });
        body.append(...rows);
        if (!sortStatus) {
          sortStatus = document.createElement('div');
          sortStatus.className = 'sr-only';
          sortStatus.setAttribute('role', 'status');
          sortStatus.setAttribute('aria-live', 'polite');
          document.body.append(sortStatus);
        }
        sortStatus.textContent = `رُتّب الجدول حسب ${name} ${dir === 'ascending' ? 'تصاعديًا' : 'تنازليًا'}`;
      });
    });
  });
}

export function isolateIdentifiers(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      for (let p = n.parentNode; p && p !== root; p = p.parentNode)
        if (SKIP.has(p.nodeName) || p.isContentEditable) return NodeFilter.FILTER_REJECT;
      REF.lastIndex = 0;
      return REF.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const text = n.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    REF.lastIndex = 0;
    let m;
    while ((m = REF.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const b = document.createElement('bdi');
      b.textContent = m[0];
      frag.append(b);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    n.replaceWith(frag);
  }
}

// CMP-006: WAI-ARIA tabs pattern — roving tabindex, arrow keys (mirrored in RTL), Home/End. Delegated, so dynamically rendered tablists work.
export function enhanceTablists(root = document) {
  root.querySelectorAll('[role=tablist]').forEach((tl) => {
    const tabs = [...tl.querySelectorAll('[role=tab]')];
    if (!tabs.length) return;
    const sel = tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0];
    tabs.forEach((t) => {
      const want = t === sel ? '0' : '-1';
      if (t.getAttribute('tabindex') !== want) t.setAttribute('tabindex', want);
    });
  });
}
document.addEventListener('keydown', (e) => {
  const tab = e.target.closest?.('[role=tab]');
  if (!tab || e.altKey || e.ctrlKey || e.metaKey) return;
  const tabs = [...tab.closest('[role=tablist]').querySelectorAll('[role=tab]:not([disabled])')];
  const i = tabs.indexOf(tab);
  const rtl = getComputedStyle(tab).direction === 'rtl';
  let n = -1;
  if (e.key === 'ArrowRight') n = rtl ? i - 1 : i + 1;
  else if (e.key === 'ArrowLeft') n = rtl ? i + 1 : i - 1;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = tabs.length - 1;
  else return;
  e.preventDefault();
  n = (n + tabs.length) % tabs.length;
  tabs[n].focus();
  tabs[n].click();
  setTimeout(() => {
    const t =
      document.getElementById(tabs[n].id) ||
      [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent === tabs[n].textContent);
    t?.focus();
  }, 60);
});

export function initA11y() {
  let t;
  const run = () => {
    try {
      enhanceTables();
      enhanceSortable();
      enhanceTablists();
      isolateIdentifiers(document.getElementById('app') || document.body);
      const l = document.getElementById('layer');
      if (l) isolateIdentifiers(l);
    } catch {
      /* never break the UI */
    }
  };
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(run, 80);
  }).observe(document.body, { childList: true, subtree: true });
  run();
}
