// Project template library (200 official templates in 20 sectors) + editable plan drafts + creation of a project in planning state.
// Governance (docs/TEMPLATE_PERMISSIONS.md): a template is only a proposal. Nothing here approves, commits or assigns anyone outside the user's own organisation:
//   TEMPLATE_TASK_PROPOSAL  ≠ PROJECT_WORK_PACKAGE  ≠ INTERAGENCY_REQUEST (draft)  ≠ ORG_COMMITMENT  ≠ INTERNAL_TASK.
// The project is created through the SAME engine routes the rest of the site uses (so every existing permission, baseline and validation rule applies).
import { fail, clean, uniq, sha256 } from './util.mjs';
import { schedule, phaseCycle, isIsoDay, DEFAULT_CAL } from '../../public/js/schedule.js';

const KINDS = ['INTERNAL_TASK', 'INTERAGENCY_REQUEST_CANDIDATE', 'MILESTONE_GATE'];
const ACTIONS = ['ACCEPT', 'DECLINE_WITH_REASON', 'REQUEST_CLARIFICATION', 'COUNTERPROPOSE'];
const MAX_PHASES = 12;
const MAX_TASKS = 150;
const MAX_DAYS = 260;

// ------------------------------------------------------------------ Arabic-aware search helpers
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const stem = (w) => w.replace(/^(وال|بال|لل|ال)/, '');
const toks = (s) =>
  norm(s)
    .split(' ')
    .filter(Boolean)
    .map(stem)
    .filter((w) => w.length > 1);
const hit = (a, b) => a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));

export function validateCatalog(cat) {
  const errs = [];
  const T = cat?.templates;
  if (!Array.isArray(T)) return ['templates is not a list'];
  if (cat.template_count !== T.length) errs.push(`header says ${cat.template_count}, file has ${T.length}`);
  const ids = new Set();
  const names = new Set();
  for (const t of T) {
    if (!/^TPL-\d{3}$/.test(t.id || '')) errs.push(`bad id ${t.id}`);
    if (ids.has(t.id)) errs.push(`duplicate id ${t.id}`);
    ids.add(t.id);
    if (names.has(t.name_ar)) errs.push(`duplicate name ${t.name_ar}`);
    names.add(t.name_ar);
    if (!Array.isArray(t.phases) || t.phases.length !== 6) errs.push(`${t.id}: phases`);
    if (!Array.isArray(t.tasks) || t.tasks.length !== 18) errs.push(`${t.id}: tasks`);
    const tid = new Set((t.tasks || []).map((x) => x.id));
    if (tid.size !== (t.tasks || []).length) errs.push(`${t.id}: duplicate task ids`);
    for (const x of t.tasks || []) {
      if (x.assignee_user_id || x.assigned_org_id || x.can_assign_cross_org)
        errs.push(`${t.id}/${x.id}: carries an assignment`);
      for (const d of x.depends_on || []) if (!tid.has(d)) errs.push(`${t.id}/${x.id}: unknown dependency ${d}`);
    }
    if (t.tasks && !schedule(t.tasks, '2026-01-05').ok) errs.push(`${t.id}: dependency cycle`);
  }
  return errs.slice(0, 30);
}

export function registerTemplates(E, catalog) {
  const S = E.state;
  for (const k of ['templatesCustom', 'templateDrafts', 'templateInstances', 'templateImports']) if (!S[k]) S[k] = [];
  S.templateUse ||= {};
  S.meta.seq.tpl_n ||= 200;
  S.meta.seq.tdraft_n ||= 0;

  // ---------------------------------------------------------------- import (idempotent, validated before anything becomes visible)
  const official = new Map();
  const order = [];
  let importInfo = { state: 'NOT_LOADED' };
  const enc = (o) => JSON.stringify(o);
  if (catalog?.templates) {
    const errs = validateCatalog(catalog);
    if (errs.length) {
      importInfo = { state: 'REJECTED', errors: errs };
    } else {
      for (const t of catalog.templates) {
        const h = sha256(enc(t));
        official.set(t.id, {
          t,
          hash: h,
          blob: toks(
            [
              t.name_ar,
              t.specialty_name_ar,
              t.sector_name_ar,
              t.focus_ar,
              t.primary_deliverable_ar,
              t.short_description_ar,
            ].join(' '),
          ),
          nameToks: toks(t.name_ar),
          spec: toks(t.specialty_name_ar + ' ' + t.sector_name_ar),
        });
        order.push(t.id);
      }
      const counts = {
        templates: catalog.templates.length,
        sectors: new Set(catalog.templates.map((t) => t.sector_id)).size,
        phases: catalog.templates.reduce((a, t) => a + t.phases.length, 0),
        plan_items: catalog.templates.reduce((a, t) => a + t.tasks.length, 0),
      };
      const hash = catalog.hash || sha256(order.map((i) => official.get(i).hash).join(''));
      let rec = S.templateImports.find((r) => r.hash === hash);
      if (!rec) {
        rec = {
          id: 'imp_' + (S.templateImports.length + 1),
          hash,
          ...counts,
          origin: catalog.content_origin || '',
          imported_at: new Date(E.now()).toISOString(),
          by: 'system',
        };
        S.templateImports.push(rec);
      }
      importInfo = { state: 'READY', ...rec };
      E.__importRec = rec;
    }
  }
  E.templateImport = () => importInfo;
  E.officialTemplate = (id) => official.get(id)?.t || null;
  E.templateHash = (t) =>
    official.get(t.id)?.hash ||
    sha256(enc({ id: t.id, version: t.version, rev: t.rev, phases: t.phases, tasks: t.tasks }));

  // ---------------------------------------------------------------- visibility
  const needUser = (ctx) => {
    if (E.hasRole(ctx.user, 'SUPER_ADMIN'))
      fail(403, 'NO_PERMISSION', 'الحساب التقني لا يطّلع على نماذج الجهات ولا يعدّلها');
    return ctx.user;
  };
  const customVisible = (u, c) => c.org_id === u.org_id && (c.visibility === 'ORG' || c.owner_id === u.id);
  const find = (u, id) =>
    official.get(id)?.t || S.templatesCustom.find((c) => c.id === id && customVisible(u, c)) || null;
  const needTpl = (ctx) => {
    const t = find(needUser(ctx), ctx.params.id);
    if (!t) fail(404, 'NOT_FOUND', 'النموذج غير موجود أو غير متاح لجهتك');
    return t;
  };
  const originOf = (t) => (t.org_id ? (t.visibility === 'ORG' ? 'org' : 'private') : 'official');
  const useOf = (u) => (S.templateUse[u.id] ||= { favs: [], recent: [] });
  const canEditCustom = (u, c) =>
    c.org_id === u.org_id &&
    (c.owner_id === u.id || E.hasRole(u, 'ORG_ADMIN', 'COORDINATING_ADMIN', 'TEMPLATE_CATALOG_EDITOR'));

  const card = (u, t) => ({
    id: t.id,
    name_ar: t.name_ar,
    sector_id: t.sector_id,
    sector_name_ar: t.sector_name_ar,
    specialty_name_ar: t.specialty_name_ar,
    short_description_ar: t.short_description_ar,
    primary_deliverable_ar: t.primary_deliverable_ar,
    focus_ar: t.focus_ar,
    estimated_total_workdays: t.estimated_total_workdays,
    complexity: t.complexity,
    version: t.version,
    phase_count: t.phases.length,
    task_count: t.tasks.length,
    work_items: t.tasks.filter((x) => x.kind !== 'MILESTONE_GATE').length,
    gates: t.tasks.filter((x) => x.kind === 'MILESTONE_GATE').length,
    request_candidates: t.tasks.filter((x) => x.kind === 'INTERAGENCY_REQUEST_CANDIDATE').length,
    org_roles: (t.suggested_org_roles || []).map((r) => r.role_name_ar),
    origin: originOf(t),
    archived: !!t.archived,
    favorite: useOf(u).favs.includes(t.id),
    editable: !!t.org_id && canEditCustom(u, t),
    owner_org: t.org_id ? E.oname(t.org_id) : null,
    source_id: t.source_id || null,
  });
  const fullView = (u, t) => {
    const sc = schedule(t.tasks, E.today(), DEFAULT_CAL);
    return {
      ...card(u, t),
      phases: t.phases,
      tasks: t.tasks,
      suggested_org_roles: t.suggested_org_roles || [],
      suggested_internal_roles: t.suggested_internal_roles || [],
      suggested_risks_ar: t.suggested_risks_ar || [],
      template_binding_rules: t.template_binding_rules,
      estimate_basis: t.estimate_basis,
      source: t.source,
      hash: E.templateHash(t),
      schedule: sc.ok
        ? { length: sc.length, sequential: sc.sequential, critical_ids: sc.critical_ids, items: sc.items }
        : null,
      disclaimer:
        'الأيام استرشادية بأيام عمل وليست التزامًا رسميًا ولا مدة تعاقدية؛ يعاد احتسابها بحسب تقويم الجهة وتبعيات الخطة.',
      history: t.history || undefined,
      version_rev: t.rev,
    };
  };

  // ---------------------------------------------------------------- catalogue queries
  const visibleList = (u) => [
    ...order.map((i) => official.get(i).t),
    ...S.templatesCustom.filter((c) => customVisible(u, c)),
  ];
  const rank = (t, qt) => {
    const meta = official.get(t.id) || {
      blob: toks([t.name_ar, t.specialty_name_ar, t.sector_name_ar, t.focus_ar, t.primary_deliverable_ar].join(' ')),
      nameToks: toks(t.name_ar),
      spec: toks(t.specialty_name_ar + ' ' + t.sector_name_ar),
    };
    let score = 0;
    for (const q of qt) {
      if (meta.nameToks.some((n) => n === q)) score += 10;
      else if (meta.nameToks.some((n) => hit(n, q))) score += 6;
      else if (meta.spec.some((n) => hit(n, q))) score += 4;
      else if (meta.blob.some((n) => hit(n, q))) score += 2;
      else return 0;
    }
    return score;
  };
  E.route('GET', '/templates/meta', (ctx) => {
    const u = needUser(ctx);
    if (importInfo.state === 'READY' && !S.templateImports.some((r) => r.hash === importInfo.hash))
      S.templateImports.push({ ...E.__importRec }); // after a demo reset
    const all = visibleList(u).filter((t) => !t.archived);
    const secs = new Map();
    for (const t of all) {
      const s = secs.get(t.sector_id) || {
        id: t.sector_id,
        name_ar: t.sector_name_ar,
        count: 0,
        specialties: new Map(),
      };
      s.count++;
      s.specialties.set(t.specialty_name_ar, (s.specialties.get(t.specialty_name_ar) || 0) + 1);
      secs.set(t.sector_id, s);
    }
    const us = useOf(u);
    return {
      loaded: importInfo.state === 'READY',
      import:
        importInfo.state === 'READY'
          ? {
              hash: importInfo.hash,
              templates: importInfo.templates,
              sectors: importInfo.sectors,
              phases: importInfo.phases,
              plan_items: importInfo.plan_items,
              imported_at: importInfo.imported_at,
              origin: importInfo.origin,
            }
          : importInfo,
      counts: {
        all: all.length,
        official: all.filter((t) => !t.org_id).length,
        mine: all.filter((t) => t.org_id && t.owner_id === u.id).length,
        org: all.filter((t) => t.org_id && t.visibility === 'ORG').length,
        favorites: us.favs.length,
      },
      sectors: [...secs.values()].map((s) => ({
        id: s.id,
        name_ar: s.name_ar,
        count: s.count,
        specialties: [...s.specialties].map(([name, count]) => ({ name, count })),
      })),
      can_create_project: E.hasRole(u, 'COORDINATING_ADMIN'),
      can_publish: E.hasRole(u, 'ORG_ADMIN', 'COORDINATING_ADMIN', 'TEMPLATE_CATALOG_EDITOR'),
      note: 'قوالب استرشادية تحريرية وليست خطط عمل رسمية لأي جهة. الأرقام محسوبة من الكتالوج المستورد.',
    };
  });
  E.route('GET', '/templates', (ctx) => {
    const u = needUser(ctx);
    const q = ctx.query || {};
    const us = useOf(u);
    let list = visibleList(u).filter((t) => (q.archived === '1' ? true : !t.archived));
    const tab = q.tab || 'all';
    if (tab === 'mine') list = list.filter((t) => t.org_id && t.owner_id === u.id);
    else if (tab === 'org') list = list.filter((t) => t.org_id && t.visibility === 'ORG');
    else if (tab === 'favorites') list = list.filter((t) => us.favs.includes(t.id));
    else if (tab === 'recent') list = us.recent.map((id) => list.find((t) => t.id === id)).filter(Boolean);
    else if (tab === 'official') list = list.filter((t) => !t.org_id);
    if (q.sector) list = list.filter((t) => t.sector_id === q.sector);
    if (q.specialty) list = list.filter((t) => t.specialty_name_ar === q.specialty);
    const lo = Number(q.min_days) || 0;
    const hi = Number(q.max_days) || 0;
    if (lo) list = list.filter((t) => t.estimated_total_workdays >= lo);
    if (hi) list = list.filter((t) => t.estimated_total_workdays <= hi);
    if (q.complexity) list = list.filter((t) => t.complexity === q.complexity);
    const qt = toks(q.q || '');
    if (qt.length) {
      list = list
        .map((t) => [t, rank(t, qt)])
        .filter(([, s]) => s > 0)
        .sort((a, b) => b[1] - a[1] || a[0].id.localeCompare(b[0].id))
        .map(([t]) => t);
    } else if (q.sort === 'days')
      list = [...list].sort(
        (a, b) => a.estimated_total_workdays - b.estimated_total_workdays || a.id.localeCompare(b.id),
      );
    else if (q.sort === 'name') list = [...list].sort((a, b) => a.name_ar.localeCompare(b.name_ar, 'ar'));
    const total = list.length;
    const limit = Math.min(60, Math.max(1, Number(q.limit) || 24));
    const offset = Math.max(0, Number(q.offset) || 0);
    return {
      items: list.slice(offset, offset + limit).map((t) => card(u, t)),
      total,
      limit,
      offset,
      has_more: offset + limit < total,
    };
  });
  E.route('GET', '/templates/:id', (ctx) => {
    const t = needTpl(ctx);
    const us = useOf(ctx.user);
    us.recent = [t.id, ...us.recent.filter((x) => x !== t.id)].slice(0, 12);
    return { template: fullView(ctx.user, t) };
  });
  E.route('POST', '/templates/:id/favorite', (ctx) => {
    const t = needTpl(ctx);
    const us = useOf(ctx.user);
    const on = ctx.body.on !== false;
    us.favs = on ? uniq([...us.favs, t.id]) : us.favs.filter((x) => x !== t.id);
    return { favorite: us.favs.includes(t.id), count: us.favs.length };
  });

  // ---------------------------------------------------------------- plan sanitising (the only place plan data enters)
  const clonePlan = (t) => ({
    phases: t.phases.map((p, i) => ({ id: p.id, name: p.name, order: i + 1 })),
    tasks: t.tasks.map((x) => ({
      id: x.id,
      phase_id: x.phase_id,
      name: x.name,
      description: x.description || '',
      kind: x.kind,
      duration_workdays: x.duration_workdays,
      depends_on: [...(x.depends_on || [])],
      responsible_role: x.responsible_role || '',
      evidence_required: [...(x.evidence_required || [])],
      acceptance_criteria: x.acceptance_criteria || '',
      optional: !!x.optional,
      effort_hours: x.estimated_effort_hours || 0,
      assignee_user_id: null,
      cross_agency_request:
        x.kind === 'INTERAGENCY_REQUEST_CANDIDATE'
          ? {
              must_route_via_committee: true,
              nonbinding_until_acceptance: true,
              target_org_role_candidates: [...(x.cross_agency_request?.target_org_role_candidates || [])],
              actions_by_recipient: ACTIONS,
              create_draft: true,
            }
          : null,
    })),
  });
  const intIn = (v, lo, hi, field) => {
    const n = Number(v);
    if (!Number.isFinite(n) || Math.round(n) !== n || n < lo || n > hi)
      fail(422, 'VALIDATION', `${field}: عدد صحيح بين ${lo} و${hi}`, {
        fields: { [field]: `عدد صحيح بين ${lo} و${hi}` },
      });
    return n;
  };
  const sanitizePlan = (raw, owner) => {
    if (!raw || !Array.isArray(raw.phases) || !Array.isArray(raw.tasks))
      fail(422, 'VALIDATION', 'الخطة تحتاج مراحل ومهام', { fields: { plan: 'مراحل ومهام مطلوبة' } });
    if (raw.phases.length < 1 || raw.phases.length > MAX_PHASES)
      fail(422, 'TOO_MANY_PHASES', `عدد المراحل بين 1 و${MAX_PHASES}`);
    if (raw.tasks.length < 1 || raw.tasks.length > MAX_TASKS)
      fail(422, 'TOO_MANY_TASKS', `عدد العناصر بين 1 و${MAX_TASKS}`);
    const idOk = (s) => /^[A-Za-z0-9_-]{1,24}$/.test(String(s || ''));
    let nx = 0;
    const phases = raw.phases.map((p, i) => {
      const id = p.id ? String(p.id) : `PX${++nx}`;
      if (!idOk(id)) fail(422, 'VALIDATION', 'معرّف مرحلة غير صالح');
      const name = clean(p.name, 100);
      if (!name) fail(422, 'VALIDATION', 'لكل مرحلة اسم', { fields: { [`phases.${i}.name`]: 'اسم المرحلة مطلوب' } });
      return { id, name, order: i + 1 };
    });
    if (new Set(phases.map((p) => p.id)).size !== phases.length) fail(422, 'VALIDATION', 'معرّفات المراحل مكررة');
    const pid = new Set(phases.map((p) => p.id));
    const tasks = raw.tasks.map((x, i) => {
      const id = x.id ? String(x.id) : `NX${++nx}`;
      if (!idOk(id)) fail(422, 'VALIDATION', 'معرّف عنصر غير صالح');
      if (!pid.has(x.phase_id)) fail(422, 'UNKNOWN_PHASE', 'عنصر في مرحلة غير موجودة');
      if (!KINDS.includes(x.kind)) fail(422, 'VALIDATION', 'نوع العنصر غير معروف');
      const name = clean(x.name, 160);
      if (!name) fail(422, 'VALIDATION', 'لكل عنصر اسم', { fields: { [`tasks.${i}.name`]: 'الاسم مطلوب' } });
      const gate = x.kind === 'MILESTONE_GATE';
      const dur = gate ? 0 : intIn(x.duration_workdays ?? 1, 0, MAX_DAYS, `tasks.${i}.duration_workdays`);
      // a draft never carries a person or an organisation from outside the owner's organisation, and a request candidate never names one
      if (
        x.kind === 'INTERAGENCY_REQUEST_CANDIDATE' &&
        (x.assignee_user_id || x.cross_agency_request?.target_org_id || x.cross_agency_request?.target_user_id)
      )
        fail(
          403,
          'CROSS_ORG_ASSIGNMENT',
          'لا يجوز تحديد موظف أو جهة أخرى مباشرة في النموذج؛ يُرفع طلب عبر اللجنة لتحيله إلى الجهة المختصة.',
          { task: id },
        );
      let assignee = null;
      if (x.assignee_user_id) {
        const au = E.user(clean(x.assignee_user_id, 40));
        if (!au || au.org_id !== owner.org_id)
          fail(
            403,
            'CROSS_ORG_ASSIGNMENT',
            'الإسناد المباشر لموظفي جهتك فقط. الجهات الأخرى تُقترح كأدوار وتُطلب عبر اللجنة.',
            { task: id },
          );
        if (au.id !== owner.id && !E.hasRole(owner, 'ORG_SUPERVISOR', 'ORG_ADMIN'))
          fail(403, 'NOT_SUPERVISOR', 'إسناد المهام لزملائك لمشرف الجهة', { task: id });
        if (x.kind !== 'INTERNAL_TASK') fail(422, 'VALIDATION', 'الإسناد للمهام الداخلية فقط', { task: id });
        assignee = au.id;
      }
      const car =
        x.kind === 'INTERAGENCY_REQUEST_CANDIDATE'
          ? {
              must_route_via_committee: true,
              nonbinding_until_acceptance: true,
              target_org_role_candidates: (x.cross_agency_request?.target_org_role_candidates || [])
                .slice(0, 6)
                .map((r) => clean(r, 80))
                .filter(Boolean),
              actions_by_recipient: ACTIONS,
              create_draft: x.cross_agency_request?.create_draft !== false,
            }
          : null;
      return {
        id,
        phase_id: x.phase_id,
        name,
        description: clean(x.description, 600),
        kind: x.kind,
        duration_workdays: dur,
        depends_on: uniq((x.depends_on || []).map(String)),
        responsible_role: clean(x.responsible_role, 80),
        evidence_required: (x.evidence_required || [])
          .slice(0, 8)
          .map((e) => clean(e, 160))
          .filter(Boolean),
        acceptance_criteria: clean(x.acceptance_criteria, 300),
        optional: !!x.optional,
        effort_hours: intIn(x.effort_hours ?? 0, 0, 2000, `tasks.${i}.effort_hours`),
        assignee_user_id: assignee,
        cross_agency_request: car,
      };
    });
    const tid = new Set(tasks.map((t) => t.id));
    if (tid.size !== tasks.length) fail(422, 'VALIDATION', 'معرّفات العناصر مكررة');
    for (const t of tasks)
      for (const d of t.depends_on) {
        if (d === t.id) fail(422, 'DEPENDENCY_CYCLE', `«${t.name}» لا تعتمد على نفسها`, { tasks: [t.id] });
        if (!tid.has(d))
          fail(422, 'UNKNOWN_DEPENDENCY', `اعتمادية على عنصر غير موجود في الخطة`, { task: t.id, dependency: d });
      }
    // every phase that has work keeps a verification gate: a stage cannot be skipped by deleting its gate
    for (const p of phases) {
      const inPhase = tasks.filter((t) => t.phase_id === p.id);
      if (!inPhase.length)
        fail(422, 'EMPTY_PHASE', `المرحلة «${p.name}» بلا عناصر؛ احذفها أو أضف عملًا إليها`, { phase: p.id });
      if (!inPhase.some((t) => t.kind === 'MILESTONE_GATE')) {
        const work = inPhase.filter((t) => t.kind !== 'MILESTONE_GATE');
        tasks.push({
          id: `GX${++nx}`,
          phase_id: p.id,
          name: `بوابة تحقق: ${p.name}`,
          description: 'لا تنتقل المرحلة دون قرار بشري مسجل.',
          kind: 'MILESTONE_GATE',
          duration_workdays: 0,
          depends_on: work.map((t) => t.id),
          responsible_role: 'مفوض القرار',
          evidence_required: ['محضر قرار أو مراجعة بشرية'],
          acceptance_criteria: 'قرار بشري مسجل بصلاحية سارية؛ لا موافقة بالصمت.',
          optional: false,
          effort_hours: 0,
          assignee_user_id: null,
          cross_agency_request: null,
        });
      }
    }
    const sc = schedule(tasks, '2026-01-05');
    if (!sc.ok) {
      const nm = new Map(tasks.map((t) => [t.id, t.name]));
      fail(
        422,
        'DEPENDENCY_CYCLE',
        `الاعتماديات تصنع دورة بين: ${sc.cycle
          .slice(0, 5)
          .map((i) => `«${nm.get(i)}»`)
          .join('، ')}`,
        { tasks: sc.cycle },
      );
    }
    const pc = phaseCycle(tasks);
    if (pc)
      fail(
        422,
        'PHASE_DEPENDENCY_CYCLE',
        'اعتماد متبادل بين مرحلتين لا يمكن تحويله إلى حزم عمل مرتّبة؛ أعد ترتيب الاعتماديات',
        { phases: pc },
      );
    return { phases, tasks };
  };
  const planHash = (plan) => sha256(enc(plan));

  // ---------------------------------------------------------------- private / organisation templates
  const nextTplId = () => `TPL-${++S.meta.seq.tpl_n}`;
  const mkCustom = (u, src, plan, over = {}) => ({
    id: nextTplId(),
    version: `${src.version || '1.0.0'}+org.1`,
    rev: 1,
    language: 'ar',
    sector_id: src.sector_id,
    sector_name_ar: src.sector_name_ar,
    specialty_name_ar: src.specialty_name_ar,
    name_ar: over.name_ar || `${src.name_ar} — نسخة جهتنا`,
    short_description_ar: over.short_description_ar || src.short_description_ar,
    focus_ar: src.focus_ar,
    primary_deliverable_ar: src.primary_deliverable_ar,
    estimated_total_workdays: schedule(plan.tasks, '2026-01-05').length,
    estimate_basis: src.estimate_basis,
    duration_unit: 'working_days',
    complexity: src.complexity,
    phase_count: plan.phases.length,
    task_count: plan.tasks.length,
    phases: plan.phases.map((p) => ({
      ...p,
      duration_workdays_estimate: 0,
      stage_gate_task_id: (plan.tasks.find((t) => t.phase_id === p.id && t.kind === 'MILESTONE_GATE') || {}).id,
    })),
    tasks: plan.tasks.map((t) => ({ ...t, estimated_effort_hours: t.effort_hours })),
    suggested_org_roles: src.suggested_org_roles || [],
    suggested_internal_roles: src.suggested_internal_roles || [],
    suggested_risks_ar: src.suggested_risks_ar || [],
    template_binding_rules: src.template_binding_rules,
    source: 'نسخة خاصة بالجهة مشتقة من نموذج المكتبة؛ ليست خطة عمل رسمية',
    org_id: u.org_id,
    owner_id: u.id,
    visibility: 'PRIVATE',
    archived: false,
    source_id: src.id,
    source_version: src.version,
    source_hash: E.templateHash(src),
    created_at: E.iso(),
    history: [{ rev: 1, at: E.iso(), by: u.id, summary: 'إنشاء نسخة من ' + src.id }],
  });
  E.route('POST', '/templates/:id/fork', (ctx) => {
    const src = needTpl(ctx);
    const u = ctx.user;
    const plan = sanitizePlan(clonePlan(src), u);
    const c = mkCustom(u, src, plan, { name_ar: clean(ctx.body.name, 140) || undefined });
    S.templatesCustom.push(c);
    E.audit({
      actor_id: u.id,
      action: 'template.fork',
      object_type: 'template',
      object_id: c.id,
      detail: `${src.id} → ${c.id}`,
      org_id: u.org_id,
    });
    ctx.status = 201;
    return { template: fullView(u, c) };
  });
  const needCustom = (ctx) => {
    const t = needTpl(ctx);
    if (!t.org_id)
      fail(
        403,
        'SYSTEM_TEMPLATE_READONLY',
        'نماذج المكتبة المعتمدة للقراءة فقط؛ انسخها إلى نموذج جهتك ثم عدّل النسخة.',
      );
    if (!canEditCustom(ctx.user, t))
      fail(403, 'NO_PERMISSION', 'تعديل نموذج الجهة لصاحبه أو لمدير الجهة ومنسّق المشاريع ومحرّر النماذج');
    return t;
  };
  E.route('PATCH', '/templates/:id', (ctx) => {
    const t = needCustom(ctx);
    const b = ctx.body;
    const u = ctx.user;
    if (b.rev !== t.rev)
      fail(409, 'VERSION_CONFLICT', 'عُدّل النموذج منذ فتحته؛ أعد التحميل ثم أعد المحاولة', { current_rev: t.rev });
    const before = t.tasks.length;
    if ('name_ar' in b) {
      const n = clean(b.name_ar, 140);
      if (!n) fail(422, 'VALIDATION', 'الاسم مطلوب', { fields: { name_ar: 'مطلوب' } });
      t.name_ar = n;
    }
    if ('short_description_ar' in b) t.short_description_ar = clean(b.short_description_ar, 400);
    if (b.plan) {
      const plan = sanitizePlan(b.plan, u);
      t.phases = plan.phases.map((p) => ({
        ...p,
        duration_workdays_estimate: 0,
        stage_gate_task_id: (plan.tasks.find((x) => x.phase_id === p.id && x.kind === 'MILESTONE_GATE') || {}).id,
      }));
      t.tasks = plan.tasks.map((x) => ({ ...x, estimated_effort_hours: x.effort_hours }));
      t.phase_count = t.phases.length;
      t.task_count = t.tasks.length;
      t.estimated_total_workdays = schedule(t.tasks, '2026-01-05').length;
    }
    t.rev++;
    t.version = `${String(t.source_version || '1.0.0')}+org.${t.rev}`;
    t.history.push({
      rev: t.rev,
      at: E.iso(),
      by: u.id,
      summary: b.plan ? `تعديل الخطة (${before} → ${t.tasks.length} عنصرًا)` : 'تعديل البيانات',
    });
    E.audit({
      actor_id: u.id,
      action: 'template.update',
      object_type: 'template',
      object_id: t.id,
      detail: `rev ${t.rev}`,
      org_id: u.org_id,
    });
    return { template: fullView(u, t) };
  });
  E.route('POST', '/templates/:id/publish', (ctx) => {
    const t = needCustom(ctx);
    const u = ctx.user;
    const vis = ctx.body.visibility === 'ORG' ? 'ORG' : 'PRIVATE';
    if (!E.hasRole(u, 'ORG_ADMIN', 'COORDINATING_ADMIN', 'TEMPLATE_CATALOG_EDITOR'))
      fail(403, 'NO_PERMISSION', 'نشر النموذج لجهتك لمدير الجهة أو منسّق المشاريع أو محرّر النماذج');
    t.visibility = vis;
    t.history.push({ rev: t.rev, at: E.iso(), by: u.id, summary: vis === 'ORG' ? 'نشر للجهة' : 'إرجاع إلى خاص' });
    E.audit({
      actor_id: u.id,
      action: 'template.publish',
      object_type: 'template',
      object_id: t.id,
      detail: vis,
      org_id: u.org_id,
    });
    return { template: card(u, t) };
  });
  E.route('POST', '/templates/:id/archive', (ctx) => {
    const t = needCustom(ctx);
    t.archived = ctx.body.archived !== false;
    E.audit({
      actor_id: ctx.user.id,
      action: t.archived ? 'template.archive' : 'template.restore',
      object_type: 'template',
      object_id: t.id,
      org_id: ctx.user.org_id,
    });
    return { template: card(ctx.user, t) };
  });
  E.route('GET', '/templates/:id/diff', (ctx) => {
    const t = needTpl(ctx);
    const src = t.source_id ? find(ctx.user, t.source_id) : null;
    if (!src) return { diff: null, note: 'النموذج أصلي ولا مصدر له للمقارنة' };
    const a = new Map(src.tasks.map((x) => [x.id, x]));
    const b = new Map(t.tasks.map((x) => [x.id, x]));
    return {
      diff: {
        against: src.id,
        against_version: src.version,
        added: [...b.keys()].filter((i) => !a.has(i)).map((i) => ({ id: i, name: b.get(i).name })),
        removed: [...a.keys()].filter((i) => !b.has(i)).map((i) => ({ id: i, name: a.get(i).name })),
        duration_changed: [...b.keys()]
          .filter((i) => a.has(i) && a.get(i).duration_workdays !== b.get(i).duration_workdays)
          .map((i) => ({
            id: i,
            name: b.get(i).name,
            from: a.get(i).duration_workdays,
            to: b.get(i).duration_workdays,
          })),
        dependencies_changed: [...b.keys()]
          .filter(
            (i) => a.has(i) && enc([...(a.get(i).depends_on || [])].sort()) !== enc([...b.get(i).depends_on].sort()),
          )
          .map((i) => ({ id: i, name: b.get(i).name })),
        renamed: [...b.keys()]
          .filter((i) => a.has(i) && a.get(i).name !== b.get(i).name)
          .map((i) => ({ id: i, from: a.get(i).name, to: b.get(i).name })),
        source_changed_since: E.templateHash(src) !== t.source_hash,
      },
    };
  });

  // ---------------------------------------------------------------- plan drafts (the wizard's server-side state)
  const needCoord = (u) => {
    if (!E.hasRole(u, 'COORDINATING_ADMIN'))
      fail(403, 'NO_PERMISSION', 'إنشاء المشاريع لمنسّق الجهة القائدة؛ يمكنك تصفح النماذج ومعاينتها');
  };
  const needDraft = (ctx) => {
    const u = needUser(ctx);
    const d = S.templateDrafts.find((x) => x.id === ctx.params.id);
    if (!d || d.owner_id !== u.id || d.org_id !== u.org_id) fail(404, 'NOT_FOUND', 'المسودة غير موجودة');
    return d;
  };
  const calOf = (d) => ({ weekend: d.calendar.weekend, holidays: d.calendar.holidays });
  const draftView = (u, d) => {
    const sc = schedule(d.plan.tasks, d.start, calOf(d));
    const base = find(u, d.template_id);
    const baseSc = base ? schedule(base.tasks, d.start, calOf(d)) : null;
    const warnings = [];
    for (const t of d.plan.tasks)
      if (t.kind !== 'MILESTONE_GATE' && !t.evidence_required.length)
        warnings.push({ code: 'NO_EVIDENCE', task: t.id, text: `«${t.name}» بلا دليل مطلوب` });
    for (const r of d.org_proposals)
      if (!r.org_id)
        warnings.push({ code: 'ROLE_UNBOUND', role: r.id, text: `الدور «${r.role_name}» لم تُقترح له جهة بعد` });
    const reqs = d.plan.tasks.filter((t) => t.kind === 'INTERAGENCY_REQUEST_CANDIDATE');
    return {
      draft: {
        id: d.id,
        name: d.name,
        objective: d.objective,
        template_id: d.template_id,
        template_version: d.template_version,
        template_hash: d.template_hash,
        template_name: base?.name_ar || null,
        start: d.start,
        calendar: d.calendar,
        lead_org_id: d.org_id,
        lead_org_name: E.oname(d.org_id),
        committee: d.committee,
        org_proposals: d.org_proposals,
        plan: d.plan,
        version: d.version,
        status: d.status,
        project_id: d.project_id || null,
        updated_at: d.updated_at,
        changed_from_template: planHash(d.plan) !== d.base_plan_hash,
      },
      schedule: sc.ok
        ? {
            start: sc.start,
            end: sc.end,
            length: sc.length,
            sequential: sc.sequential,
            parallel_saving: sc.sequential - sc.length,
            critical_ids: sc.critical_ids,
            items: sc.items,
            template_length: baseSc?.ok ? baseSc.length : null,
          }
        : null,
      summary: {
        phases: d.plan.phases.length,
        work_items: d.plan.tasks.filter((t) => t.kind !== 'MILESTONE_GATE').length,
        gates: d.plan.tasks.filter((t) => t.kind === 'MILESTONE_GATE').length,
        request_drafts: reqs.filter((t) => t.cross_agency_request?.create_draft).length,
        orgs: uniq(d.org_proposals.filter((r) => r.org_id).map((r) => r.org_id)).length,
        roles: d.org_proposals.length,
      },
      warnings,
      notices: [
        'إنشاء المشروع ليس موافقة ولا تصريح بدء: الجهات المقترحة تصلها دعوة مشاركة وترد بتفويض، والحزم تبدأ مسودة، وخط الأساس يُعتمد لاحقًا.',
      ],
    };
  };
  const sanitizeProposals = (arr, d, u) =>
    (Array.isArray(arr) ? arr : []).slice(0, 20).map((r, i) => {
      const org = r.org_id ? clean(r.org_id, 40) : null;
      if (org && (!E.org(org) || ['platform', 'registry'].includes(E.org(org).kind) || org === u.org_id))
        fail(422, 'UNKNOWN_ORG', 'جهة غير صالحة للاقتراح', {
          fields: { [`org_proposals.${i}.org_id`]: 'اختر جهة مشاركة أخرى' },
        });
      const role = clean(r.role_name, 80);
      if (!role) fail(422, 'VALIDATION', 'اسم الدور مطلوب');
      const nm = ['SUGGESTED', 'INVITE_PROPOSED'];
      return {
        id: r.id
          ? String(r.id).slice(0, 24)
          : 'rp' + (i + 1) + '_' + Math.abs(parseInt(sha256(role + i).slice(0, 6), 16)),
        role_name: role,
        org_id: org,
        status: org ? nm[1] : nm[0],
        source: r.source === 'user' ? 'user' : 'template',
        binding: false,
      };
    });
  E.route('GET', '/template-drafts', (ctx) => {
    const u = needUser(ctx);
    return {
      items: S.templateDrafts
        .filter((d) => d.owner_id === u.id && d.org_id === u.org_id && d.status === 'EDITING')
        .map((d) => ({
          id: d.id,
          name: d.name,
          template_id: d.template_id,
          start: d.start,
          version: d.version,
          updated_at: d.updated_at,
          tasks: d.plan.tasks.length,
        })),
    };
  });
  E.route('POST', '/template-drafts', (ctx) => {
    const u = needUser(ctx);
    needCoord(u);
    const t = find(u, clean(ctx.body.template_id, 20));
    if (!t) fail(404, 'NOT_FOUND', 'النموذج غير موجود أو غير متاح لجهتك');
    if (t.archived) fail(409, 'TEMPLATE_ARCHIVED', 'النموذج مؤرشف');
    const plan = sanitizePlan(clonePlan(t), u);
    const n = ++S.meta.seq.tdraft_n;
    const start = isIsoDay(ctx.body.start) ? ctx.body.start : E.today();
    const d = {
      id: E.id('tdr'),
      ref: `TD-${String(n).padStart(3, '0')}`,
      owner_id: u.id,
      org_id: u.org_id,
      template_id: t.id,
      template_version: t.version,
      template_hash: E.templateHash(t),
      name: clean(ctx.body.name, 140) || t.name_ar,
      objective: clean(ctx.body.objective, 800) || `${t.primary_deliverable_ar}`,
      start,
      calendar: { weekend: [0, 6], holidays: [] },
      committee: { chair_id: null, secretary_id: null, deputy_id: null },
      org_proposals: (t.suggested_org_roles || []).map((r, i) => ({
        id: 'rp' + (i + 1),
        role_name: r.role_name_ar,
        org_id: null,
        status: 'SUGGESTED',
        source: 'template',
        binding: false,
      })),
      plan,
      base_plan_hash: planHash(plan),
      version: 1,
      status: 'EDITING',
      project_id: null,
      created_at: E.iso(),
      updated_at: E.iso(),
    };
    S.templateDrafts.push(d);
    const us = useOf(u);
    us.recent = [t.id, ...us.recent.filter((x) => x !== t.id)].slice(0, 12);
    E.audit({
      actor_id: u.id,
      action: 'template.draft.create',
      object_type: 'template_draft',
      object_id: d.id,
      detail: t.id,
      org_id: u.org_id,
    });
    ctx.status = 201;
    return draftView(u, d);
  });
  E.route('GET', '/template-drafts/:id', (ctx) => draftView(ctx.user, needDraft(ctx)));
  const touch = (d) => {
    d.version++;
    d.updated_at = E.iso();
  };
  E.route('PATCH', '/template-drafts/:id', (ctx) => {
    const d = needDraft(ctx);
    const u = ctx.user;
    const b = ctx.body;
    needCoord(u);
    if (d.status !== 'EDITING')
      fail(
        409,
        'ALREADY_INSTANTIATED',
        'أُنشئ المشروع من هذه المسودة؛ تعديل الخطة بعد ذلك عبر طلب تغيير على خط الأساس',
        { project_id: d.project_id },
      );
    if (b.version !== d.version)
      fail(409, 'VERSION_CONFLICT', 'عُدّلت المسودة من نافذة أخرى؛ أعد التحميل لمقارنة التغييرات قبل المتابعة', {
        server_version: d.version,
        current: draftView(u, d),
      });
    if ('name' in b) {
      const n = clean(b.name, 140);
      if (!n) fail(422, 'VALIDATION', 'اسم المشروع مطلوب', { fields: { name: 'مطلوب' } });
      d.name = n;
    }
    if ('objective' in b) d.objective = clean(b.objective, 800);
    if ('start' in b) {
      if (!isIsoDay(b.start)) fail(422, 'BAD_DATES', 'تاريخ البدء غير صحيح', { fields: { start: 'تاريخ غير صحيح' } });
      d.start = b.start;
    }
    if (b.calendar) {
      const wk = uniq((b.calendar.weekend || []).map(Number)).filter((x) => x >= 0 && x <= 6);
      if (wk.length > 5 || wk.length < 1)
        fail(422, 'VALIDATION', 'العطلة الأسبوعية من يوم إلى خمسة أيام', { fields: { calendar: 'غير صالح' } });
      const hol = uniq((b.calendar.holidays || []).filter(isIsoDay))
        .sort()
        .slice(0, 120);
      d.calendar = { weekend: wk, holidays: hol };
    }
    if (b.committee) {
      const c = b.committee;
      const pick = (k) => {
        const v = c[k] ? E.user(clean(c[k], 40)) : null;
        if (c[k] && (!v || v.org_id !== u.org_id))
          fail(422, `BAD_${k.toUpperCase()}`, 'تُختار لجنة المشروع من موظفي الجهة القائدة');
        return v?.id || null;
      };
      d.committee = { chair_id: pick('chair_id'), secretary_id: pick('secretary_id'), deputy_id: pick('deputy_id') };
    }
    if (b.org_proposals) d.org_proposals = sanitizeProposals(b.org_proposals, d, u);
    if (b.plan) d.plan = sanitizePlan(b.plan, u);
    touch(d);
    E.audit({
      actor_id: u.id,
      action: 'template.draft.update',
      object_type: 'template_draft',
      object_id: d.id,
      detail: `v${d.version}`,
      org_id: u.org_id,
    });
    return draftView(u, d);
  });
  E.route('POST', '/template-drafts/:id/reset', (ctx) => {
    const d = needDraft(ctx);
    const u = ctx.user;
    const b = ctx.body;
    needCoord(u);
    if (d.status !== 'EDITING') fail(409, 'ALREADY_INSTANTIATED', 'أُنشئ المشروع بالفعل');
    if (b.version !== d.version)
      fail(409, 'VERSION_CONFLICT', 'عُدّلت المسودة من نافذة أخرى', { server_version: d.version });
    if (b.confirm !== true) fail(422, 'CONFIRM_REQUIRED', 'الرجوع إلى النموذج الأصلي يمسح تعديلاتك؛ أكّد العملية');
    const t = find(u, d.template_id);
    if (!t) fail(404, 'NOT_FOUND', 'النموذج الأصلي لم يعد متاحًا لجهتك');
    const orig = clonePlan(t);
    if (b.task_id) {
      const o = orig.tasks.find((x) => x.id === b.task_id);
      if (!o) fail(404, 'NOT_FOUND', 'العنصر غير موجود في النموذج الأصلي');
      const i = d.plan.tasks.findIndex((x) => x.id === b.task_id);
      if (i >= 0) d.plan.tasks[i] = { ...o };
      else d.plan.tasks.push({ ...o });
      d.plan = sanitizePlan(d.plan, u);
    } else d.plan = sanitizePlan(orig, u);
    touch(d);
    E.audit({
      actor_id: u.id,
      action: 'template.draft.reset',
      object_type: 'template_draft',
      object_id: d.id,
      detail: b.task_id || 'all',
      org_id: u.org_id,
    });
    return draftView(u, d);
  });
  E.route('POST', '/template-drafts/:id/discard', (ctx) => {
    const d = needDraft(ctx);
    if (d.status !== 'EDITING') fail(409, 'ALREADY_INSTANTIATED', 'أُنشئ المشروع بالفعل');
    S.templateDrafts.splice(S.templateDrafts.indexOf(d), 1);
    E.audit({
      actor_id: ctx.user.id,
      action: 'template.draft.discard',
      object_type: 'template_draft',
      object_id: d.id,
      org_id: ctx.user.org_id,
    });
    return { ok: true };
  });
  E.route('POST', '/template-drafts/:id/save-as-template', (ctx) => {
    const d = needDraft(ctx);
    const u = ctx.user;
    const src = find(u, d.template_id);
    if (!src) fail(404, 'NOT_FOUND', 'النموذج الأصلي غير متاح');
    const c = mkCustom(u, src, d.plan, { name_ar: clean(ctx.body.name, 140) || undefined });
    S.templatesCustom.push(c);
    E.audit({
      actor_id: u.id,
      action: 'template.save_from_draft',
      object_type: 'template',
      object_id: c.id,
      detail: d.id,
      org_id: u.org_id,
    });
    ctx.status = 201;
    return { template: fullView(u, c) };
  });

  // ---------------------------------------------------------------- instantiate: a project in planning state through the existing routes, all-or-nothing
  const sub = (ctx, method, path, body) => {
    const r = E.handle({
      method,
      path,
      body,
      query: {},
      headers: { 'x-session': ctx.headers['x-session'], 'x-correlation-id': ctx.headers['x-correlation-id'] },
    });
    if (r.status >= 400) fail(r.status, r.body.error.code, r.body.error.message, r.body.error.details);
    return r.body;
  };
  const COLL = [
    'projects',
    'workPackages',
    'tasks',
    'requests',
    'delegations',
    'threads',
    'messages',
    'notifications',
    'commitments',
  ];
  const largestRemainder = (parts, total) => {
    const sum = parts.reduce((a, b) => a + b, 0) || 1;
    const raw = parts.map((p) => (p / sum) * total);
    const fl = raw.map(Math.floor);
    let rest = total - fl.reduce((a, b) => a + b, 0);
    raw
      .map((r, i) => [r - fl[i], i])
      .sort((a, b) => b[0] - a[0])
      .forEach(([, i]) => {
        if (rest > 0) {
          fl[i]++;
          rest--;
        }
      });
    return fl;
  };
  E.route('POST', '/template-drafts/:id/instantiate', (ctx) => {
    const d = needDraft(ctx);
    const u = ctx.user;
    needCoord(u);
    const done = S.templateInstances.find((i) => i.draft_id === d.id);
    if (d.status === 'INSTANTIATED' && done) {
      const p = E.project(done.project_id);
      return { project: { id: p.id, ref: p.ref, name: p.name }, instance: done, already: true };
    }
    if (ctx.body.version !== d.version)
      fail(409, 'VERSION_CONFLICT', 'عُدّلت المسودة منذ آخر عرض؛ راجع الملخص ثم أعد المحاولة', {
        server_version: d.version,
      });
    // re-check everything the creation routes will check, so a failure leaves nothing half-built
    if (!d.name) fail(422, 'MISSING_NAME', 'اكتب اسم المشروع');
    const sc = schedule(d.plan.tasks, d.start, calOf(d));
    if (!sc.ok) fail(422, 'DEPENDENCY_CYCLE', 'الاعتماديات تصنع دورة');
    const orgIds = uniq(d.org_proposals.map((r) => r.org_id).filter(Boolean));
    if (!orgIds.length)
      fail(422, 'NO_PARTICIPANTS', 'اقترح جهة مشاركة واحدة على الأقل من الخطوة الرابعة (تصلها دعوة لا تكليف)', {
        step: 4,
      });
    for (const o of orgIds) if (!E.org(o)) fail(422, 'UNKNOWN_ORG', 'جهة غير معروفة');
    if (!d.committee.chair_id || !d.committee.secretary_id)
      fail(422, 'NO_COMMITTEE', 'اختر رئيس اللجنة وأمينها من جهتك', { step: 4 });
    for (const t of d.plan.tasks)
      if (t.assignee_user_id) {
        const au = E.user(t.assignee_user_id);
        if (!au || au.org_id !== u.org_id)
          fail(403, 'CROSS_ORG_ASSIGNMENT', 'مسؤول من خارج جهتك في الخطة', { task: t.id });
      }
    const before = Object.fromEntries(COLL.map((k) => [k, new Set((S[k] || []).map((x) => x.id))]));
    const auditLen = S.audit.length;
    try {
      const end =
        sc.end > d.start
          ? sc.end
          : (() => {
              const dt = new Date(d.start + 'T00:00:00Z');
              dt.setUTCDate(dt.getUTCDate() + 1);
              return dt.toISOString().slice(0, 10);
            })();
      const proj = sub(ctx, 'POST', '/projects', {
        name: d.name,
        objective: d.objective || d.name,
        start: d.start,
        end,
        org_ids: orgIds,
        chair_id: d.committee.chair_id,
        secretary_id: d.committee.secretary_id,
        deputy_id: d.committee.deputy_id || undefined,
      }).project;
      const phaseTasks = d.plan.phases.map((p) => d.plan.tasks.filter((t) => t.phase_id === p.id));
      const len = phaseTasks.map((ts) => {
        const s = ts.map((t) => sc.items[t.id]);
        return ts.length ? Math.max(...s.map((x) => x.ef)) - Math.min(...s.map((x) => x.es)) : 0;
      });
      const weights = largestRemainder(
        len.map((x) => Math.max(1, x)),
        100,
      );
      const wpOfPhase = {};
      const wpIds = [];
      const taskIds = [];
      const reqIds = [];
      d.plan.phases.forEach((p, i) => {
        const ts = phaseTasks[i];
        const its = ts.map((t) => sc.items[t.id]);
        const crit = ts
          .filter((t) => t.kind === 'MILESTONE_GATE')
          .map((g) => `بوابة: ${g.acceptance_criteria || g.name}`);
        const criteria = [
          ...crit,
          ...ts
            .filter((t) => t.kind !== 'MILESTONE_GATE' && t.acceptance_criteria)
            .map((t) => `${t.name}: ${t.acceptance_criteria}`),
        ]
          .map((c) => c.slice(0, 200))
          .slice(0, 10);
        const depPhases = uniq(
          ts
            .flatMap((t) => t.depends_on.map((x) => d.plan.tasks.find((y) => y.id === x)?.phase_id))
            .filter((x) => x && x !== p.id),
        )
          .map((x) => wpOfPhase[x])
          .filter(Boolean);
        const w = sub(ctx, 'POST', `/projects/${proj.id}/work-packages`, {
          title: p.name,
          description: `من النموذج ${d.template_id} — مرحلة ${p.order}. تقدير استرشادي بأيام عمل.`,
          owner_org_id: u.org_id,
          weight: weights[i],
          planned_start: its.map((x) => x.start).sort()[0],
          planned_end: its
            .map((x) => x.end)
            .sort()
            .at(-1),
          depends_on: depPhases,
          criteria,
          required_evidence: 1,
        }).work_package;
        wpOfPhase[p.id] = w.id;
        wpIds.push(w.id);
      });
      for (const t of d.plan.tasks) {
        const it = sc.items[t.id];
        const wp = wpOfPhase[t.phase_id];
        if (t.kind === 'INTERNAL_TASK') {
          const r = sub(ctx, 'POST', '/tasks', {
            project_id: proj.id,
            wp_id: wp,
            title: t.name,
            description:
              `${t.acceptance_criteria}\nالأدلة: ${t.evidence_required.join('، ')}\nمصدر: ${d.template_id} / ${t.id}`.trim(),
            assignee_id: t.assignee_user_id || u.id,
            planned_start: it.start,
            planned_end: it.end,
            est_hours: t.effort_hours,
          });
          taskIds.push(r.task.id);
        } else if (t.kind === 'INTERAGENCY_REQUEST_CANDIDATE' && t.cross_agency_request?.create_draft) {
          const r = sub(ctx, 'POST', '/interagency-requests', {
            project_id: proj.id,
            wp_id: wp,
            title: t.name,
            description:
              `مسودة طلب تنسيق من النموذج ${d.template_id} (${t.id}).\n${t.acceptance_criteria}\nالجهات المقترحة (غير ملزمة): ${t.cross_agency_request.target_org_role_candidates.join('، ')}.\nتُرفع عبر اللجنة، وتقرر الجهة المختصة بالقبول أو الاعتذار المسبَّب.`.slice(
                0,
                3000,
              ),
            required_by: it.start,
            items: [{ title: t.name, spec: `مخرج مطلوب: ${d.objective}`.slice(0, 1000), service_type: 'other' }],
          });
          reqIds.push(r.request.id);
        }
      }
      const inst = {
        id: E.id('tin'),
        draft_id: d.id,
        template_id: d.template_id,
        template_version: d.template_version,
        snapshot_hash: d.template_hash,
        plan_hash: planHash(d.plan),
        project_id: proj.id,
        org_id: u.org_id,
        by: u.id,
        at: E.iso(),
        wp_ids: wpIds,
        task_ids: taskIds,
        request_ids: reqIds,
        schedule: { start: sc.start, end: sc.end, length: sc.length, sequential: sc.sequential },
      };
      S.templateInstances.push(inst);
      d.status = 'INSTANTIATED';
      d.project_id = proj.id;
      touch(d);
      E.audit({
        actor_id: u.id,
        action: 'template.instantiate',
        object_type: 'project',
        object_id: proj.id,
        project_id: proj.id,
        detail: `${d.template_id} v${d.template_version}`,
        org_id: u.org_id,
      });
      ctx.status = 201;
      return {
        project: { id: proj.id, ref: proj.ref, name: proj.name },
        instance: inst,
        summary: {
          work_packages: wpIds.length,
          tasks: taskIds.length,
          request_drafts: reqIds.length,
          invited_orgs: orgIds.length,
        },
      };
    } catch (e) {
      // compensate: remove whatever this call created (the audit chain keeps its entries and records the failure)
      for (const k of COLL)
        if (S[k]) for (let i = S[k].length - 1; i >= 0; i--) if (!before[k].has(S[k][i].id)) S[k].splice(i, 1);
      for (let i = S.templateInstances.length - 1; i >= 0; i--)
        if (S.templateInstances[i].draft_id === d.id) S.templateInstances.splice(i, 1);
      E.audit({
        actor_id: u.id,
        action: 'template.instantiate.rolled_back',
        object_type: 'template_draft',
        object_id: d.id,
        detail: String(e.code || e.message).slice(0, 80),
        outcome: 'failed',
        org_id: u.org_id,
      });
      void auditLen;
      throw e;
    }
  });
  E.route('GET', '/projects/:id/template', (ctx) => {
    const p = E.needProject(ctx.user, ctx.params.id, 'viewer');
    const i = S.templateInstances.find((x) => x.project_id === p.id);
    if (!i) return { instance: null };
    const t = find(ctx.user, i.template_id);
    return {
      instance: {
        template_id: i.template_id,
        template_name: t?.name_ar || null,
        template_version: i.template_version,
        snapshot_hash: i.snapshot_hash,
        at: i.at,
        work_packages: i.wp_ids.length,
        tasks: i.task_ids.length,
        request_drafts: i.request_ids.length,
      },
    };
  });
}
