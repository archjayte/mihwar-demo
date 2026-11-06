// Interface language (Arabic default, English partial). Translation is a display-layer pass over the rendered DOM using an exact-match
// dictionary plus a few patterns (dates, relative time, counts). User-entered content and demo data are NOT translated.
const AR = /[؀-ۿ]/;
export let lang = 'ar';
try {
  lang = localStorage.getItem('mihwar.lang') === 'en' ? 'en' : 'ar';
} catch {
  /* ignore */
}
// Deep link: ?lang=en or ?lang=ar selects the interface language before first paint and is remembered (RTL-011).
try {
  const q =
    new URLSearchParams(location.search).get('lang') ||
    new URLSearchParams(location.hash.split('?')[1] || '').get('lang');
  if (q === 'en' || q === 'ar') {
    lang = q;
    try {
      localStorage.setItem('mihwar.lang', q);
    } catch {
      /* ignore */
    }
  }
} catch {
  /* ignore */
}
// The ~100 KB English dictionary is fetched only when English is selected (switching language reloads the page), so the default Arabic start does not pay for it.
const { EN, MONTHS, FIRST, PATTERNS } =
  lang === 'en' ? await import('./i18n-en.js') : { EN: {}, MONTHS: {}, FIRST: {}, PATTERNS: [] };
export const setLang = (l) => {
  try {
    localStorage.setItem('mihwar.lang', l);
  } catch {
    /* ignore */
  }
  location.reload();
};

const mon = Object.keys(MONTHS).join('|');
const KEYS = Object.keys(EN).sort((a, b) => b.length - a.length);
const dateRe = new RegExp(`(\\d{1,2}) (${mon})(،)?( \\d{4})?`, 'g');
function pre(s) {
  return s
    .replace(dateRe, (_, d, m, c, y) => `${d} ${MONTHS[m]}${c ? ',' : ''}${y || ''}`)
    .replace(/(\d{1,2}:\d{2}) ص/g, '$1 AM')
    .replace(/(\d{1,2}:\d{2}) م(?![؀-ۿ])/g, '$1 PM')
    .replace(/قبل (\d+) د(?![؀-ۿ])/g, '$1 min ago')
    .replace(/قبل (\d+) ساعة/g, '$1 h ago')
    .replace(/قبل (\d+) (?:يومًا|يوم)/g, '$1 d ago')
    .replace(/قبل (\d+) ثانية/g, '$1 s ago')
    .replace(/وزن (\d+(?:\.\d+)?)\s?[%٪]/g, 'Weight $1%')
    .replace(
      /منجز معتمد ([\d.]+)٪ — تقدّم تشغيلي ([\d.]+)٪/g,
      (_, a, b) => `Approved ${a}% — operational ${Math.round(+b * 10) / 10}%`,
    )
    .replace(/معتمد ([\d.]+)% · تشغيلي ([\d.]+)%/g, 'Approved $1% · operational $2%')
    .replace(/المعتمد ([\d.]+)٪/g, 'Approved $1%')
    .replace(/التقدم التشغيلي ([\d.]+)٪ \(منفصل عن المعتمد\)/g, 'Operational progress $1% (separate from approved)')
    .replace(/^فُتحت صفحة /, 'Opened page: ')
    .replace(/\. غيّرها$/, '. Change it')
    .replace(/^المساحة الحالية /, 'Current workspace ')
    .replace(/(\d+) ساعة من (\d+)/g, '$1 h of $2')
    .replace(/ينتهي /g, 'ends ')
    .replace(/قبل (\d+) س(?![؀-ۿ])/g, '$1 h ago')
    .replace(/منذ (\d+) ساعة/g, '$1 h')
    .replace(
      /ينتظر لجنة المشروع منذ (\d+) ساعة · مطلوب بعد (\d+) يوم/g,
      'Waiting for the project committee for $1 h · needed in $2 days',
    )
    .replace(/^(\d+) سجل · الرأس /, '$1 records · head ')
    .replace(/^(\d+) سجل$/, '$1 records')
    .replace(/^(\d+) دليل$/, '$1 evidence items')
    .replace(/^(\d+) أرقام$/, '$1 figures')
    .replace(/^(\d+) (?:طلب|طلبات) في هذا المشروع$/, (_, n) => `${n} request${n === '1' ? '' : 's'} in this project`)
    .replace(/^لا طلبات في هذا المشروع$/, 'No requests in this project')
    .replace(/^المهام \((\d+)\)$/, 'Tasks ($1)')
    .replace(/^متابعة اللجنة \((\d+)\)$/, 'Committee follow-up ($1)')
    .replace(/^التزامات جهتي \((\d+)\)$/, 'My entity’s commitments ($1)')
    .replace(/^التزامات لصالح جهتي \((\d+)\)$/, 'Commitments in favour of my entity ($1)')
    .replace(/^(\d+) متأخر$/, '$1 late')
    .replace(/^(\d+)% معتمد$/, '$1% approved')
    .replace(/^المهام: (\d+) مكتملة من (\d+)$/, 'Tasks: $1 of $2 complete')
    .replace(/^التقدم \(من مهام الجهة\): (\d+)%$/, 'Progress (from entity tasks): $1%')
    .replace(/^الرد قبل /, 'Response due by ')
    .replace(/^حد مالي: ([\d,]+) د\.إ$/, 'Financial limit: AED $1')
    .replace(/^([\d,]+) د\.إ$/, 'AED $1')
    .replace(/^من (\d{1,2} \w{3} \d{4}) \(٤ أسابيع\)$/, 'From $1 (4 weeks)')
    .replace(
      /^أُرسل الطلب (REQ-[\w-]+) إلى لجنة المشروع\. هذه المحادثة للتنسيق والاستفسار ولا تُعد قرارًا رسميًا\.$/,
      'Request $1 was sent to the project committee. This chat is for coordination and inquiries and is not an official decision.',
    )
    .replace(/^استفسار على (REQ-[\w-]+)/, 'Inquiry on $1')
    .replace(/^طلب تغيير (CR-[\w-]+)$/, 'Change request $1')
    .replace(/^يؤثر على اعتماديات: /, 'Affects dependencies: ');
}
const part = (p) => {
  if (!AR.test(p)) return p;
  if (EN[p]) return EN[p];
  if (EN[p + '.']) return EN[p + '.'].replace(/\.$/, '');
  if (p.startsWith('· ') && !EN[p]) return '· ' + part(p.slice(2));
  for (const [re, fn] of PATTERNS) {
    const pm = p.match(re);
    if (pm) return fn(pm, p);
  }
  let q = p.match(/^«(.+)»$/);
  if (q) return `“${part(q[1])}”`;
  q = p.match(/^(\d+)\. افتح السجلات المصدر$/);
  if (q) return `${q[1]}. Open source records`;
  q = p.match(/^(REQ-[\w-]+) إلى (.+)$/);
  if (q) return `${q[1]} to ${part(q[2])}`;
  q = p.match(/^أُرسل الطلب (REQ-[\w-]+) إلى لجنة المشروع$/);
  if (q) return `Request ${q[1]} was sent to the project committee`;
  q = p.match(/^من (.+) إلى (.+)$/);
  if (q && !AR.test(q[1] + q[2])) return `From ${q[1]} to ${q[2]}`;
  q = p.match(/^حتى (.+)$/);
  if (q && !AR.test(q[1])) return `Until ${q[1]}`;
  q = p.match(/^بدأت (.+)$/);
  if (q && !AR.test(q[1])) return `Started ${q[1]}`;
  q = p.match(/^آخر نشاط (.+)$/);
  if (q && !AR.test(q[1])) return `Last activity ${q[1]}`;
  q = p.match(/^ينتظر لجنة المشروع (\d+) h$/);
  if (q) return `Waiting for the project committee ${q[1]} h`;
  q = p.match(/^مطلوب بعد (\d+) يوم$/);
  if (q) return `Needed in ${q[1]} days`;
  q = p.match(/^جدول الاعتماديات \((\d+)\)$/);
  if (q) return `Dependencies table (${q[1]})`;
  q = p.match(/^قبله (.+) \((.+)\) في (.+)$/);
  if (q) return `Accepted by ${part(q[1])} (${part(q[2])}) on ${q[3]}`;
  q = p.match(/^Welcome, (.+)$/);
  if (q && AR.test(q[1])) return `Welcome, ${FIRST[q[1]] || q[1]}`;
  q = p.match(/^(.+) \((.+)\)$/);
  if (q && (EN[q[1]] || EN[q[2]])) return `${part(q[1])} (${part(q[2])})`;
  q = p.match(/^خيارات عمود (.+)$/);
  if (q) return `Options for column ${part(q[1])}`;
  q = p.match(/^توسيع عمود (.+)$/);
  if (q) return `Expand column ${part(q[1])}`;
  q = p.match(/^مهمة جديدة — (.+)$/);
  if (q) return `New task — ${part(q[1])}`;
  q = p.match(/^نُقلت البطاقة إلى (.+)$/);
  if (q) return `Card moved to ${part(q[1])}`;
  q = p.match(/^بدأ سحب (.+)$/);
  if (q) return `Started dragging ${q[1]}`;
  q = p.match(/^رُفعت البطاقة (.+)$/);
  if (q) return `Card lifted: ${q[1]}`;
  q = p.match(/^(\d+) حزمة تنتظر تصريحًا أو مراجعة$/);
  if (q) return `${q[1]} package${q[1] === '1' ? '' : 's'} waiting for a permit or review`;
  q = p.match(/^(\d+) عائق مفتوح$/);
  if (q) return `${q[1]} open blocker${q[1] === '1' ? '' : 's'}`;
  q = p.match(/^حزم العمل (\d+)$/);
  if (q) return `Work packages ${q[1]}`;
  q = p.match(/^المهام (\d+)$/);
  if (q) return `Tasks ${q[1]}`;
  q = p.match(/^الطلبات المفتوحة (\d+)$/);
  if (q) return `Open requests ${q[1]}`;
  q = p.match(/^استحقاقات (\d+) خلال ثمانية أسابيع$/);
  if (q) return `${q[1]} due items over eight weeks`;
  q = p.match(/^منحنى التقدّم التراكمي لمشروع (.+)$/);
  if (q) return `Cumulative progress curve for project ${q[1]}`;
  q = p.match(/^(.+) — (?:العمود الحالي|يمكن الإفلات هنا)$/);
  if (q) return p;
  let b = p.match(/^مرحبًا (.+)$/);
  if (b) return `Welcome, ${FIRST[b[1]] || b[1]}`;
  b = p.match(/^\[(REQ-[\w-]+)\] (.+)$/);
  if (b) return `[${b[1]}] ${part(b[2])}`;
  b = p.match(/^(WP\d+-\d+) (.+)$/);
  if (b) return `${b[1]} ${part(b[2])}`;
  b = p.match(/^(.+?) (\d{1,3}) (يوم|يومًا)$/);
  if (b && EN[b[1]]) return `${EN[b[1]]} ${b[2]} d`;
  b = p.match(/^(\d+) (يوم|يومًا)$/);
  if (b) return `${b[1]} d`;
  b = p.match(/^(سبتمبر|أكتوبر|نوفمبر|ديسمبر|يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس) (\d{2})$/);
  if (b) return `${MONTHS[b[1]]} ${b[2]}`;
  let m = p.match(/^(\d+(?:\.\d+)?) (.+)$/);
  if (m && EN[m[2]]) return `${m[1]} ${EN[m[2]]}`;
  m = p.match(/^(\d+) (حزمة عمل|حزم|حزمة)(?: عمل)?$/);
  if (m) return `${m[1]} work package${m[1] === '1' ? '' : 's'}`;
  for (const k of KEYS)
    if (k.length > 2 && p.startsWith(k + ' ')) {
      const rest = p.slice(k.length + 1);
      if (!AR.test(rest)) return `${EN[k]} ${rest}`;
    }
  return p;
};
export function tr(s) {
  if (lang !== 'en' || !s || !AR.test(s)) return s;
  const lead = s.match(/^\s*/)[0],
    trail = s.match(/\s*$/)[0],
    core = s.trim();
  if (EN[core]) return lead + EN[core] + trail;
  const qm = core.match(/^«(.+)»$/);
  if (qm) return lead + '“' + tr(qm[1]) + '”' + trail;
  const out = pre(core)
    .split(/( — | · |: |، |(?<=[\u0600-\u06FFa-zA-Z0-9)»]{2})\. |\n)/)
    .map((x, i) => (i % 2 ? (x === '، ' ? ', ' : x) : part(x)))
    .join('');
  return lead + out.replace(/(\d)٪/g, '$1%') + trail;
}
const ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
function walk(root) {
  if (root.nodeType === 3) {
    const v = root.nodeValue;
    if (AR.test(v)) {
      const t = tr(v);
      if (t !== v) root.nodeValue = t;
    }
    return;
  }
  if (root.nodeType !== 1 || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(root.tagName)) return;
  for (const a of ATTRS) {
    const v = root.getAttribute?.(a);
    if (v && AR.test(v)) {
      const t = tr(v);
      if (t !== v) root.setAttribute(a, t);
    }
  }
  for (const c of root.childNodes) walk(c);
}
export function initI18n() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
  if (lang !== 'en') return;
  walk(document.documentElement);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') walk(m.target);
      else if (m.type === 'attributes') walk(m.target);
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}
// Fraction of Arabic-letter text nodes still untranslated (used by the coverage script).
export const langLabel = () => (lang === 'en' ? 'العربية' : 'English');
