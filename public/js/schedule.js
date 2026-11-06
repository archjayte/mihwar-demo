// Working-day scheduling for plan drafts (templates): a pure module used by the server (authoritative) and by the browser (instant preview while editing).
// A task occupies `duration_workdays` consecutive working days starting on its early-start day; a gate (duration 0) falls on the last day of what it waits for.
// Weekends and holidays are skipped. The critical path comes from the dependency graph (longest chain), never from adding up parallel tasks.
// Default weekend: Saturday and Sunday (UAE federal week). The calendar is a parameter; organisation holidays are supplied by the caller.
export const DEFAULT_CAL = { weekend: [0, 6], holidays: [] };

const MS = 86400000;
const parse = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
export const isIsoDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s;

// the working days of a calendar as a lazy sequence: day(i) = i-th working day on/after `start`
export function workdayCalendar(start, cal = DEFAULT_CAL) {
  const off = new Set((cal.weekend || []).map(Number));
  const hol = new Set(cal.holidays || []);
  if (off.size >= 7) throw new Error('calendar has no working day');
  const days = [];
  let t = parse(start);
  let guard = 0;
  const isWork = (ms) => !off.has(new Date(ms).getUTCDay()) && !hol.has(fmt(ms));
  return {
    at(i) {
      while (days.length <= i) {
        while (!isWork(t)) {
          t += MS;
          if (++guard > 20000) throw new Error('calendar has too few working days');
        }
        days.push(fmt(t));
        t += MS;
      }
      return days[i];
    },
    first() {
      return this.at(0);
    },
  };
}

// plan: { tasks:[{id,duration_workdays,depends_on:[ids],name?}] } → { ok, cycle?, items:{id:{es,ef,start,end,slack,critical}}, length, end, sequential, critical_ids }
export function schedule(tasks, start, cal = DEFAULT_CAL) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indeg = new Map();
  const succ = new Map();
  for (const t of tasks) {
    indeg.set(t.id, 0);
    succ.set(t.id, []);
  }
  for (const t of tasks)
    for (const d of t.depends_on || []) {
      if (!byId.has(d)) continue;
      indeg.set(t.id, indeg.get(t.id) + 1);
      succ.get(d).push(t.id);
    }
  const order = [];
  const q = [...tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id)];
  while (q.length) {
    const id = q.shift();
    order.push(id);
    for (const s of succ.get(id)) {
      indeg.set(s, indeg.get(s) - 1);
      if (indeg.get(s) === 0) q.push(s);
    }
  }
  if (order.length !== tasks.length)
    return {
      ok: false,
      cycle: tasks.map((t) => t.id).filter((id) => !order.includes(id)),
      items: {},
      length: 0,
      end: null,
      sequential: 0,
      critical_ids: [],
    };
  const dur = (t) => Math.max(0, Math.round(Number(t.duration_workdays) || 0));
  const es = {};
  const ef = {};
  for (const id of order) {
    const t = byId.get(id);
    es[id] = Math.max(0, ...(t.depends_on || []).filter((d) => byId.has(d)).map((d) => ef[d]));
    ef[id] = es[id] + dur(t);
  }
  const length = Math.max(0, ...order.map((id) => ef[id]));
  const lf = {};
  const ls = {};
  for (const id of [...order].reverse()) {
    const t = byId.get(id);
    lf[id] = succ.get(id).length ? Math.min(...succ.get(id).map((s) => ls[s])) : length;
    ls[id] = lf[id] - dur(t);
  }
  const cal2 = workdayCalendar(start, cal);
  const items = {};
  for (const id of order) {
    const t = byId.get(id);
    const d = dur(t);
    const slack = ls[id] - es[id];
    // a gate (0 days) sits on the last working day of what precedes it (or the first day when it waits for nothing)
    const s = d > 0 ? cal2.at(es[id]) : cal2.at(Math.max(0, es[id] - 1));
    const e = d > 0 ? cal2.at(ef[id] - 1) : s;
    items[id] = {
      es: es[id],
      ef: ef[id],
      start: s,
      end: e,
      slack,
      critical: slack === 0 && (d > 0 || ef[id] === length || (t.depends_on || []).length > 0),
    };
  }
  const critical_ids = order.filter((id) => items[id].critical && (dur(byId.get(id)) > 0 || items[id].slack === 0));
  return {
    ok: true,
    items,
    length,
    end: length > 0 ? cal2.at(length - 1) : cal2.first(),
    start: cal2.first(),
    sequential: tasks.reduce((a, t) => a + dur(t), 0),
    critical_ids,
  };
}

// dependency cycle at the level of phases (a task in phase B waits for phase C while a task in C waits for B) cannot be mapped to ordered work packages
export function phaseCycle(tasks) {
  const ph = new Map(tasks.map((t) => [t.id, t.phase_id]));
  const g = new Map();
  for (const t of tasks)
    for (const d of t.depends_on || []) {
      const a = ph.get(d);
      const b = t.phase_id;
      if (a && b && a !== b) {
        if (!g.has(b)) g.set(b, new Set());
        g.get(b).add(a);
      }
    }
  const state = new Map();
  const hit = [];
  const walk = (n, path) => {
    if (state.get(n) === 2) return false;
    if (state.get(n) === 1) {
      hit.push(...path.slice(path.indexOf(n)));
      return true;
    }
    state.set(n, 1);
    for (const m of g.get(n) || []) if (walk(m, [...path, n])) return true;
    state.set(n, 2);
    return false;
  };
  for (const n of g.keys()) if (walk(n, [])) return hit;
  return null;
}
