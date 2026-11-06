// The plan wizard (steps 3–5 of the template flow; steps 1–2 are the catalogue and the preview).
//   3 edit the plan: phase lanes, drag/drop + keyboard + buttons, durations, dependencies, live Gantt (draft only)
//   4 organisations and people: roles are PROPOSALS, only people of the user's own organisation can be assigned; start date and working calendar
//   5 review and create the project in planning state (never an approval)
// The server is the authority: every change is sent as a versioned PATCH of the draft; a refusal puts the server's answer back on screen.
import { api } from '../api.js';
import { h, mount, icon, toast, badge, confirmDialog, formDialog, drawer, popover } from '../ui.js';
import { breadcrumb, noticeEl } from '../shared.js';
import { enableBoardDnD } from '../dnd.js';
import { schedule } from '../schedule.js';
import { gantt, applyBars, KIND, fmtN } from './templates.js';

const STEPS = [
  ['اختيار المجال والتخصص', '#/templates'],
  ['اختيار النموذج ومعاينته', null],
  ['تعديل الخطة', 3],
  ['الجهات والفرق والمدة', 4],
  ['المراجعة والحفظ', 5],
];
const WEEK = [
  ['السبت والأحد', [0, 6]],
  ['الجمعة والسبت', [5, 6]],
  ['الجمعة فقط', [5]],
];
let _fid = 0;
const lf = (label, ctrl, cls) => {
  const id = `lf${++_fid}`;
  ctrl.id = id;
  return h('div', { class: 'field' }, h('label', { for: id, class: cls || null }, label), ctrl);
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const nid = (p) => `${p}${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 99)}`;
const fd = (iso) =>
  iso
    ? new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en' : 'ar-AE-u-nu-latn', {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }).format(new Date(iso + 'T00:00:00Z'))
    : '—';

export async function wizardView({ id, step, ctx, go }) {
  let V = await api.get(`/template-drafts/${id}`);
  const meta = await api.get('/templates/meta');
  let D = V.draft;
  let version = D.version;
  const undo = [];
  const redo = [];
  let dirty = false;
  let saving = false;
  let timer = 0;
  let conflict = false;
  let pending = {};
  let selected = null;
  const status = h('span', { class: 'tpl-save', role: 'status' }, 'محفوظ');
  const root = h('div', { class: 'stack' });
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const say = (t) => {
    live.textContent = '';
    setTimeout(() => {
      live.textContent = t;
    }, 30);
  };
  const calc = () => schedule(D.plan.tasks, D.start, D.calendar);
  const T = (tid) => D.plan.tasks.find((x) => x.id === tid);

  // ------------------------------------------------ saving
  const setStatus = (t, bad) => {
    status.textContent = t;
    status.classList.toggle('bad', !!bad);
  };
  const flush = async () => {
    if (saving || conflict) return;
    if (!Object.keys(pending).length) {
      dirty = false;
      setStatus('محفوظ');
      return;
    }
    saving = true;
    const body = { ...pending, version };
    pending = {};
    setStatus('جارٍ الحفظ…');
    try {
      const r = await api.patch(`/template-drafts/${id}`, body);
      version = r.draft.version;
      D.version = version;
      V = { ...V, summary: r.summary, warnings: r.warnings };
      setStatus(Object.keys(pending).length ? 'جارٍ الحفظ…' : 'محفوظ تلقائيًا');
    } catch (e) {
      if (e.code === 'VERSION_CONFLICT') {
        conflict = true;
        setStatus('تعارض: عُدّلت المسودة من نافذة أخرى', true);
        showConflict(e);
      } else {
        toast(e.message, 'err');
        const fresh = await api.get(`/template-drafts/${id}`);
        D = fresh.draft;
        V = fresh;
        version = D.version;
        pending = {};
        undo.length = 0;
        redo.length = 0;
        setStatus('أُعيدت نسخة الخادم', true);
        draw();
      }
    } finally {
      saving = false;
      dirty = Object.keys(pending).length > 0;
      if (dirty) timer = setTimeout(flush, 300);
    }
  };
  const queue = (patch) => {
    Object.assign(pending, patch);
    dirty = true;
    setStatus('تعديلات غير محفوظة…');
    clearTimeout(timer);
    timer = setTimeout(flush, 650);
  };
  const showConflict = (e) => {
    const cur = e.details?.current?.draft;
    const changes = cur ? `اسم المشروع: «${cur.name}» · ${fmtN(cur.plan.tasks.length)} عنصرًا` : '';
    const d = drawer({
      title: 'تعارض في النسخة',
      sub: 'لن نكتب فوق عمل نافذة أخرى',
      body: h(
        'div',
        { class: 'stack' },
        noticeEl('عُدّلت هذه المسودة بعد أن فتحتها. لم يُحفظ تعديلك الأخير. قارن ثم اختر.', 'warn', 'info'),
        h('div', { class: 'small' }, `نسخة الخادم الآن — ${changes}`),
      ),
      footer: [
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              const f = await api.get(`/template-drafts/${id}`);
              D = f.draft;
              V = f;
              version = D.version;
              conflict = false;
              pending = {};
              undo.length = 0;
              redo.length = 0;
              d.close();
              setStatus('حُمّلت نسخة الخادم');
              draw();
            },
          },
          'تحميل نسخة الخادم (يستبدل تعديلي)',
        ),
        h('button', { class: 'btn', onclick: () => d.close() }, 'إبقاء ما أراه دون حفظ'),
      ],
    });
  };
  window.onbeforeunload = () => (dirty || saving ? 'لديك تعديلات لم تُحفظ بعد' : undefined);

  // ------------------------------------------------ plan operations (client-side preview; the server re-validates everything)
  const mutate = (label, fn) => {
    const next = clone(D.plan);
    const before = JSON.stringify(D.plan);
    try {
      fn(next);
    } catch (e) {
      toast(e.message, 'err');
      return false;
    }
    const s = schedule(next.tasks, D.start, D.calendar);
    if (!s.ok) {
      const nm = new Map(next.tasks.map((t) => [t.id, t.name]));
      toast(
        `الاعتماديات تصنع دورة بين: ${s.cycle
          .slice(0, 4)
          .map((i) => `«${nm.get(i)}»`)
          .join('، ')} — لم يُطبَّق التعديل`,
        'err',
      );
      return false;
    }
    undo.push(before);
    if (undo.length > 80) undo.shift();
    redo.length = 0;
    D.plan = next;
    queue({ plan: next });
    say(label);
    draw();
    return true;
  };
  const doUndo = (from, to, label) => {
    if (!from.length) return;
    to.push(JSON.stringify(D.plan));
    D.plan = JSON.parse(from.pop());
    queue({ plan: D.plan });
    say(label);
    draw();
  };
  const bridge = (plan, removedIds) => {
    // dependents of removed items inherit what the removed items waited for, so the flow is not silently cut
    const rm = new Set(removedIds);
    const inherited = new Set(
      plan.tasks.filter((t) => rm.has(t.id)).flatMap((t) => t.depends_on.filter((d) => !rm.has(d))),
    );
    plan.tasks = plan.tasks.filter((t) => !rm.has(t.id));
    for (const t of plan.tasks)
      if (t.depends_on.some((d) => rm.has(d)))
        t.depends_on = [...new Set([...t.depends_on.filter((d) => !rm.has(d)), ...inherited])];
  };
  const gateOf = (plan, pid) => plan.tasks.find((t) => t.phase_id === pid && t.kind === 'MILESTONE_GATE');
  const addTask = (pid, kind = 'INTERNAL_TASK') =>
    mutate('أُضيف عنصر', (p) => {
      const id2 = nid('N');
      const phIdx = p.phases.findIndex((x) => x.id === pid);
      const prevGate = phIdx > 0 ? gateOf(p, p.phases[phIdx - 1].id) : null;
      const g = gateOf(p, pid);
      p.tasks.splice(g ? p.tasks.indexOf(g) : p.tasks.length, 0, {
        id: id2,
        phase_id: pid,
        name: kind === 'INTERNAL_TASK' ? 'مهمة جديدة' : 'طلب جديد إلى جهة أخرى',
        description: '',
        kind,
        duration_workdays: 3,
        depends_on: prevGate ? [prevGate.id] : [],
        responsible_role: '',
        evidence_required: ['مستند نتيجة المهمة'],
        acceptance_criteria: '',
        optional: kind !== 'INTERNAL_TASK',
        effort_hours: 0,
        assignee_user_id: null,
        cross_agency_request:
          kind === 'INTERNAL_TASK'
            ? null
            : {
                must_route_via_committee: true,
                nonbinding_until_acceptance: true,
                target_org_role_candidates: [],
                actions_by_recipient: [],
                create_draft: true,
              },
      });
      if (g) g.depends_on = [...new Set([...g.depends_on, id2])];
      selected = id2;
    });
  const dupTask = (tid) =>
    mutate('نُسخ العنصر', (p) => {
      const t = p.tasks.find((x) => x.id === tid);
      if (t.kind === 'MILESTONE_GATE') throw new Error('بوابة التحقق لا تُنسخ');
      const c = clone(t);
      c.id = nid('N');
      c.name = `${t.name} (نسخة)`;
      p.tasks.splice(p.tasks.indexOf(t) + 1, 0, c);
      const g = gateOf(p, t.phase_id);
      if (g) g.depends_on = [...new Set([...g.depends_on, c.id])];
      selected = c.id;
    });
  const delTask = async (tid) => {
    const t = T(tid);
    if (t.kind === 'MILESTONE_GATE') return toast('بوابة التحقق لا تُحذف: لا يجوز تخطي مرحلة بصريًا', 'err');
    const dependents = D.plan.tasks.filter((x) => x.depends_on.includes(tid));
    if (
      dependents.length &&
      !(await confirmDialog({
        title: `حذف «${t.name}»؟`,
        text: `يعتمد عليها ${fmtN(dependents.length)} من العناصر؛ ستُوصَل اعتمادياتها بما كانت هذه تنتظره حتى لا ينقطع التسلسل.`,
        ok: 'حذف العنصر',
        danger: true,
      }))
    )
      return;
    mutate('حُذف العنصر', (p) => bridge(p, [tid]));
    if (selected === tid) selected = null;
  };
  const moveTask = (tid, toPhase, index) =>
    mutate('نُقل العنصر', (p) => {
      const t = p.tasks.find((x) => x.id === tid);
      if (t.kind === 'MILESTONE_GATE') throw new Error('بوابة التحقق تبقى في مرحلتها');
      const from = t.phase_id;
      p.tasks.splice(p.tasks.indexOf(t), 1);
      t.phase_id = toPhase;
      const inPh = p.tasks.filter((x) => x.phase_id === toPhase && x.kind !== 'MILESTONE_GATE');
      const ref = index == null || index >= inPh.length ? gateOf(p, toPhase) || null : inPh[Math.max(0, index)];
      p.tasks.splice(ref ? p.tasks.indexOf(ref) : p.tasks.length, 0, t); // the item's own dependencies are NOT changed by dragging
      if (t.phase_id !== from) {
        const og = gateOf(p, from);
        const ng = gateOf(p, toPhase);
        if (og) og.depends_on = og.depends_on.filter((d) => d !== tid);
        if (ng) ng.depends_on = [...new Set([...ng.depends_on, tid])];
      } // verification gates follow the work they verify
    });
  const addPhase = () =>
    mutate('أُضيفت مرحلة', (p) => {
      const pid = nid('PX');
      p.phases.push({ id: pid, name: 'مرحلة جديدة', order: p.phases.length + 1 });
      const prev = gateOf(p, p.phases.at(-2).id);
      const t1 = nid('N');
      p.tasks.push(
        {
          id: t1,
          phase_id: pid,
          name: 'مهمة جديدة',
          description: '',
          kind: 'INTERNAL_TASK',
          duration_workdays: 3,
          depends_on: prev ? [prev.id] : [],
          responsible_role: '',
          evidence_required: ['مستند نتيجة المهمة'],
          acceptance_criteria: '',
          optional: false,
          effort_hours: 0,
          assignee_user_id: null,
          cross_agency_request: null,
        },
        {
          id: nid('G'),
          phase_id: pid,
          name: 'بوابة تحقق: مرحلة جديدة',
          description: '',
          kind: 'MILESTONE_GATE',
          duration_workdays: 0,
          depends_on: [t1],
          responsible_role: 'مفوض القرار',
          evidence_required: ['محضر قرار أو مراجعة بشرية'],
          acceptance_criteria: 'قرار بشري مسجل بصلاحية سارية؛ لا موافقة بالصمت.',
          optional: false,
          effort_hours: 0,
          assignee_user_id: null,
          cross_agency_request: null,
        },
      );
    });
  const delPhase = async (pid) => {
    if (D.plan.phases.length < 2) return toast('تحتاج الخطة مرحلة واحدة على الأقل', 'err');
    const n = D.plan.tasks.filter((t) => t.phase_id === pid).length;
    if (
      await confirmDialog({
        title: 'حذف المرحلة؟',
        text: `تُحذف المرحلة و${fmtN(n)} عنصرًا فيها، وتُوصَل اعتماديات ما بعدها بما كانت تنتظره. يمكنك التراجع (Ctrl+Z).`,
        ok: 'حذف المرحلة',
        danger: true,
      })
    )
      mutate('حُذفت المرحلة', (p) => {
        bridge(
          p,
          p.tasks.filter((t) => t.phase_id === pid).map((t) => t.id),
        );
        p.phases = p.phases.filter((x) => x.id !== pid).map((x, i) => ({ ...x, order: i + 1 }));
      });
  };
  const shiftPhase = (pid, d) =>
    mutate('غُيّر ترتيب المرحلة', (p) => {
      const i = p.phases.findIndex((x) => x.id === pid);
      const j = i + d;
      if (j < 0 || j >= p.phases.length) return;
      [p.phases[i], p.phases[j]] = [p.phases[j], p.phases[i]];
      p.phases.forEach((x, k) => {
        x.order = k + 1;
      });
    });
  const setDur = (tid, n) => {
    const v = Math.max(0, Math.min(260, Math.round(Number(n) || 0)));
    if (T(tid).duration_workdays !== v)
      mutate(`المدة ${v} يوم عمل`, (p) => {
        p.tasks.find((x) => x.id === tid).duration_workdays = v;
      });
  };
  const shiftInPhase = (tid, d) =>
    mutate('غُيّر الترتيب', (p) => {
      const t = p.tasks.find((x) => x.id === tid);
      const sib = p.tasks.filter((x) => x.phase_id === t.phase_id && x.kind !== 'MILESTONE_GATE');
      const i = sib.indexOf(t);
      const o = sib[i + d];
      if (!o) return;
      const a = p.tasks.indexOf(t);
      const b = p.tasks.indexOf(o);
      [p.tasks[a], p.tasks[b]] = [p.tasks[b], p.tasks[a]];
    });

  // ------------------------------------------------ step chrome
  const stepper = () =>
    h(
      'ol',
      { class: 'tpl-steps', 'aria-label': 'خطوات إنشاء المشروع من نموذج' },
      STEPS.map(([l, t], i) => {
        const n = i + 1;
        const cur = n === step;
        const href =
          i === 0 ? '#/templates' : i === 1 ? `#/templates/${D.template_id}` : `#/templates/draft/${id}?step=${t}`;
        return h(
          'li',
          { class: cur ? 'cur' : n < step ? 'done' : '' },
          h(
            'a',
            { href, 'aria-current': cur ? 'step' : null },
            h('span', { class: 'no' }, n < step ? '✓' : fmtN(n)),
            h('span', null, l),
          ),
        );
      }),
    );
  const nav = () =>
    h(
      'div',
      { class: 'row tpl-nav' },
      step > 3
        ? h('a', { class: 'btn', href: `#/templates/draft/${id}?step=${step - 1}` }, 'السابق')
        : h('a', { class: 'btn', href: `#/templates/${D.template_id}` }, 'العودة للمعاينة'),
      h('div', { class: 'grow' }),
      status,
      step < 5
        ? h(
            'a',
            {
              class: 'btn primary',
              href: `#/templates/draft/${id}?step=${step + 1}`,
              onclick: () => {
                clearTimeout(timer);
                flush();
              },
            },
            'التالي',
          )
        : null,
    );

  // ------------------------------------------------ step 3: plan
  const taskCard = (t, sc) => {
    const it = sc.items[t.id];
    const gate = t.kind === 'MILESTONE_GATE';
    const crit = sc.critical_ids.includes(t.id);
    const dur = gate
      ? h('span', { class: 'xs' }, `◆ ${fd(it.end)}`)
      : h(
          'span',
          { class: 'tpl-stepper', 'data-nodrag-ui': '1' },
          h(
            'button',
            {
              class: 'iconbtn sm',
              'aria-label': `إنقاص مدة ${t.name}`,
              onclick: (e) => {
                e.stopPropagation();
                setDur(t.id, t.duration_workdays - 1);
              },
            },
            '−',
          ),
          h(
            'span',
            { class: 'num', 'aria-label': `${t.duration_workdays} يوم عمل` },
            `${fmtN(t.duration_workdays)} يوم`,
          ),
          h(
            'button',
            {
              class: 'iconbtn sm',
              'aria-label': `زيادة مدة ${t.name}`,
              onclick: (e) => {
                e.stopPropagation();
                setDur(t.id, t.duration_workdays + 1);
              },
            },
            '+',
          ),
        );
    const el = h(
      'div',
      {
        class: `kcard tpl-task k-${gate ? 'gate' : t.kind === 'INTERAGENCY_REQUEST_CANDIDATE' ? 'req' : 'task'}${crit ? ' crit' : ''}${selected === t.id ? ' sel' : ''}`,
        tabindex: '0',
        role: 'group',
        dataset: { id: t.id, nodrag: gate ? '1' : '0' },
        'aria-label': `${t.name}. ${KIND[t.kind][0]}${gate ? '' : `، ${t.duration_workdays} يوم عمل`}${crit ? '، على المسار الحرج' : ''}`,
        onclick: (e) => {
          if (e.target.closest('button,input,select')) return;
          open(t.id);
        },
        onkeydown: (e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) open(t.id);
        },
      },
      h(
        'div',
        { class: 'row' },
        gate ? null : h('span', { class: 'grip', 'aria-hidden': 'true' }, '⋮⋮'),
        h('span', { class: 'ttl grow' }, t.name),
      ),
      h(
        'div',
        { class: 'meta' },
        badge(gate ? '◆ بوابة تحقق' : KIND[t.kind][0], KIND[t.kind][1]),
        crit ? h('span', { class: 'g-crit-tag' }, 'حرج') : null,
        t.assignee_user_id ? h('span', null, '👤') : null,
        t.depends_on.length ? h('span', null, `بعد ${fmtN(t.depends_on.length)}`) : null,
      ),
      h(
        'div',
        { class: 'row' },
        dur,
        h('div', { class: 'grow' }),
        gate
          ? null
          : h(
              'span',
              { class: 'tpl-mv' },
              h(
                'button',
                {
                  class: 'iconbtn sm',
                  'aria-label': `نقل ${t.name} لأعلى داخل المرحلة`,
                  onclick: (e) => {
                    e.stopPropagation();
                    shiftInPhase(t.id, -1);
                  },
                },
                '▲',
              ),
              h(
                'button',
                {
                  class: 'iconbtn sm',
                  'aria-label': `نقل ${t.name} لأسفل داخل المرحلة`,
                  onclick: (e) => {
                    e.stopPropagation();
                    shiftInPhase(t.id, 1);
                  },
                },
                '▼',
              ),
              h(
                'button',
                {
                  class: 'iconbtn sm',
                  'aria-label': `نقل ${t.name} إلى مرحلة أخرى`,
                  onclick: (e) => {
                    e.stopPropagation();
                    movePhaseMenu(e.currentTarget, t);
                  },
                },
                '⇄',
              ),
            ),
      ),
    );
    return el;
  };
  const movePhaseMenu = (btn, t) => {
    const pop = popover(
      btn,
      h(
        'div',
        { class: 'menu', role: 'menu' },
        D.plan.phases
          .filter((p) => p.id !== t.phase_id)
          .map((p) =>
            h(
              'button',
              {
                role: 'menuitem',
                onclick: () => {
                  pop.close();
                  moveTask(t.id, p.id, null);
                },
              },
              `نقل إلى: ${p.name}`,
            ),
          ),
      ),
    );
  };
  const open = (tid) => {
    selected = tid;
    const t = T(tid);
    const gate = t.kind === 'MILESTONE_GATE';
    const others = D.plan.tasks.filter((x) => x.id !== tid);
    let fi = 0;
    const f = (label, ctrl, hint) => {
      const fid = `tf${++fi}`;
      const tgt = ctrl.matches?.('input,select,textarea') ? ctrl : null;
      if (tgt) tgt.id = fid;
      else ctrl.setAttribute('aria-labelledby', fid);
      return h(
        'div',
        { class: 'field' },
        h('label', tgt ? { for: fid } : { id: fid }, label),
        ctrl,
        hint ? h('div', { class: 'hint' }, hint) : null,
      );
    };
    const name = h('input', { value: t.name, maxlength: '160' });
    const desc = h('textarea', { rows: 3 }, t.description);
    const role = h('input', { value: t.responsible_role });
    const ev = h('textarea', { rows: 3 }, t.evidence_required.join('\n'));
    const acc = h('textarea', { rows: 2 }, t.acceptance_criteria);
    const dur = h('input', {
      type: 'number',
      min: '0',
      max: '260',
      value: String(t.duration_workdays),
      inputmode: 'numeric',
      disabled: gate ? true : null,
    });
    const deps = h(
      'div',
      { class: 'tpl-deps', role: 'group', 'aria-label': 'يبدأ بعد انتهاء' },
      D.plan.phases.map((p) => {
        const li = others.filter((x) => x.phase_id === p.id);
        return li.length
          ? h(
              'fieldset',
              null,
              h('legend', null, p.name),
              li.map((x) =>
                h(
                  'label',
                  { class: 'chk' },
                  h('input', { type: 'checkbox', value: x.id, checked: t.depends_on.includes(x.id) ? true : null }),
                  h('span', null, x.name),
                ),
              ),
            )
          : null;
      }),
    );
    const users = ctx.orgUsers || [];
    const asg = h(
      'select',
      null,
      h('option', { value: '' }, '— غير محدد (يحدده مشرف الجهة لاحقًا) —'),
      users.map((u) =>
        h('option', { value: u.id, selected: t.assignee_user_id === u.id ? true : null }, `${u.name} — ${u.title}`),
      ),
    );
    const draftReq = h('input', {
      type: 'checkbox',
      checked: t.cross_agency_request?.create_draft !== false ? true : null,
    });
    const cand = h('input', { value: (t.cross_agency_request?.target_org_role_candidates || []).join('، ') });
    const apply = () => {
      const dd = new Set([...deps.querySelectorAll('input:checked')].map((i) => i.value));
      const ok = mutate('عُدّل العنصر', (p) => {
        const x = p.tasks.find((y) => y.id === tid);
        x.name = name.value.trim() || x.name;
        x.description = desc.value;
        x.responsible_role = role.value;
        x.evidence_required = ev.value
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        x.acceptance_criteria = acc.value;
        if (!gate) x.duration_workdays = Math.max(0, Math.min(260, Math.round(Number(dur.value) || 0)));
        x.depends_on = [...dd];
        if (t.kind === 'INTERNAL_TASK') x.assignee_user_id = asg.value || null;
        if (t.kind === 'INTERAGENCY_REQUEST_CANDIDATE')
          x.cross_agency_request = {
            ...x.cross_agency_request,
            create_draft: draftReq.checked,
            target_org_role_candidates: cand.value
              .split(/[،,]/)
              .map((s) => s.trim())
              .filter(Boolean),
          };
      });
      if (ok) dr.close();
    };
    const dr = drawer({
      title: gate ? 'بوابة تحقق' : t.name,
      sub: `${KIND[t.kind][0]} · ${D.plan.phases.find((p) => p.id === t.phase_id)?.name}`,
      body: h(
        'div',
        { class: 'stack' },
        gate
          ? noticeEl('البوابة قرار بشري مسجل: لا تُحذف ولا يُعدّ تجاوزها انتهاءً صامتًا للمرحلة.', '', 'shield')
          : null,
        f('الاسم', name),
        f('مدة العمل (أيام عمل)', dur, 'أيام عمل لا تقويمية؛ تُحتسب بحسب تقويم المشروع في الخطوة 4'),
        f('الوصف', desc),
        f('المسؤول الوظيفي', role),
        f('الأدلة المطلوبة (سطر لكل دليل)', ev),
        f('معيار القبول', acc),
        f('يبدأ بعد انتهاء', deps, 'تغيير الاعتمادية قرار منفصل عن ترتيب العرض؛ لا يُسمح بدورة'),
        t.kind === 'INTERNAL_TASK'
          ? f('إسناد داخل جهتي', asg, 'موظفو جهتك فقط. الجهات الأخرى تُطلب عبر اللجنة.')
          : null,
        t.kind === 'INTERAGENCY_REQUEST_CANDIDATE'
          ? h(
              'div',
              { class: 'stack' },
              noticeEl(
                'يتحول إلى مسودة طلب تنسيق ترفعها الجهة الطالبة عبر اللجنة. لا يُختار موظف ولا جهة هنا، وتقرر الجهة المختصة بالقبول أو الاعتذار المسبَّب.',
                'warn',
                'shield',
              ),
              h('label', { class: 'chk' }, draftReq, h('span', null, 'أنشئ مسودة طلب عند إنشاء المشروع')),
              f('جهات مقترحة (غير ملزمة، افصل بفاصلة)', cand),
            )
          : null,
      ),
      footer: [
        h('button', { class: 'btn primary', onclick: apply }, 'تطبيق'),
        gate
          ? null
          : h(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  dr.close();
                  dupTask(tid);
                },
              },
              'نسخ',
            ),
        gate
          ? null
          : h(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  dr.close();
                  mutate('متوازية', (p) => {
                    const x = p.tasks.find((y) => y.id === tid);
                    const sib = p.tasks.filter((y) => y.phase_id === x.phase_id && y.kind !== 'MILESTONE_GATE');
                    const prev = sib[sib.indexOf(x) - 1];
                    if (prev) x.depends_on = [...prev.depends_on];
                  });
                },
              },
              'اجعلها متوازية مع السابقة',
            ),
        gate
          ? null
          : h(
              'button',
              {
                class: 'btn',
                onclick: () => {
                  dr.close();
                  mutate('متعاقبة', (p) => {
                    const x = p.tasks.find((y) => y.id === tid);
                    const sib = p.tasks.filter((y) => y.phase_id === x.phase_id && y.kind !== 'MILESTONE_GATE');
                    const prev = sib[sib.indexOf(x) - 1];
                    if (prev) x.depends_on = [prev.id];
                  });
                },
              },
              'اجعلها تتبع السابقة',
            ),
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              const r = await api
                .post(`/template-drafts/${id}/reset`, { version, confirm: true, task_id: tid })
                .catch((e) => toast(e.message, 'err'));
              if (r) {
                D = r.draft;
                V = r;
                version = D.version;
                dr.close();
                draw();
              }
            },
          },
          'استرجاع من النموذج',
        ),
        gate
          ? null
          : h(
              'button',
              {
                class: 'btn danger',
                onclick: () => {
                  dr.close();
                  delTask(tid);
                },
              },
              'حذف',
            ),
      ],
    });
  };
  const lanes = (sc) =>
    D.plan.phases.map((p, pi) => {
      const ts = D.plan.tasks.filter((t) => t.phase_id === p.id);
      const its = ts.map((t) => sc.items[t.id]);
      const len = ts.length ? Math.max(...its.map((x) => x.ef)) - Math.min(...its.map((x) => x.es)) : 0;
      const body = ts.filter((t) => t.kind !== 'MILESTONE_GATE').map((t) => taskCard(t, sc));
      const gates = ts.filter((t) => t.kind === 'MILESTONE_GATE').map((t) => taskCard(t, sc));
      return h(
        'section',
        { class: 'lane tpl-lane', dataset: { key: p.id }, 'aria-label': `المرحلة ${p.order}: ${p.name}` },
        h(
          'header',
          null,
          h(
            'span',
            { class: 'grow' },
            h('span', { class: 'xs muted' }, `${fmtN(p.order)} · `),
            p.name,
            h('span', { class: 'n' }, `${fmtN(len)} يوم`),
          ),
          h(
            'button',
            {
              class: 'iconbtn',
              'aria-label': `خيارات المرحلة ${p.name}`,
              'aria-haspopup': 'menu',
              onclick: (e) => {
                const b = e.currentTarget;
                const pop = popover(
                  b,
                  h(
                    'div',
                    { class: 'menu', role: 'menu' },
                    h(
                      'button',
                      {
                        role: 'menuitem',
                        onclick: () => {
                          pop.close();
                          formDialog({
                            title: 'اسم المرحلة',
                            fields: [{ name: 'name', label: 'الاسم', value: p.name, required: true }],
                            submit: 'حفظ',
                            onSubmit: (v) =>
                              mutate('أُعيدت تسمية المرحلة', (pl) => {
                                pl.phases.find((x) => x.id === p.id).name = v.name.trim();
                              }),
                          });
                        },
                      },
                      'إعادة تسمية',
                    ),
                    h(
                      'button',
                      {
                        role: 'menuitem',
                        onclick: () => {
                          pop.close();
                          shiftPhase(p.id, -1);
                        },
                      },
                      'نقل المرحلة للأمام',
                    ),
                    h(
                      'button',
                      {
                        role: 'menuitem',
                        onclick: () => {
                          pop.close();
                          shiftPhase(p.id, 1);
                        },
                      },
                      'نقل المرحلة للخلف',
                    ),
                    h(
                      'button',
                      {
                        role: 'menuitem',
                        onclick: () => {
                          pop.close();
                          addTask(p.id, 'INTERAGENCY_REQUEST_CANDIDATE');
                        },
                      },
                      'إضافة طلب مقترح لجهة',
                    ),
                    h(
                      'button',
                      {
                        role: 'menuitem',
                        onclick: () => {
                          pop.close();
                          delPhase(p.id);
                        },
                      },
                      'حذف المرحلة',
                    ),
                  ),
                );
              },
            },
            '⋯',
          ),
        ),
        h('div', { class: 'tpl-lane-body' }, body),
        h('div', { class: 'tpl-lane-gate' }, gates),
        h('button', { class: 'btn ghost sm lane-add', onclick: () => addTask(p.id) }, icon('plus', 14), 'مهمة'),
      );
    });
  const stepPlan = () => {
    const sc = calc();
    const crit = sc.critical_ids.length;
    const orig = V.schedule?.template_length;
    const board = h('div', { class: 'board tpl-board', role: 'group', 'aria-label': 'مراحل الخطة' }, lanes(sc));
    const sum = h(
      'div',
      { class: 'card pad tpl-sum' },
      h('div', null, h('div', { class: 'xs muted' }, 'نهاية المسودة'), h('div', { class: 'big' }, fd(sc.end))),
      h(
        'div',
        null,
        h('div', { class: 'xs muted' }, 'مدة المسار الحرج'),
        h('div', { class: 'big' }, `${fmtN(sc.length)} يوم عمل`),
        orig != null && orig !== sc.length
          ? h(
              'div',
              { class: 'xs' },
              `النموذج الأصلي ${fmtN(orig)} (${sc.length > orig ? '+' : '−'}${fmtN(Math.abs(sc.length - orig))})`,
            )
          : null,
      ),
      h(
        'div',
        null,
        h('div', { class: 'xs muted' }, 'مجموع أيام العناصر'),
        h('div', { class: 'big' }, fmtN(sc.sequential)),
        h('div', { class: 'xs' }, `وفّر العمل المتوازي ${fmtN(sc.sequential - sc.length)} يوم`),
      ),
      h('div', null, h('div', { class: 'xs muted' }, 'عناصر حرجة'), h('div', { class: 'big' }, fmtN(crit))),
      h('div', { class: 'xs muted tpl-sum-note' }, 'هذه تقديرات مسودة غير معتمدة؛ لا تغيّر خط أساس ولا تلزم أحدًا.'),
    );
    const tools = h(
      'div',
      { class: 'row tpl-tools', role: 'toolbar', 'aria-label': 'أدوات الخطة' },
      h(
        'button',
        { class: 'btn sm', disabled: undo.length ? null : true, onclick: () => doUndo(undo, redo, 'تراجع') },
        '↶ تراجع',
      ),
      h(
        'button',
        { class: 'btn sm', disabled: redo.length ? null : true, onclick: () => doUndo(redo, undo, 'إعادة') },
        '↷ إعادة',
      ),
      h('button', { class: 'btn sm', onclick: addPhase }, icon('plus', 14), 'مرحلة'),
      h(
        'button',
        {
          class: 'btn sm',
          onclick: async () => {
            if (
              await confirmDialog({
                title: 'الرجوع إلى النموذج الأصلي؟',
                text: 'تُمسح تعديلات الخطة كلها في هذه المسودة (يبقى اسم المشروع والجهات).',
                ok: 'رجوع للنموذج',
                danger: true,
              })
            ) {
              const r = await api
                .post(`/template-drafts/${id}/reset`, { version, confirm: true })
                .catch((e) => toast(e.message, 'err'));
              if (r) {
                D = r.draft;
                V = r;
                version = D.version;
                undo.length = 0;
                redo.length = 0;
                draw();
              }
            }
          },
        },
        'استرجاع الأصل',
      ),
      h(
        'button',
        {
          class: 'btn sm',
          onclick: () =>
            formDialog({
              title: 'حفظ كنموذج لجهتي',
              intro: 'تُحفظ خطتك الحالية كنموذج خاص بجهتك؛ نموذج المكتبة لا يتغير.',
              fields: [{ name: 'name', label: 'اسم النموذج', value: `${D.name} — نموذج جهتنا`, required: true }],
              submit: 'حفظ النموذج',
              onSubmit: async (v) => {
                await flush();
                const r = await api.post(`/template-drafts/${id}/save-as-template`, v);
                toast(`حُفظ ${r.template.id} في قوالبي`, 'ok');
              },
            }),
        },
        'حفظ كنموذج لجهتي',
      ),
      h('div', { class: 'grow' }),
      h('span', { class: 'xs muted' }, 'اسحب البطاقة من المقبض، أو Space ثم الأسهم (↑↓ للموضع، ←→ للمرحلة)'),
    );
    const g = h(
      'section',
      { class: 'card pad stack' },
      h('h2', null, 'الجدول الزمني للمسودة'),
      gantt(D.plan.tasks, sc, D.plan.phases),
    );
    queueMicrotask(() => {
      enableBoardDnD({
        board,
        laneSel: '.tpl-lane',
        cardSel: '.tpl-task',
        reorder: true,
        announce: say,
        labelOf: (l) => l.getAttribute('aria-label') || '',
        canDrag: (c) => c.dataset.nodrag !== '1',
        canDrop: (to, tid) =>
          T(tid)?.kind === 'MILESTONE_GATE' ? { ok: false, reason: 'بوابة التحقق تبقى في مرحلتها' } : { ok: true },
        onDrop: (to, tid, x) => moveTask(tid, to, x?.index),
        onDeny: (to, tid, r) => toast(r.reason, 'err'),
      });
      const sel = board.querySelector('.tpl-task.sel');
      if (sel && document.activeElement === document.body) sel.focus({ preventScroll: true });
      applyBars(g);
    });
    return [tools, sum, board, g];
  };

  // ------------------------------------------------ step 4: organisations, people, calendar
  const stepOrgs = () => {
    const orgs = (ctx.allOrgs || []).filter((o) => o.id !== D.lead_org_id);
    const props = D.org_proposals;
    const lanesOf = [
      { id: '', name: 'أدوار غير موزّعة' },
      ...[...new Set(props.map((r) => r.org_id).filter(Boolean))].map((o) => ({
        id: o,
        name: orgs.find((x) => x.id === o)?.name || o,
      })),
    ];
    const extra = ctx.proposeOrgs || (ctx.proposeOrgs = []);
    for (const o of extra)
      if (!lanesOf.some((l) => l.id === o)) lanesOf.push({ id: o, name: orgs.find((x) => x.id === o)?.name || o });
    const setOrg = (rid, org) => {
      const next = clone(props).map((r) =>
        r.id === rid ? { ...r, org_id: org || null, status: org ? 'INVITE_PROPOSED' : 'SUGGESTED' } : r,
      );
      D.org_proposals = next;
      queue({ org_proposals: next });
      const nm = org ? orgs.find((x) => x.id === org)?.name : '';
      say(org ? `اقتُرح الدور لجهة ${nm}` : 'أُرجع الدور إلى غير الموزّع');
      if (org) toast('هذه مسودة مشاركة وطلب عبر اللجنة، وليست تكليفًا مباشرًا', 'ok');
      draw();
    };
    const roleCard = (r) =>
      h(
        'div',
        {
          class: 'kcard tpl-role',
          tabindex: '0',
          dataset: { id: r.id },
          'aria-label': `الدور ${r.role_name}${r.org_id ? '' : '، شاغر'}`,
        },
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'grip', 'aria-hidden': 'true' }, '⋮⋮'),
          h('span', { class: 'ttl grow' }, r.role_name),
        ),
        h(
          'div',
          { class: 'meta' },
          badge(r.org_id ? 'مقترحة — دعوة عند الإنشاء' : 'شاغر', r.org_id ? 'info' : 'attention'),
          h('span', { class: 'xs' }, 'غير ملزمة'),
        ),
        h(
          'select',
          { 'aria-label': `الجهة المقترحة للدور ${r.role_name}`, onchange: (e) => setOrg(r.id, e.target.value) },
          h('option', { value: '' }, '— غير موزّع —'),
          orgs.map((o) => h('option', { value: o.id, selected: r.org_id === o.id ? true : null }, o.name)),
        ),
      );
    const board = h(
      'div',
      { class: 'board tpl-orgs', role: 'group', 'aria-label': 'توزيع الأدوار على الجهات المقترحة' },
      lanesOf.map((l) =>
        h(
          'section',
          { class: 'lane tpl-orglane', dataset: { key: l.id || '_none' }, 'aria-label': l.name },
          h(
            'header',
            null,
            h('span', { class: 'grow' }, l.name),
            h('span', { class: 'n' }, fmtN(props.filter((r) => (r.org_id || '') === l.id).length)),
          ),
          props.filter((r) => (r.org_id || '') === l.id).map(roleCard),
          l.id
            ? h(
                'div',
                { class: 'xs muted', style: { padding: '2px 6px' } },
                'دعوة مشاركة تصل مفوّض الجهة، ولا تُسند إليها حزم قبل قبوله.',
              )
            : null,
        ),
      ),
    );
    queueMicrotask(() =>
      enableBoardDnD({
        board,
        laneSel: '.tpl-orglane',
        cardSel: '.tpl-role',
        announce: say,
        labelOf: (l) => l.getAttribute('aria-label') || '',
        canDrop: () => ({ ok: true }),
        onDrop: (to, rid) => setOrg(rid, to === '_none' ? '' : to),
      }),
    );
    const addOrg = h(
      'select',
      { 'aria-label': 'إضافة جهة مقترحة' },
      h('option', { value: '' }, '+ إضافة جهة مقترحة'),
      orgs.filter((o) => !lanesOf.some((l) => l.id === o.id)).map((o) => h('option', { value: o.id }, o.name)),
    );
    addOrg.onchange = () => {
      if (addOrg.value) {
        extra.push(addOrg.value);
        draw();
      }
    };
    const newRole = h(
      'button',
      {
        class: 'btn sm',
        onclick: () =>
          formDialog({
            title: 'دور مقترح جديد',
            fields: [{ name: 'role_name', label: 'اسم الدور أو الجهة المطلوبة', required: true }],
            submit: 'إضافة',
            onSubmit: (v) => {
              const next = [
                ...clone(props),
                { id: nid('rp'), role_name: v.role_name.trim(), org_id: null, status: 'SUGGESTED', source: 'user' },
              ];
              D.org_proposals = next;
              queue({ org_proposals: next });
              draw();
            },
          }),
      },
      'دور جديد',
    );
    const com = D.committee;
    const mates = ctx.orgUsers || [];
    const sel = (k, label, req) =>
      lf(
        label,
        h(
          'select',
          {
            onchange: (e) => {
              D.committee = { ...D.committee, [k]: e.target.value || null };
              queue({ committee: D.committee });
            },
          },
          h('option', { value: '' }, '— اختر —'),
          mates.map((u) =>
            h('option', { value: u.id, selected: com[k] === u.id ? true : null }, `${u.name} — ${u.title}`),
          ),
        ),
        req ? 'req' : '',
      );
    const wk = h(
      'select',
      {
        'aria-label': 'العطلة الأسبوعية',
        onchange: (e) => {
          D.calendar = { ...D.calendar, weekend: JSON.parse(e.target.value) };
          queue({ calendar: D.calendar });
          draw();
        },
      },
      WEEK.map(([l, v]) =>
        h(
          'option',
          {
            value: JSON.stringify(v),
            selected: JSON.stringify(D.calendar.weekend) === JSON.stringify(v) ? true : null,
          },
          l,
        ),
      ),
    );
    const holiday = h('input', { type: 'date', 'aria-label': 'إضافة عطلة رسمية' });
    const sc = calc();
    const holList = h(
      'ul',
      { class: 'tpl-hol' },
      D.calendar.holidays.map((d) =>
        h(
          'li',
          null,
          fd(d),
          ' ',
          h(
            'button',
            {
              class: 'iconbtn sm',
              'aria-label': `حذف عطلة ${d}`,
              onclick: () => {
                D.calendar = { ...D.calendar, holidays: D.calendar.holidays.filter((x) => x !== d) };
                queue({ calendar: D.calendar });
                draw();
              },
            },
            '×',
          ),
        ),
      ),
    );
    const internal = D.plan.tasks.filter((t) => t.kind === 'INTERNAL_TASK');
    const assignTbl = h(
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
            h('th', { scope: 'col' }, 'المهمة'),
            h('th', { scope: 'col' }, 'المرحلة'),
            h('th', { scope: 'col' }, 'المسؤول (من جهتي فقط)'),
          ),
        ),
        h(
          'tbody',
          null,
          internal.map((t) =>
            h(
              'tr',
              null,
              h('th', { scope: 'row' }, t.name),
              h('td', null, D.plan.phases.find((p) => p.id === t.phase_id)?.name),
              h(
                'td',
                null,
                h(
                  'select',
                  {
                    'aria-label': `مسؤول ${t.name}`,
                    onchange: (e) =>
                      mutate('أُسندت المهمة', (p) => {
                        p.tasks.find((x) => x.id === t.id).assignee_user_id = e.target.value || null;
                      }),
                  },
                  h('option', { value: '' }, '— لاحقًا —'),
                  mates.map((u) =>
                    h('option', { value: u.id, selected: t.assignee_user_id === u.id ? true : null }, u.name),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    const reqs = D.plan.tasks.filter((t) => t.kind === 'INTERAGENCY_REQUEST_CANDIDATE');
    return [
      noticeEl(
        'الجهات الأخرى تُقترح كأدوار ودعوات، ولا يُسند إليها موظف ولا مهمة. يرفع منسّق الطلب مسودته إلى اللجنة، ويحيلها الرئيس إلى الجهة المختصة، وتقرر الجهة بالقبول أو الاعتذار المسبَّب أو طلب الاستكمال أو مقترح بديل. الصمت لا يُعد قبولًا.',
        'warn',
        'shield',
      ),
      h(
        'section',
        { class: 'card pad stack' },
        h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'الجهات المقترحة والأدوار'), addOrg, newRole),
        h(
          'div',
          { class: 'xs muted' },
          `جهتي القائدة: ${D.lead_org_name} — يُسحب الدور إلى عمود الجهة، أو اختر الجهة من القائمة داخل البطاقة.`,
        ),
        board,
      ),
      h(
        'section',
        { class: 'card pad stack' },
        h('h2', null, 'لجنة المشروع (من جهتي)'),
        h(
          'div',
          { class: 'grid c3' },
          sel('chair_id', 'رئيس اللجنة', true),
          sel('secretary_id', 'أمين اللجنة', true),
          sel('deputy_id', 'نائب الرئيس'),
        ),
      ),
      reqs.length
        ? h(
            'section',
            { class: 'card pad stack' },
            h('h2', null, 'الطلبات المقترحة لجهات أخرى'),
            h(
              'ul',
              { class: 'list' },
              reqs.map((t) =>
                h(
                  'li',
                  null,
                  h(
                    'label',
                    { class: 'chk' },
                    h('input', {
                      type: 'checkbox',
                      checked: t.cross_agency_request?.create_draft !== false ? true : null,
                      onchange: (e) =>
                        mutate('عُدّل الطلب المقترح', (p) => {
                          p.tasks.find((x) => x.id === t.id).cross_agency_request.create_draft = e.target.checked;
                        }),
                    }),
                    h('span', null, h('b', null, t.name), ' — إنشاء مسودة طلب إلى اللجنة'),
                  ),
                  h(
                    'div',
                    { class: 'xs muted' },
                    `جهات مقترحة: ${(t.cross_agency_request?.target_org_role_candidates || []).join('، ') || '—'}`,
                  ),
                ),
              ),
            ),
          )
        : null,
      h(
        'section',
        { class: 'card pad stack' },
        h('h2', null, 'المدة وتقويم العمل'),
        h(
          'div',
          { class: 'grid c3' },
          lf(
            'تاريخ البدء',
            h('input', {
              type: 'date',
              value: D.start,
              onchange: (e) => {
                if (e.target.value) {
                  D.start = e.target.value;
                  queue({ start: D.start });
                  draw();
                }
              },
            }),
            'req',
          ),
          lf('العطلة الأسبوعية', wk),
          h(
            'div',
            { class: 'field' },
            h('span', { class: 'lbl', id: 'hol-l' }, 'عطلة رسمية'),
            h(
              'div',
              { class: 'row', role: 'group', 'aria-labelledby': 'hol-l' },
              holiday,
              h(
                'button',
                {
                  class: 'btn sm',
                  onclick: () => {
                    if (holiday.value && !D.calendar.holidays.includes(holiday.value)) {
                      D.calendar = { ...D.calendar, holidays: [...D.calendar.holidays, holiday.value].sort() };
                      queue({ calendar: D.calendar });
                      draw();
                    }
                  },
                },
                'إضافة',
              ),
            ),
          ),
        ),
        holList,
        h(
          'div',
          { class: 'notice' },
          icon('info', 18),
          h(
            'div',
            null,
            `نهاية المسودة المقدّرة ${fd(sc.end)} بعد ${fmtN(sc.length)} يوم عمل (يوم البدء الفعلي ${fd(sc.start)}). تتغير النهاية فورًا مع التقويم، ولا يتغير خط أساس معتمد.`,
          ),
        ),
      ),
      meta.can_create_project
        ? h(
            'section',
            { class: 'card pad stack' },
            h('h2', null, 'إسناد داخل جهتي'),
            h('div', { class: 'xs muted' }, 'اختياري الآن؛ يستطيع مشرف الجهة التوزيع لاحقًا من لوحة المشروع.'),
            assignTbl,
          )
        : null,
    ];
  };

  // ------------------------------------------------ step 5: review
  const stepReview = () => {
    const sc = calc();
    const sm = V.summary || {};
    const orgs = ctx.allOrgs || [];
    const invited = [...new Set(D.org_proposals.map((r) => r.org_id).filter(Boolean))];
    const issues = [];
    if (!invited.length) issues.push('اقترح جهة مشاركة واحدة على الأقل في الخطوة 4');
    if (!D.committee.chair_id || !D.committee.secretary_id) issues.push('اختر رئيس اللجنة وأمينها في الخطوة 4');
    const name = h('input', {
      value: D.name,
      maxlength: '140',
      'aria-label': 'اسم المشروع',
      onchange: (e) => {
        D.name = e.target.value;
        queue({ name: D.name });
      },
    });
    const obj = h(
      'textarea',
      {
        rows: 2,
        'aria-label': 'هدف المشروع',
        onchange: (e) => {
          D.objective = e.target.value;
          queue({ objective: D.objective });
        },
      },
      D.objective,
    );
    const create = h(
      'button',
      {
        class: 'btn primary',
        disabled: issues.length ? true : null,
        onclick: async () => {
          await flush();
          if (
            !(await confirmDialog({
              title: 'إنشاء المشروع بحالة التخطيط؟',
              text: 'ينشئ مشروعًا قيد التخطيط وحزم عمل مسودة، ومسودات الطلبات لا تُرسل، وتصل الجهات المقترحة دعوة مشاركة فقط. هذا ليس اعتمادًا ولا تصريح بدء ولا خط أساس.',
              ok: 'إنشاء المشروع',
            }))
          )
            return;
          create.disabled = true;
          try {
            const r = await api.post(`/template-drafts/${id}/instantiate`, { version });
            window.onbeforeunload = null;
            toast(`أُنشئ المشروع ${r.project.ref} قيد التخطيط`, 'ok');
            go(`#/p/${r.project.id}/board`);
          } catch (e) {
            create.disabled = false;
            toast(e.message, 'err');
            if (e.status === 422 && e.details?.step) go(`#/templates/draft/${id}?step=${e.details.step}`);
          }
        },
      },
      'إنشاء المشروع (مسودة تخطيط)',
    );
    return [
      h(
        'section',
        { class: 'card pad stack' },
        h('h2', null, 'المشروع'),
        h('div', { class: 'grid c2' }, lf('اسم المشروع', name, 'req'), lf('الهدف', obj)),
      ),
      h(
        'section',
        { class: 'card pad' },
        h(
          'dl',
          { class: 'tpl-facts' },
          [
            ['النموذج', `${D.template_name} (${D.template_id} · ${D.template_version})`],
            ['الجهة القائدة', D.lead_org_name],
            ['المراحل', fmtN(sm.phases)],
            ['المهام والطلبات', fmtN(sm.work_items)],
            ['بوابات التحقق', fmtN(sm.gates)],
            ['مسودات طلبات للجنة', fmtN(sm.request_drafts)],
            ['جهات مقترحة للدعوة', invited.map((o) => orgs.find((x) => x.id === o)?.name || o).join('، ') || '—'],
            ['أدوار شاغرة', fmtN(D.org_proposals.filter((r) => !r.org_id).length)],
            ['البدء', fd(sc.start)],
            ['النهاية المقدّرة', `${fd(sc.end)} (${fmtN(sc.length)} يوم عمل)`],
            ['تغيّرت الخطة عن النموذج', D.changed_from_template ? 'نعم' : 'لا'],
          ].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]),
        ),
      ),
      issues.length ? noticeEl(`قبل الإنشاء: ${issues.join('؛ ')}.`, 'err', 'info') : null,
      V.warnings?.length
        ? h(
            'section',
            { class: 'card pad' },
            h('h2', null, 'إشارات للمراجعة'),
            h(
              'ul',
              null,
              V.warnings.slice(0, 12).map((w) => h('li', null, w.text)),
            ),
          )
        : null,
      noticeEl((V.notices || [])[0] || '', 'warn', 'shield'),
      h('section', { class: 'card pad stack' }, h('h2', null, 'الجدول الزمني'), gantt(D.plan.tasks, sc, D.plan.phases)),
      h(
        'div',
        { class: 'row' },
        create,
        h('a', { class: 'btn', href: `#/templates/draft/${id}?step=3` }, 'العودة للتعديل'),
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              await flush();
              toast('حُفظت المسودة', 'ok');
              go('#/templates');
            },
          },
          'حفظ المسودة والخروج',
        ),
      ),
    ];
  };

  const draw = () => {
    const fn = step === 4 ? stepOrgs : step === 5 ? stepReview : stepPlan;
    const parts = fn();
    const head = h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        { class: 'page-head-main' },
        h('h1', null, `${STEPS[step - 1][0]}`),
        h(
          'div',
          { class: 'sub' },
          `مسودة «${D.name}» من النموذج ${D.template_id} — لا تُنشئ مشروعًا حتى الخطوة الأخيرة`,
        ),
      ),
    );
    mount(root, breadcrumb([['النماذج الجاهزة', '#/templates'], [D.name]]), stepper(), head, live, ...parts, nav());
    root.querySelectorAll('.tpl-board,.tpl-orgs').forEach((b) => {
      b.tabIndex = -1;
    });
    applyBars(root);
  };
  if (!ctx.orgUsers || !ctx.allOrgs) {
    const [u, adm] = await Promise.all([
      api.get('/demo/users'),
      api.get('/admin/overview').catch(() => ({ users: [] })),
    ]);
    ctx.allOrgs = u.orgs.filter((o) => !['registry', 'platform'].includes(o.id));
    ctx.orgUsers = adm.users.filter((x) => x.org_id === ctx.me.user.org_id);
  }
  const onKey = (e) => {
    if (!document.contains(root)) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (/input|textarea|select/i.test(e.target.tagName) || document.querySelector('#layer')?.children.length) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      doUndo(e.shiftKey ? redo : undo, e.shiftKey ? undo : redo, 'تراجع');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      doUndo(redo, undo, 'إعادة');
    }
  };
  document.addEventListener('keydown', onKey);
  if (D.status !== 'EDITING') {
    return {
      title: 'المسودة',
      el: h(
        'div',
        { class: 'card pad stack' },
        noticeEl('أُنشئ المشروع من هذه المسودة. تعديل الخطة بعد ذلك عبر طلب تغيير على خط الأساس.', 'ok', 'check'),
        h('a', { class: 'btn primary', href: `#/p/${D.project_id}/board` }, 'فتح المشروع'),
      ),
    };
  }
  draw();
  return { title: `${STEPS[step - 1][0]} — ${D.name}`, el: root };
}
