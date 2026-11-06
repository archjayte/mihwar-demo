// Projects, work packages (WBS, readiness, release, review), change requests, blockers,
// board/timeline/team views, internal tasks and commitments.
import { fail, sha256, clean, isDay, diffDays, addDays, sum, uniq } from './util.mjs';
import * as M from './model.mjs';

export function registerProjects(E) {
  const S = E.state;

  // ---------------------------------------------------------------- progress & delay (computed, never self-declared)
  const wpsOf = (p) => S.workPackages.filter((w) => w.project_id === p.id);
  E.progress = (p) => {
    const list = wpsOf(p);
    const total = sum(list, (w) => w.weight);
    const verified = sum(
      list.filter((w) => ['ACCEPTED', 'CLOSED'].includes(w.status)),
      (w) => w.weight,
    );
    const operational = sum(
      list,
      (w) =>
        w.weight *
        (['ORG_SUBMITTED', 'ACCEPTED', 'CLOSED'].includes(w.status)
          ? 1
          : w.status === 'IN_EXECUTION'
            ? (w.self_pct || 0) / 100
            : 0),
    );
    return {
      verified: total ? Math.round((verified / total) * 100) : 0,
      operational: total ? Math.round((operational / total) * 100) : 0,
      total_weight: total,
    };
  };
  const approvedBlockerDays = (wpId) =>
    sum(
      S.issues.filter((i) => i.wp_id === wpId && i.kind === 'external' && i.status === 'APPROVED'),
      (i) => i.days,
    );
  const wpDelay = (w) => {
    const today = E.today();
    let actual = 0;
    // The executing org is accountable until it hands the deliverable over; time spent waiting for the reviewer is not counted against it.
    if (['ORG_SUBMITTED', 'ACCEPTED', 'CLOSED'].includes(w.status))
      actual = Math.max(0, diffDays(w.planned_end, (w.submitted_at || w.accepted_at || today).slice(0, 10)));
    else actual = Math.max(0, diffDays(w.planned_end, today));
    const ext = Math.min(actual, approvedBlockerDays(w.id));
    return { actual, external_approved: ext, accountable: Math.max(0, actual - ext) };
  };
  E.wpDelay = wpDelay;

  const depsOf = (w) => w.depends_on.map((id) => E.wp(id)).filter(Boolean);
  const depsOk = (w) => depsOf(w).every((d) => ['ACCEPTED', 'CLOSED'].includes(d.status));

  // ---------------------------------------------------------------- readiness
  const readinessOf = (w, p) => {
    const part = p.participation?.[w.owner_org_id];
    const open = S.issues.filter(
      (i) => i.wp_id === w.id && ['OPEN', 'PROPOSED'].includes(i.status) && i.kind === 'internal' && i.blocking,
    );
    const checks = [
      { key: 'owner', label: 'جهة منفذة ومسؤول محدد', ok: !!w.owner_org_id && !!w.owner_user_id },
      {
        key: 'participation',
        label: 'الجهة المنفذة قبلت المشاركة في المشروع',
        ok: w.owner_org_id === p.lead_org_id || part?.status === 'ACCEPTED',
      },
      { key: 'weight', label: 'وزن الحزمة محدد', ok: w.weight > 0 },
      { key: 'criteria', label: 'معايير القبول مكتوبة', ok: w.criteria.length > 0 },
      {
        key: 'deps',
        label: 'الحزم السابقة مقبولة',
        ok: depsOk(w),
        detail: depsOf(w)
          .filter((d) => !['ACCEPTED', 'CLOSED'].includes(d.status))
          .map((d) => d.ref)
          .join('، '),
      },
      { key: 'baseline', label: 'خطة المشروع (خط الأساس) معتمدة', ok: !!p.baseline_frozen },
      { key: 'blockers', label: 'لا عوائق مفتوحة تمنع البدء', ok: open.length === 0 },
    ];
    const snapshot = sha256(
      JSON.stringify([
        w.owner_org_id,
        w.owner_user_id,
        w.weight,
        w.planned_start,
        w.planned_end,
        w.depends_on,
        w.criteria,
        p.baseline_version,
        !!p.baseline_frozen,
        part?.status,
      ]),
    );
    return { ok: checks.every((c) => c.ok), checks, snapshot };
  };

  // ---------------------------------------------------------------- views
  E.evidenceVisibleFor = (u, w, p) => evidenceVisible(u, w, p);
  const ownerOp = (u, w) => u.org_id === w.owner_org_id && !E.hasRole(u, 'SCOPED_VIEWER');
  const ownerSup = (u, w) => u.org_id === w.owner_org_id && E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN');
  const evidenceVisible = (u, w, p) =>
    u.org_id === w.owner_org_id ||
    u.org_id === p.lead_org_id ||
    !!E.committeeRole(u, p) ||
    !!E.findDelegation(u, 'accept_deliverable', p.id) ||
    E.hasRole(u, 'FINAL_AUDITOR');

  const wpActions = (u, w, p) => {
    const caps = E.caps(u, p);
    const a = [];
    const add = (key, label, enabled, reason, kind = 'secondary') =>
      a.push({ key, label, enabled: !!enabled, reason: enabled ? null : reason, kind });
    const coordOrSup = caps.create_wp || ownerSup(u, w);
    if (['DRAFT', 'AWAITING_RELEASE'].includes(w.status) && coordOrSup)
      add('check-readiness', 'فحص الجاهزية', true, null, 'secondary');
    if (w.status === 'AWAITING_RELEASE' && (caps.release || caps.create_wp))
      add('release', 'إصدار تصريح البدء', caps.release, 'لا تملك تفويض «إصدار تصريح البدء» في هذا المشروع', 'primary');
    if (w.status === 'RELEASED' && ownerOp(u, w)) add('start', 'بدء التنفيذ', true, null, 'primary');
    if (['IN_EXECUTION'].includes(w.status) && ownerOp(u, w)) {
      add('add-evidence', 'إرفاق دليل', true, null, 'secondary');
      const ev = w.evidence.length >= w.required_evidence;
      add(
        'submit',
        'تسليم للمراجعة',
        ownerSup(u, w) && ev,
        ownerSup(u, w) ? `أرفق ${w.required_evidence} دليلًا على الأقل قبل التسليم` : 'التسليم للمشرف أو مدير الجهة',
        'primary',
      );
    }
    if (w.status === 'ORG_SUBMITTED') {
      if (ownerOp(u, w)) add('withdraw', 'سحب التسليم', true, null, 'secondary');
      if (caps.review_deliverable || (caps.lead && caps.create_wp)) {
        const indep = u.org_id !== w.owner_org_id && u.id !== w.submitted_by;
        add(
          'review',
          'مراجعة المخرج',
          caps.review_deliverable && indep,
          !caps.review_deliverable ? 'لا تملك تفويض «قبول المخرجات»' : 'لا يجوز للجهة المنفذة قبول مخرجها بنفسها',
          'primary',
        );
      }
    }
    if (w.status === 'ACCEPTED' && caps.create_wp) add('close', 'إغلاق الحزمة', true, null, 'secondary');
    if (['IN_EXECUTION', 'RELEASED'].includes(w.status) && ownerOp(u, w))
      add('raise-issue', 'تسجيل عائق', true, null, 'secondary');
    return a;
  };

  // Counts and targets that connect a project to the registers, chat and committee screens. The register totals come from the register routes themselves,
  // so the number shown here is always the number the linked list will show (same visibility rules, no second implementation).
  const regTotal = (ctx, path, project_id) => {
    const r = E.handle({
      method: 'GET',
      path,
      query: { project_id },
      body: null,
      headers: { 'x-session': ctx.headers?.['x-session'], 'x-correlation-id': ctx.headers?.['x-correlation-id'] },
    });
    return r.status === 200 && Number.isFinite(r.body.total) ? r.body.total : null;
  };
  const relatedOfProject = (ctx, u, p, reqs, wps) => {
    const inst = S.templateInstances?.find((x) => x.project_id === p.id);
    const tpl = inst
      ? E.officialTemplate?.(inst.template_id) || S.templatesCustom?.find((c) => c.id === inst.template_id) || null
      : null;
    return {
      decisions: regTotal(ctx, '/registers/decisions', p.id),
      evidence: regTotal(ctx, '/registers/evidence', p.id),
      tasks: S.tasks.filter((t) => t.project_id === p.id && E.taskVisible(u, t)).length,
      threads: S.threads.filter((t) => t.project_id === p.id && (t.member_ids || []).includes(u.id)).length,
      requests: reqs.length,
      work_packages: wps.length,
      template: inst
        ? {
            template_id: inst.template_id,
            name: tpl?.name_ar || null,
            version: inst.template_version,
            snapshot_hash: (inst.snapshot_hash || '').slice(0, 12),
          }
        : null,
    };
  };
  const wpView = (u, w, p, detail = false) => {
    const rd = ['DRAFT', 'AWAITING_RELEASE'].includes(w.status) || detail ? readinessOf(w, p) : null;
    const v = {
      id: w.id,
      ref: w.ref,
      project_id: w.project_id,
      title: w.title,
      description: w.description,
      owner_org_id: w.owner_org_id,
      owner_org_name: E.oname(w.owner_org_id),
      owner_user_id: w.owner_user_id,
      owner_name: w.owner_user_id ? E.uname(w.owner_user_id) : null,
      weight: w.weight,
      indivisible: w.indivisible,
      status: w.status,
      status_ar: M.WP_STATUS[w.status].ar,
      tone: M.WP_STATUS[w.status].tone,
      planned_start: w.planned_start,
      planned_end: w.planned_end,
      baseline_start: w.baseline_start,
      baseline_end: w.baseline_end,
      baseline_version: w.baseline_version,
      depends_on: depsOf(w).map((d) => ({
        id: d.id,
        ref: d.ref,
        title: d.title,
        status: d.status,
        done: ['ACCEPTED', 'CLOSED'].includes(d.status),
      })),
      deps_ok: depsOk(w),
      criteria: w.criteria,
      required_evidence: w.required_evidence,
      evidence_count: w.evidence.length,
      self_pct: w.self_pct || 0,
      delay: wpDelay(w),
      version: w.version,
      mine: u.org_id === w.owner_org_id,
      open_issues: S.issues.filter((i) => i.wp_id === w.id && ['OPEN', 'PROPOSED'].includes(i.status)).length,
      readiness: rd,
      release: w.release || null,
      actions: wpActions(u, w, p),
    };
    if (detail) {
      v.evidence = evidenceVisible(u, w, p)
        ? w.evidence.map((e) => ({
            ...e,
            by_name: E.uname(e.by),
            can_download: !!e.file_id && E.canReadFile(u, E.file(e.file_id)),
            ...E.fileGrantInfo(u, e),
          }))
        : [];
      v.evidence_hidden = !evidenceVisible(u, w, p);
      v.history = w.history.map((h) => ({ ...h, actor_name: E.uname(h.actor_id) }));
      v.issues = S.issues.filter((i) => i.wp_id === w.id).map(issueView);
      v.accepted_by_name = w.accepted_by ? E.uname(w.accepted_by) : null;
      v.related = relatedOfWp(u, w, p);
    }
    return v;
  };

  // What is connected to a work package, limited to what this user may see: the requests that serve it, the commitments they produced, the tasks under them,
  // the decisions and permits that concern them, and the packages it waits for. Everything is a link target; nothing here changes any state.
  const relatedOfWp = (u, w, p) => {
    const reqs = S.requests.filter((r) => r.wp_id === w.id && E.reqVisible(u, r));
    const rid = new Set(reqs.map((r) => r.id));
    const cmts = S.commitments.filter((c) => rid.has(c.request_id));
    const cid = new Set(cmts.map((c) => c.id));
    const tasks = S.tasks.filter((t) => (t.wp_id === w.id || cid.has(t.commitment_id)) && E.taskVisible(u, t));
    const decisions = [];
    if (E.access(u, p) !== 'meta') {
      for (const d of S.decisions)
        if (d.project_id === p.id && d.request_id && rid.has(d.request_id))
          decisions.push({
            type: 'committee',
            label: 'قرار / محضر لجنة',
            title: d.title,
            ref: d.ref,
            at: d.at || d.created_at || null,
            request_id: d.request_id,
          });
      for (const r of reqs)
        for (const d of r.decisions || [])
          decisions.push({
            type: 'org_decision',
            label: 'قرار جهة مختصة',
            title: `${{ ACCEPT: 'قبول', DECLINE: 'اعتذار', COUNTER: 'مقترح بديل', NEED_INFO: 'طلب استكمال' }[d.type] || d.type} — ${r.title}`,
            ref: r.ref,
            at: d.at || null,
            request_id: r.id,
          });
      if (w.release)
        decisions.push({
          type: 'permit',
          label: 'تصريح بدء',
          title: `تصريح بدء ${w.ref}`,
          ref: w.release.order_no,
          at: w.release.at || null,
          request_id: null,
        });
    }
    return {
      requests: reqs.map((r) => ({
        id: r.id,
        ref: r.ref,
        title: r.title,
        status_ar: M.REQUEST_STATUS[r.status]?.ar || r.status,
        target_org_name: r.target_org_id ? E.oname(r.target_org_id) : null,
      })),
      commitments: cmts.map((c) => ({
        id: c.id,
        request_id: c.request_id,
        org_name: E.oname(c.org_id),
        status: c.status,
        due_on: c.due_on,
      })),
      tasks: tasks.slice(0, 20).map((t) => ({
        id: t.id,
        ref: t.ref,
        title: t.title,
        status_ar: M.TASK_STATUS[t.status]?.ar || t.status,
        assignee_name: E.uname(t.assignee_id),
        request_id: t.commitment_id ? E.commitment(t.commitment_id)?.request_id || null : null,
      })),
      tasks_total: tasks.length,
      decisions: decisions.slice(0, 12),
      decisions_total: decisions.length,
      depends_on: (w.depends_on || [])
        .map((id) => E.wp(id))
        .filter(Boolean)
        .map((x) => ({ id: x.id, ref: x.ref, title: x.title, status_ar: M.WP_STATUS?.[x.status]?.ar || x.status })),
      dependents: S.workPackages
        .filter((x) => x.project_id === p.id && (x.depends_on || []).includes(w.id))
        .map((x) => ({ id: x.id, ref: x.ref, title: x.title })),
    };
  };
  const issueView = (i) => ({
    ...i,
    raised_by_name: E.uname(i.raised_by),
    decided_by_name: i.decided_by ? E.uname(i.decided_by) : null,
    wp_ref: E.wp(i.wp_id)?.ref,
  });

  const hist = (w, u, action, note, from, to) =>
    w.history.push({ at: E.iso(), actor_id: u.id, action, note: note || '', from: from || null, to: to || null });

  // ---------------------------------------------------------------- projects
  const projectCard = (u, p) => {
    const pr = E.progress(p);
    const caps = E.caps(u, p);
    const wps = wpsOf(p);
    return {
      id: p.id,
      ref: p.ref,
      name: p.name,
      objective: p.objective,
      status: p.status,
      start: p.start,
      end: p.end,
      lead_org: E.oname(p.lead_org_id),
      orgs: [p.lead_org_id, ...p.org_ids.filter((o) => o !== p.lead_org_id)].map((o) => ({ id: o, name: E.oname(o) })),
      progress: pr,
      wp_count: wps.length,
      delayed: wps.filter((w) => wpDelay(w).accountable > 0 && !['ACCEPTED', 'CLOSED'].includes(w.status)).length,
      baseline_frozen: !!p.baseline_frozen,
      caps: {
        level: caps.level,
        create_wp: caps.create_wp,
        create_request: caps.create_request,
        manage_project: caps.manage_project,
        committee_role: caps.committee_role,
      },
    };
  };

  E.route('GET', '/projects', (ctx) => {
    const u = ctx.user;
    const items = E.projectsFor(u).map((p) => projectCard(u, p));
    const invitations = S.projects
      .filter(
        (p) => p.participation?.[u.org_id]?.status === 'INVITED' && E.findDelegation(u, 'commit', p.id) !== undefined,
      )
      .map((p) => ({
        id: p.id,
        name: p.name,
        objective: p.objective,
        lead_org: E.oname(p.lead_org_id),
        start: p.start,
        end: p.end,
        can_decide: !!E.findDelegation(u, 'commit', '*') || !!E.findDelegation(u, 'commit', p.id),
      }));
    return { items, invitations, can_create: E.hasRole(u, 'COORDINATING_ADMIN') };
  });

  E.route('POST', '/projects', (ctx) => {
    const u = ctx.user;
    const b = ctx.body;
    if (!E.hasRole(u, 'COORDINATING_ADMIN')) fail(403, 'NO_PERMISSION', 'إنشاء المشاريع لمنسّق الجهة القائدة');
    const name = clean(b.name, 140);
    if (!name) fail(422, 'MISSING_NAME', 'اكتب اسم المشروع');
    if (!isDay(b.start) || !isDay(b.end) || b.end <= b.start)
      fail(422, 'BAD_DATES', 'حدّد تاريخ بداية ونهاية صحيحين (النهاية بعد البداية)');
    const orgIds = uniq((b.org_ids || []).map((x) => clean(x, 40))).filter((o) => o !== u.org_id);
    if (!orgIds.length) fail(422, 'NO_PARTICIPANTS', 'اختر جهة مشاركة واحدة على الأقل');
    for (const o of orgIds) if (!E.org(o) || E.org(o).kind === 'platform') fail(422, 'UNKNOWN_ORG', 'جهة غير معروفة');
    const chair = E.user(clean(b.chair_id, 40));
    const sec = E.user(clean(b.secretary_id, 40));
    if (!chair || chair.org_id !== u.org_id) fail(422, 'BAD_CHAIR', 'رئيس اللجنة يُختار من الجهة القائدة');
    if (!sec || sec.org_id !== u.org_id || sec.id === chair.id)
      fail(422, 'BAD_SECRETARY', 'أمين اللجنة يُختار من الجهة القائدة ويختلف عن الرئيس');
    const dep = b.deputy_id ? E.user(clean(b.deputy_id, 40)) : null;
    if (b.deputy_id && (!dep || dep.org_id !== u.org_id || dep.id === chair.id || dep.id === sec.id))
      fail(422, 'BAD_DEPUTY', 'نائب الرئيس يُختار من الجهة القائدة ويختلف عن الرئيس والأمين');
    const n = ++S.meta.seq.proj_n;
    const p = {
      id: E.id('prj'),
      ref: `PRJ-${String(n).padStart(3, '0')}`,
      name,
      objective: clean(b.objective, 800),
      status: 'PLANNING',
      start: b.start,
      end: b.end,
      lead_org_id: u.org_id,
      org_ids: [u.org_id],
      created_by: u.id,
      baseline_frozen: false,
      baseline_version: 0,
      participation: Object.fromEntries(orgIds.map((o) => [o, { status: 'INVITED', at: E.iso() }])),
      committee: { chair_id: chair.id, deputy_id: dep?.id || null, secretary_id: sec.id, member_ids: [] },
    };
    S.projects.push(p);
    const mk = (user_id, action, basis) =>
      S.delegations.push({
        id: E.id('dlg'),
        user_id,
        org_id: E.user(user_id).org_id,
        action,
        project_ids: [p.id],
        service_types: ['*'],
        valid_from: E.today(),
        valid_to: p.end,
        basis,
        granted_by: u.id,
        revoked: false,
      });
    mk(chair.id, 'route', 'ميثاق المشروع — منح تلقائي عند الإنشاء');
    mk(chair.id, 'close_request', 'ميثاق المشروع — منح تلقائي عند الإنشاء');
    mk(u.id, 'release', 'ميثاق المشروع — منح تلقائي عند الإنشاء');
    mk(u.id, 'approve_change', 'ميثاق المشروع — منح تلقائي عند الإنشاء');
    E.createThread({
      project_id: p.id,
      kind: 'project',
      title: `قناة مشروع: ${name}`,
      member_ids: [u.id, chair.id, sec.id],
      created_by: u.id,
    });
    E.audit({
      actor_id: u.id,
      action: 'project.create',
      object_type: 'project',
      object_id: p.id,
      project_id: p.id,
      detail: name,
    });
    for (const o of orgIds)
      E.notify(
        E.orgUsers(o)
          .filter(
            (x) =>
              E.hasRole(x, 'ORG_ADMIN') ||
              S.delegations.some((d) => d.user_id === x.id && d.action === 'commit' && !d.revoked),
          )
          .map((x) => x.id),
        {
          kind: 'invite',
          title: `دعوة للمشاركة في مشروع «${name}»`,
          body: 'راجع الدعوة واقبل المشاركة أو اعتذر بسبب.',
          link: '#/projects',
          project_id: p.id,
        },
      );
    ctx.status = 201;
    return { project: projectCard(u, p) };
  });
  S.meta.seq.proj_n ||= S.projects.length;

  E.route('POST', '/projects/:id/participation', (ctx) => {
    const p = E.project(ctx.params.id);
    const u = ctx.user;
    const part = p?.participation?.[u.org_id];
    if (!p || !part) fail(404, 'NOT_FOUND', 'لا توجد دعوة لجهتك على هذا المشروع');
    if (!S.delegations.some((d) => d.user_id === u.id && d.action === 'commit' && !d.revoked && d.org_id === u.org_id))
      fail(403, 'NO_DELEGATION', 'قبول المشاركة يصدر من مفوّض الجهة بالرد الرسمي');
    if (part.status !== 'INVITED') fail(409, 'INVALID_TRANSITION', 'سبق الرد على هذه الدعوة');
    const accept = ctx.body.decision === 'accept';
    const reason = clean(ctx.body.reason, 500);
    if (!accept && !reason) fail(422, 'MISSING_REJECTION_REASON', 'اكتب سبب الاعتذار عن المشاركة');
    part.status = accept ? 'ACCEPTED' : 'DECLINED';
    part.by = u.id;
    part.decided_at = E.iso();
    part.reason = reason;
    if (accept) {
      p.org_ids.push(u.org_id);
      const pt = S.threads.find((t) => t.project_id === p.id && t.kind === 'project');
      if (pt) pt.member_ids = uniq([...pt.member_ids, u.id]);
    }
    E.audit({
      actor_id: u.id,
      action: accept ? 'project.participation.accept' : 'project.participation.decline',
      object_type: 'project',
      object_id: p.id,
      project_id: p.id,
      reason,
    });
    E.notify([p.committee.chair_id, p.committee.secretary_id, p.created_by], {
      kind: 'participation',
      title: `${E.oname(u.org_id)} ${accept ? 'قبلت' : 'اعتذرت عن'} المشاركة في «${p.name}»`,
      body: reason,
      link: `#/p/${p.id}/overview`,
      project_id: p.id,
    });
    return { ok: true, status: part.status };
  });

  E.route('GET', '/projects/:id', (ctx) => {
    const u = ctx.user;
    const p = E.needProject(u, ctx.params.id, 'meta');
    const card = projectCard(u, p);
    const caps = E.caps(u, p);
    const meta = caps.level === 'meta';
    const orgs = [
      p.lead_org_id,
      ...p.org_ids.filter((o) => o !== p.lead_org_id),
      ...Object.keys(p.participation || {}).filter((o) => !p.org_ids.includes(o)),
    ].map((o) => {
      const reps = E.orgUsers(o).filter(
        (x) =>
          S.delegations.some((d) => d.user_id === x.id && d.action === 'commit' && !d.revoked) ||
          (o === p.lead_org_id && E.hasRole(x, 'COORDINATING_ADMIN')),
      );
      return {
        id: o,
        name: E.oname(o),
        role: o === p.lead_org_id ? 'lead' : 'participant',
        status: o === p.lead_org_id ? 'ACCEPTED' : p.participation?.[o]?.status || 'ACCEPTED',
        reps: reps.map((x) => ({ id: x.id, name: x.name, title: x.title })),
      };
    });
    const committee = {
      chair: { id: p.committee.chair_id, name: E.uname(p.committee.chair_id) },
      deputy: p.committee.deputy_id ? { id: p.committee.deputy_id, name: E.uname(p.committee.deputy_id) } : null,
      secretary: { id: p.committee.secretary_id, name: E.uname(p.committee.secretary_id) },
      members: p.committee.member_ids.map((id) => ({ id, name: E.uname(id), org: E.oname(E.user(id).org_id) })),
    };
    const base = { project: { ...card, caps }, orgs, committee };
    if (meta) return { ...base, limited: true };
    const reqs = S.requests.filter((r) => r.project_id === p.id && E.reqVisible(u, r));
    const wps = wpsOf(p);
    const steps = [];
    if (caps.create_wp && !p.baseline_frozen)
      steps.push(
        wps.length
          ? {
              text: 'راجع الأوزان (المجموع ١٠٠٪) ثم اعتمد خطة المشروع لتفعيل تصاريح البدء.',
              link: `#/p/${p.id}/board`,
              cta: 'افتح لوحة العمل',
            }
          : {
              text: 'ابدأ بإضافة حزم العمل الرئيسية للمشروع مع الجهة المنفذة والوزن.',
              link: `#/p/${p.id}/board`,
              cta: 'أضف حزمة عمل',
            },
      );
    if (caps.create_request && !reqs.length)
      steps.push({
        text: 'تحتاج إجراءً من جهة أخرى؟ ارفع طلبًا إلى لجنة المشروع وهي توجّهه للجهة المختصة.',
        link: `#/requests/new?project=${p.id}`,
        cta: 'طلب مساندة جديد',
      });
    const rq = (st) => reqs.filter((r) => st.includes(r.status)).length;
    return {
      ...base,
      steps,
      stats: {
        requests_total: reqs.length,
        at_committee: rq(['SUBMITTED_TO_COMMITTEE', 'PENDING_CHAIR_ROUTING']),
        at_org: rq(['REFERRED_TO_ORG', 'UNDER_ORG_REVIEW', 'COUNTERPROPOSAL']),
        declined: rq(['DECLINED_WITH_REASON']),
        in_execution: rq(['ACCEPTED_BY_ORG', 'IN_EXECUTION', 'BLOCKED', 'RETURNED_FOR_CORRECTION']),
        awaiting_review: wps.filter((w) => w.status === 'ORG_SUBMITTED').length + rq(['ORG_SUBMITTED']),
        wp_awaiting_release: wps.filter((w) => w.status === 'AWAITING_RELEASE').length,
        cr_pending: S.changeRequests.filter((c) => c.project_id === p.id && c.status === 'PENDING').length,
      },
      baseline: { frozen: !!p.baseline_frozen, version: p.baseline_version, weight_total: sum(wps, (w) => w.weight) },
      related: relatedOfProject(ctx, u, p, reqs, wps),
    };
  });

  E.route('POST', '/projects/:id/freeze-baseline', (ctx) => {
    const p = E.needProject(ctx.user, ctx.params.id, 'member');
    const caps = E.caps(ctx.user, p);
    if (!caps.manage_project) fail(403, 'NO_PERMISSION', 'اعتماد خط الأساس للمنسّق في الجهة القائدة');
    if (p.baseline_frozen) fail(409, 'INVALID_TRANSITION', 'خط الأساس معتمد مسبقًا');
    const wps = wpsOf(p);
    const tot = sum(wps, (w) => w.weight);
    if (!wps.length) fail(422, 'NO_WORK_PACKAGES', 'أضف حزم العمل أولًا');
    if (tot !== 100)
      fail(422, 'WEIGHTS_NOT_100', `مجموع الأوزان ${tot}٪ — يجب أن يكون ١٠٠٪ قبل الاعتماد`, { total: tot });
    wps.forEach((w) => {
      w.baseline_start = w.planned_start;
      w.baseline_end = w.planned_end;
      w.baseline_version = 1;
    });
    p.baseline_frozen = true;
    p.baseline_version = 1;
    p.status = 'ACTIVE';
    E.audit({
      actor_id: ctx.user.id,
      action: 'baseline.freeze',
      object_type: 'project',
      object_id: p.id,
      project_id: p.id,
      to: 'v1',
      detail: `${wps.length} حزمة`,
    });
    E.notify(
      E.projectMembers(p),
      {
        kind: 'baseline',
        title: `اعتُمدت خطة مشروع «${p.name}»`,
        body: 'أي تعديل في المواعيد أو الأوزان يمر عبر طلب تغيير.',
        link: `#/p/${p.id}/timeline`,
        project_id: p.id,
      },
      ctx.user.id,
    );
    return { ok: true };
  });

  E.route('POST', '/projects/:id/close', (ctx) => {
    const p = E.needProject(ctx.user, ctx.params.id, 'member');
    const caps = E.caps(ctx.user, p);
    if (!caps.manage_project && caps.committee_role !== 'chair')
      fail(403, 'NO_PERMISSION', 'إغلاق المشروع لمنسّق الجهة القائدة أو رئيس اللجنة');
    const openCommit = S.commitments.filter((c) => c.project_id === p.id && c.status === 'ACTIVE');
    const openReq = S.requests.filter((r) => r.project_id === p.id && !M.TERMINAL.includes(r.status));
    const openWps = wpsOf(p).filter((w) => !['ACCEPTED', 'CLOSED'].includes(w.status));
    if (openCommit.length || openReq.length || openWps.length)
      fail(409, 'OPEN_COMMITMENTS', 'لا يمكن إغلاق المشروع قبل إنهاء الالتزامات والطلبات وحزم العمل المفتوحة', {
        project_id: p.id,
        commitments: openCommit.map((c) => ({ id: c.id, org: E.oname(c.org_id), request: E.req(c.request_id)?.ref })),
        requests: openReq.map((r) => ({ id: r.id, ref: r.ref, status: M.REQUEST_STATUS[r.status].ar })),
        work_packages: openWps.map((w) => ({ id: w.id, ref: w.ref, title: w.title })),
      });
    p.status = 'CLOSED';
    E.audit({
      actor_id: ctx.user.id,
      action: 'project.close',
      object_type: 'project',
      object_id: p.id,
      project_id: p.id,
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- work packages
  const needWp = (ctx, min = 'member') => {
    const w = E.wp(ctx.params.id);
    if (!w) fail(404, 'NOT_FOUND', 'حزمة العمل غير موجودة');
    const p = E.needProject(ctx.user, w.project_id, min);
    return { w, p };
  };
  const checkDates = (s, e) => {
    if (!isDay(s) || !isDay(e) || e < s)
      fail(422, 'BAD_DATES', 'حدّد تاريخ بداية ونهاية صحيحين (النهاية لا تسبق البداية)');
  };
  const wouldCycle = (w, deps) => {
    const seen = new Set();
    const walk = (id) => {
      if (id === w.id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return (E.wp(id)?.depends_on || []).some(walk);
    };
    return deps.some(walk);
  };

  E.route('GET', '/projects/:id/work-packages', (ctx) => {
    const p = E.needProject(ctx.user, ctx.params.id, 'viewer');
    return { items: wpsOf(p).map((w) => wpView(ctx.user, w, p)) };
  });

  E.route('POST', '/projects/:id/work-packages', (ctx) => {
    const p = E.needProject(ctx.user, ctx.params.id, 'member');
    const u = ctx.user;
    const b = ctx.body;
    if (!E.caps(u, p).create_wp) fail(403, 'NO_PERMISSION', 'إضافة حزم العمل لمنسّق المشروع');
    if (p.baseline_frozen)
      fail(409, 'BASELINE_FROZEN', 'خط الأساس معتمد؛ إضافة حزمة جديدة تحتاج طلب تغيير', {
        project_id: p.id,
        path: 'change-request',
      });
    const title = clean(b.title, 140);
    if (!title) fail(422, 'MISSING_TITLE', 'اكتب عنوان حزمة العمل');
    const owner = clean(b.owner_org_id, 40);
    if (!E.orgParticipates(owner, p)) fail(422, 'BAD_OWNER_ORG', 'اختر جهة منفذة من جهات المشروع');
    const ou = b.owner_user_id ? E.user(clean(b.owner_user_id, 40)) : null;
    if (ou && ou.org_id !== owner) fail(403, 'CROSS_ORG_ASSIGNMENT', 'المسؤول يجب أن يكون من الجهة المنفذة');
    checkDates(b.planned_start, b.planned_end);
    const weight = Math.round(Number(b.weight) || 0);
    if (weight < 0 || weight > 100) fail(422, 'BAD_WEIGHT', 'الوزن بين 0 و100');
    if (sum(wpsOf(p), (w) => w.weight) + weight > 100) fail(422, 'WEIGHT_OVERFLOW', 'مجموع الأوزان يتجاوز ١٠٠٪');
    const deps = uniq((b.depends_on || []).map((x) => clean(x, 40)));
    for (const d of deps) if (E.wp(d)?.project_id !== p.id) fail(422, 'BAD_DEPENDENCY', 'اعتمادية غير صالحة');
    const n = wpsOf(p).length + 1;
    const w = {
      id: E.id('wp'),
      ref: `${p.ref.replace('PRJ-', 'WP')}-${String(n).padStart(2, '0')}`,
      project_id: p.id,
      title,
      description: clean(b.description, 1000),
      owner_org_id: owner,
      owner_user_id: ou?.id || null,
      weight,
      indivisible: !!b.indivisible,
      status: 'DRAFT',
      planned_start: b.planned_start,
      planned_end: b.planned_end,
      baseline_start: null,
      baseline_end: null,
      baseline_version: 0,
      depends_on: deps,
      criteria: (Array.isArray(b.criteria) ? b.criteria : [])
        .map((c) => clean(c, 200))
        .filter(Boolean)
        .slice(0, 10),
      required_evidence: Math.min(5, Math.max(1, Math.round(Number(b.required_evidence) || 1))),
      evidence: [],
      self_pct: 0,
      history: [],
      version: 1,
      created_at: E.iso(),
    };
    S.workPackages.push(w);
    hist(w, u, 'create', 'إنشاء حزمة العمل');
    E.audit({
      actor_id: u.id,
      action: 'wp.create',
      object_type: 'work_package',
      object_id: w.id,
      project_id: p.id,
      detail: w.title,
    });
    ctx.status = 201;
    return { work_package: wpView(u, w, p) };
  });

  E.route('GET', '/work-packages/:id', (ctx) => {
    const { w, p } = needWp(ctx, 'viewer');
    return {
      work_package: wpView(ctx.user, w, p, true),
      project: { id: p.id, name: p.name, baseline_frozen: !!p.baseline_frozen },
    };
  });

  E.route('PATCH', '/work-packages/:id', (ctx) => {
    const { w, p } = needWp(ctx, 'member');
    const u = ctx.user;
    const b = ctx.body;
    const caps = E.caps(u, p);
    const coord = caps.create_wp;
    const sup = ownerSup(u, w);
    if (!coord && !sup) fail(403, 'NO_PERMISSION', 'لا تملك صلاحية تعديل هذه الحزمة');
    const before = JSON.stringify([w.title, w.owner_user_id, w.self_pct]);
    if (sup && 'owner_user_id' in b) {
      const ou = E.user(clean(b.owner_user_id, 40));
      if (!ou || ou.org_id !== w.owner_org_id)
        fail(403, 'CROSS_ORG_ASSIGNMENT', 'المسؤول يجب أن يكون من الجهة المنفذة');
      w.owner_user_id = ou.id;
    }
    if ((sup || coord) && 'self_pct' in b) {
      const v = Math.round(Number(b.self_pct));
      if (!(v >= 0 && v <= 100)) fail(422, 'BAD_PCT', 'النسبة بين 0 و100');
      w.self_pct = v;
    }
    if (coord) {
      const touchesBaseline =
        ('weight' in b && Number(b.weight) !== w.weight) ||
        ('planned_start' in b && b.planned_start !== w.planned_start) ||
        ('planned_end' in b && b.planned_end !== w.planned_end) ||
        ('depends_on' in b && JSON.stringify(b.depends_on) !== JSON.stringify(w.depends_on));
      if (p.baseline_frozen && touchesBaseline)
        fail(409, 'BASELINE_FROZEN', 'الوزن والمواعيد والاعتماديات مجمّدة بعد اعتماد الخطة — قدّم طلب تغيير', {
          project_id: p.id,
          path: 'change-request',
        });
      if (
        ['RELEASED', 'IN_EXECUTION', 'ORG_SUBMITTED', 'ACCEPTED', 'CLOSED'].includes(w.status) &&
        ('owner_org_id' in b || 'criteria' in b)
      )
        fail(409, 'INVALID_TRANSITION', 'لا يمكن تغيير الجهة أو معايير القبول بعد إصدار التصريح');
      if ('title' in b) {
        const t = clean(b.title, 140);
        if (!t) fail(422, 'MISSING_TITLE', 'العنوان مطلوب');
        w.title = t;
      }
      if ('description' in b) w.description = clean(b.description, 1000);
      if ('criteria' in b)
        w.criteria = (b.criteria || [])
          .map((c) => clean(c, 200))
          .filter(Boolean)
          .slice(0, 10);
      if ('required_evidence' in b)
        w.required_evidence = Math.min(5, Math.max(1, Math.round(Number(b.required_evidence) || 1)));
      if ('indivisible' in b) w.indivisible = !!b.indivisible;
      if ('owner_org_id' in b) {
        const o = clean(b.owner_org_id, 40);
        if (!E.orgParticipates(o, p)) fail(422, 'BAD_OWNER_ORG', 'جهة غير مشاركة');
        if (o !== w.owner_org_id) {
          w.owner_org_id = o;
          w.owner_user_id = null;
        }
      }
      if ('owner_user_id' in b && !sup) {
        const ou = b.owner_user_id ? E.user(clean(b.owner_user_id, 40)) : null;
        if (ou && ou.org_id !== w.owner_org_id)
          fail(403, 'CROSS_ORG_ASSIGNMENT', 'المسؤول يجب أن يكون من الجهة المنفذة');
        w.owner_user_id = ou?.id || null;
      }
      if (!p.baseline_frozen) {
        if ('weight' in b) {
          const nw = Math.round(Number(b.weight));
          if (!(nw >= 0 && nw <= 100)) fail(422, 'BAD_WEIGHT', 'الوزن بين 0 و100');
          if (
            sum(
              wpsOf(p).filter((x) => x.id !== w.id),
              (x) => x.weight,
            ) +
              nw >
            100
          )
            fail(422, 'WEIGHT_OVERFLOW', 'مجموع الأوزان يتجاوز ١٠٠٪');
          w.weight = nw;
        }
        if ('planned_start' in b || 'planned_end' in b) {
          const s = b.planned_start || w.planned_start;
          const e = b.planned_end || w.planned_end;
          checkDates(s, e);
          w.planned_start = s;
          w.planned_end = e;
        }
        if ('depends_on' in b) {
          const deps = uniq((b.depends_on || []).map((x) => clean(x, 40)));
          for (const d of deps) if (E.wp(d)?.project_id !== p.id) fail(422, 'BAD_DEPENDENCY', 'اعتمادية غير صالحة');
          if (wouldCycle(w, deps)) fail(422, 'DEPENDENCY_CYCLE', 'الاعتماديات تشكّل حلقة مغلقة');
          w.depends_on = deps;
        }
      }
    }
    if (JSON.stringify([w.title, w.owner_user_id, w.self_pct]) === before && !Object.keys(b).length)
      fail(422, 'NOTHING_TO_UPDATE', 'لا توجد تغييرات');
    w.version++;
    hist(w, u, 'update', 'تحديث بيانات الحزمة');
    E.audit({
      actor_id: u.id,
      action: 'wp.update',
      object_type: 'work_package',
      object_id: w.id,
      project_id: p.id,
      version: w.version,
    });
    return { work_package: wpView(u, w, p) };
  });

  const runReadiness = (w, p, u, save = true) => {
    const r = readinessOf(w, p);
    if (save) {
      w.readiness = { at: E.iso(), ok: r.ok, snapshot: r.snapshot, by: u.id };
    }
    return r;
  };

  E.route('POST', '/work-packages/:id/readiness-check', (ctx) => {
    const { w, p } = needWp(ctx);
    const u = ctx.user;
    if (!(E.caps(u, p).create_wp || ownerSup(u, w)))
      fail(403, 'NO_PERMISSION', 'فحص الجاهزية للمنسّق أو مشرف الجهة المنفذة');
    if (!['DRAFT', 'AWAITING_RELEASE'].includes(w.status)) fail(409, 'INVALID_TRANSITION', 'الفحص قبل التصريح فقط');
    const r = runReadiness(w, p, u);
    hist(w, u, 'readiness', r.ok ? 'الفحص ناجح' : 'الفحص غير مكتمل');
    E.audit({
      actor_id: u.id,
      action: 'wp.readiness',
      object_type: 'work_package',
      object_id: w.id,
      project_id: p.id,
      to: r.ok ? 'ok' : 'incomplete',
    });
    return { readiness: r };
  });

  E.route('POST', '/work-packages/:id/transition', (ctx) => {
    const { w, p } = needWp(ctx);
    const u = ctx.user;
    const to = clean(ctx.body.to, 30);
    const from = w.status;
    if (!M.WP_STATUS[to]) fail(422, 'BAD_STATUS', 'مرحلة غير معروفة');
    if (to === from) return { work_package: wpView(u, w, p) };
    const caps = E.caps(u, p);
    if (['ACCEPTED', 'CLOSED'].includes(to))
      fail(409, 'FORMAL_APPROVAL_REQUIRED', 'القبول والإغلاق لا يتمان بالسحب؛ يلزم قرار مراجعة موثّق بالأدلة', {
        project_id: p.id,
        path: 'review',
      });
    if (to === 'RELEASED')
      fail(409, 'RELEASE_REQUIRES_ORDER', 'تصريح البدء يصدر بقرار صريح من المفوّض عبر زر «إصدار تصريح البدء»', {
        project_id: p.id,
        path: 'release',
      });
    if (to === 'IN_EXECUTION' && ['DRAFT', 'AWAITING_RELEASE'].includes(from))
      fail(409, 'NOT_READY_FOR_RELEASE', 'لا يمكن بدء الحزمة قبل فحص الجاهزية وصدور تصريح البدء', {
        project_id: p.id,
        path: 'release',
      });
    if (to === 'AWAITING_RELEASE' && from === 'DRAFT') {
      if (!(caps.create_wp || ownerSup(u, w)))
        fail(403, 'NO_PERMISSION', 'رفع الحزمة لطلب التصريح للمنسّق أو مشرف الجهة المنفذة');
      const r = runReadiness(w, p, u);
      if (!r.ok) fail(422, 'NOT_READY', 'الحزمة غير مستوفية لشروط الجاهزية', { checks: r.checks });
    } else if (to === 'DRAFT' && from === 'AWAITING_RELEASE') {
      if (!(caps.create_wp || ownerSup(u, w))) fail(403, 'NO_PERMISSION', 'سحب الطلب للمنسّق أو مشرف الجهة المنفذة');
    } else if (to === 'IN_EXECUTION' && from === 'RELEASED') {
      if (!ownerOp(u, w)) fail(403, 'WRONG_ORGANIZATION', 'بدء التنفيذ من الجهة المنفذة فقط');
      w.actual_start = E.today();
    } else if (to === 'IN_EXECUTION' && from === 'ORG_SUBMITTED') {
      if (!ownerOp(u, w)) fail(403, 'WRONG_ORGANIZATION', 'سحب التسليم من الجهة المنفذة فقط');
    } else if (to === 'ORG_SUBMITTED' && from === 'IN_EXECUTION') {
      if (!ownerSup(u, w)) fail(403, 'NO_PERMISSION', 'تسليم المخرج للمراجعة لمشرف الجهة المنفذة أو مديرها');
      if (w.evidence.length < w.required_evidence)
        fail(422, 'EVIDENCE_REQUIRED', `أرفق ${w.required_evidence} دليلًا على الأقل قبل التسليم للمراجعة`, {
          project_id: p.id,
        });
      w.submitted_by = u.id;
      w.submitted_at = E.iso();
    } else
      fail(
        409,
        'INVALID_TRANSITION',
        `الانتقال من «${M.WP_STATUS[from].ar}» إلى «${M.WP_STATUS[to].ar}» غير مسموح بهذه الطريقة`,
      );
    w.status = to;
    w.version++;
    hist(w, u, 'transition', '', from, to);
    E.audit({
      actor_id: u.id,
      action: 'wp.transition',
      object_type: 'work_package',
      object_id: w.id,
      project_id: p.id,
      from,
      to,
      version: w.version,
    });
    if (to === 'ORG_SUBMITTED')
      E.notify(
        S.delegations
          .filter(
            (d) =>
              d.action === 'accept_deliverable' && !d.revoked && d.project_ids.some((x) => x === '*' || x === p.id),
          )
          .map((d) => d.user_id),
        {
          kind: 'review',
          title: `مخرج بانتظار المراجعة: ${w.title}`,
          body: E.oname(w.owner_org_id),
          link: `#/p/${p.id}/board?wp=${w.id}`,
          project_id: p.id,
        },
        u.id,
      );
    return { work_package: wpView(u, w, p) };
  });

  E.route('POST', '/work-packages/:id/release', (ctx) => {
    const { w, p } = needWp(ctx);
    const u = ctx.user;
    const dlg = E.findDelegation(u, 'release', p.id);
    if (!dlg) fail(403, 'NO_DELEGATION', 'لا تملك تفويض إصدار تصريح البدء في هذا المشروع', { project_id: p.id });
    if (w.status !== 'AWAITING_RELEASE')
      fail(409, 'INVALID_TRANSITION', 'التصريح يصدر للحزم الجاهزة بانتظار التصريح فقط');
    if (!p.baseline_frozen) fail(409, 'NOT_READY_FOR_RELEASE', 'اعتمد خطة المشروع أولًا');
    const r = readinessOf(w, p);
    if (!r.ok) fail(422, 'NOT_READY', 'لم تعد الحزمة مستوفية لشروط الجاهزية', { checks: r.checks });
    if (!w.readiness || w.readiness.snapshot !== r.snapshot)
      fail(409, 'STALE_READINESS', 'تغيّرت بيانات الحزمة بعد فحص الجاهزية — أعد الفحص ثم أصدر التصريح');
    const note = clean(ctx.body.note, 500);
    w.release = {
      order_no: E.refNo('REL', p.ref),
      by: u.id,
      by_name: u.name,
      at: E.iso(),
      note,
      delegation_id: dlg.id,
      snapshot: r.snapshot.slice(0, 16),
    };
    const from = w.status;
    w.status = 'RELEASED';
    w.version++;
    hist(w, u, 'release', `أمر البدء ${w.release.order_no}`, from, 'RELEASED');
    E.audit({
      actor_id: u.id,
      action: 'wp.release',
      object_type: 'work_package',
      object_id: w.id,
      project_id: p.id,
      from,
      to: 'RELEASED',
      delegation_id: dlg.id,
      reason: note,
      version: w.version,
    });
    E.notify(
      E.orgUsers(w.owner_org_id)
        .filter((x) => E.hasRole(x, 'ORG_SUPERVISOR', 'ORG_ADMIN'))
        .map((x) => x.id),
      {
        kind: 'release',
        title: `صدر تصريح البدء: ${w.title}`,
        body: w.release.order_no,
        link: `#/p/${p.id}/board?wp=${w.id}`,
        project_id: p.id,
      },
      u.id,
    );
    return { work_package: wpView(u, w, p) };
  });

  E.route('POST', '/work-packages/:id/evidence', (ctx) => {
    const { w, p } = needWp(ctx);
    const u = ctx.user;
    const b = ctx.body;
    if (!ownerOp(u, w)) fail(403, 'WRONG_ORGANIZATION', 'الأدلة ترفعها الجهة المنفذة للحزمة');
    if (!['IN_EXECUTION', 'ORG_SUBMITTED'].includes(w.status))
      fail(409, 'INVALID_TRANSITION', 'ارفع الأدلة أثناء التنفيذ');
    const title = clean(b.title, 140);
    if (!title) fail(422, 'MISSING_TITLE', 'اكتب عنوانًا للدليل');
    let f = null;
    if (b.file_id) {
      const acceptors = S.delegations
        .filter(
          (d) =>
            d.action === 'accept_deliverable' &&
            !d.revoked &&
            d.project_ids.some((x) => x === '*' || x === p.id) &&
            E.user(d.user_id)?.org_id !== w.owner_org_id,
        )
        .map((d) => d.user_id);
      f = E.useFileAsEvidence(u, b.file_id, {
        project: p,
        shared: true,
        grantOrgIds: [p.lead_org_id],
        extraUserIds: acceptors,
      });
    }
    const e = {
      id: E.id('evd'),
      title,
      kind: ['doc', 'photo', 'report', 'other'].includes(b.kind) ? b.kind : 'doc',
      file_id: f?.id || null,
      file_name: f ? f.name : clean(b.file_name, 160),
      size: f ? f.size : Math.max(0, Math.min(Number(b.size) || 0, 1e9)),
      sha256: f?.sha256 || null,
      ref_only: !f,
      note: clean(b.note, 500),
      by: u.id,
      at: E.iso(),
    };
    w.evidence.push(e);
    hist(w, u, 'evidence', title);
    E.audit({
      actor_id: u.id,
      action: 'wp.evidence',
      object_type: 'work_package',
      object_id: w.id,
      project_id: p.id,
      detail: title,
    });
    ctx.status = 201;
    return { evidence: { ...e, by_name: u.name }, work_package: wpView(u, w, p) };
  });

  E.route('POST', '/work-packages/:id/review', (ctx) => {
    const { w, p } = needWp(ctx);
    const u = ctx.user;
    const b = ctx.body;
    const dlg = E.findDelegation(u, 'accept_deliverable', p.id);
    if (!dlg) fail(403, 'NO_DELEGATION', 'لا تملك تفويض قبول المخرجات', { project_id: p.id });
    if (u.org_id === w.owner_org_id || u.id === w.submitted_by)
      fail(403, 'CONFLICT_OF_INTEREST', 'لا يجوز للجهة المنفذة أو من سلّم المخرج أن يقبله بنفسه', { project_id: p.id });
    if (w.status !== 'ORG_SUBMITTED') fail(409, 'INVALID_TRANSITION', 'لا يوجد مخرج مسلَّم للمراجعة');
    const note = clean(b.note, 800);
    const decision = b.decision;
    if (!['accept', 'return'].includes(decision)) fail(422, 'BAD_DECISION', 'اختر قبول المخرج أو إعادته');
    if (decision === 'return') {
      if (!note) fail(422, 'MISSING_REASON', 'اكتب سبب الإعادة والمطلوب تصحيحه');
      w.status = 'IN_EXECUTION';
      w.version++;
      hist(w, u, 'return', note, 'ORG_SUBMITTED', 'IN_EXECUTION');
      E.audit({
        actor_id: u.id,
        action: 'wp.return',
        object_type: 'work_package',
        object_id: w.id,
        project_id: p.id,
        from: 'ORG_SUBMITTED',
        to: 'IN_EXECUTION',
        reason: note,
        delegation_id: dlg.id,
        version: w.version,
      });
      E.notify(
        [w.submitted_by, w.owner_user_id],
        {
          kind: 'review',
          title: `أُعيد المخرج للتصحيح: ${w.title}`,
          body: note,
          link: `#/p/${p.id}/board?wp=${w.id}`,
          project_id: p.id,
        },
        u.id,
      );
    } else {
      if (w.evidence.length < w.required_evidence)
        fail(422, 'EVIDENCE_REQUIRED', 'لا يُقبل المخرج دون الأدلة المطلوبة', { project_id: p.id });
      w.status = 'ACCEPTED';
      w.accepted_by = u.id;
      w.accepted_at = E.iso();
      w.version++;
      hist(w, u, 'accept', note, 'ORG_SUBMITTED', 'ACCEPTED');
      E.audit({
        actor_id: u.id,
        action: 'wp.accept',
        object_type: 'work_package',
        object_id: w.id,
        project_id: p.id,
        from: 'ORG_SUBMITTED',
        to: 'ACCEPTED',
        reason: note,
        delegation_id: dlg.id,
        version: w.version,
      });
      E.notify(
        [w.submitted_by, w.owner_user_id, p.committee.secretary_id],
        {
          kind: 'review',
          title: `قُبل المخرج: ${w.title}`,
          body: `أُضيف ${w.weight}٪ إلى الإنجاز المعتمد`,
          link: `#/p/${p.id}/board?wp=${w.id}`,
          project_id: p.id,
        },
        u.id,
      );
    }
    return { work_package: wpView(u, w, p) };
  });

  E.route('POST', '/work-packages/:id/close', (ctx) => {
    const { w, p } = needWp(ctx);
    const u = ctx.user;
    if (!E.caps(u, p).create_wp) fail(403, 'NO_PERMISSION', 'إغلاق الحزمة لمنسّق المشروع');
    if (w.status !== 'ACCEPTED') fail(409, 'INVALID_TRANSITION', 'تُغلق الحزمة بعد قبولها');
    w.status = 'CLOSED';
    w.version++;
    hist(w, u, 'close', '', 'ACCEPTED', 'CLOSED');
    E.audit({
      actor_id: u.id,
      action: 'wp.close',
      object_type: 'work_package',
      object_id: w.id,
      project_id: p.id,
      from: 'ACCEPTED',
      to: 'CLOSED',
    });
    return { work_package: wpView(u, w, p) };
  });

  // ---------------------------------------------------------------- blockers (issues)
  E.route('POST', '/work-packages/:id/issues', (ctx) => {
    const { w, p } = needWp(ctx);
    const u = ctx.user;
    const b = ctx.body;
    if (!ownerOp(u, w) && !E.caps(u, p).create_wp) fail(403, 'NO_PERMISSION', 'تسجيل العوائق للجهة المنفذة أو المنسّق');
    const title = clean(b.title, 160);
    if (!title) fail(422, 'MISSING_TITLE', 'صف العائق باختصار');
    const kind = b.kind === 'external' ? 'external' : 'internal';
    const days = Math.round(Number(b.days) || 0);
    const proof = clean(b.proof, 600);
    if (kind === 'external') {
      if (!(days > 0 && days <= 365)) fail(422, 'BAD_DAYS', 'حدّد عدد أيام التأخر الناتجة عن العائق');
      if (!proof) fail(422, 'MISSING_PROOF', 'العائق الخارجي يحتاج دليلًا أو مرجعًا موثّقًا ولا يُخصم بدونه');
    }
    const i = {
      id: E.id('iss'),
      project_id: p.id,
      wp_id: w.id,
      kind,
      title,
      days: kind === 'external' ? days : 0,
      proof,
      blocking: !!b.blocking,
      status: kind === 'external' ? 'PROPOSED' : 'OPEN',
      raised_by: u.id,
      at: E.iso(),
    };
    S.issues.push(i);
    E.audit({
      actor_id: u.id,
      action: 'issue.raise',
      object_type: 'issue',
      object_id: i.id,
      project_id: p.id,
      detail: title,
      reason: kind,
    });
    E.notify(
      [p.committee.chair_id, p.committee.secretary_id, p.created_by],
      {
        kind: 'issue',
        title: `عائق جديد: ${title}`,
        body: `${w.ref} — ${E.oname(w.owner_org_id)}`,
        link: `#/p/${p.id}/board?wp=${w.id}`,
        project_id: p.id,
      },
      u.id,
    );
    ctx.status = 201;
    return { issue: issueView(i) };
  });
  E.route('POST', '/issues/:id/decide', (ctx) => {
    const i = S.issues.find((x) => x.id === ctx.params.id);
    if (!i) fail(404, 'NOT_FOUND', 'العائق غير موجود');
    const p = E.needProject(ctx.user, i.project_id, 'member');
    const u = ctx.user;
    const cr = E.committeeRole(u, p);
    if (!(E.caps(u, p).create_wp || cr === 'chair'))
      fail(403, 'NO_PERMISSION', 'اعتماد استثناء التأخير للمنسّق أو رئيس اللجنة');
    if (i.status !== 'PROPOSED' && i.status !== 'OPEN') fail(409, 'INVALID_TRANSITION', 'تم البتّ في هذا العائق');
    const d = ctx.body.decision;
    const note = clean(ctx.body.note, 500);
    if (!['approve', 'reject', 'resolve'].includes(d)) fail(422, 'BAD_DECISION', 'قرار غير صالح');
    if (d === 'reject' && !note) fail(422, 'MISSING_REASON', 'اكتب سبب الرفض');
    if (d === 'approve' && i.kind !== 'external') fail(422, 'BAD_DECISION', 'الاعتماد للعوائق الخارجية الموثّقة فقط');
    i.status = d === 'approve' ? 'APPROVED' : d === 'reject' ? 'REJECTED' : 'RESOLVED';
    i.decided_by = u.id;
    i.decided_at = E.iso();
    i.decision_note = note;
    E.audit({
      actor_id: u.id,
      action: `issue.${d}`,
      object_type: 'issue',
      object_id: i.id,
      project_id: p.id,
      reason: note,
    });
    E.notify(
      [i.raised_by],
      {
        kind: 'issue',
        title: `قرار بشأن العائق: ${i.title}`,
        body: `${i.status === 'APPROVED' ? 'اعتُمد' : i.status === 'REJECTED' ? 'رُفض' : 'أُغلق'} ${note}`,
        link: `#/p/${p.id}/timeline`,
        project_id: p.id,
      },
      u.id,
    );
    return { issue: issueView(i) };
  });
  E.route('GET', '/projects/:id/issues', (ctx) => {
    const p = E.needProject(ctx.user, ctx.params.id, 'viewer');
    return { items: S.issues.filter((i) => i.project_id === p.id).map(issueView) };
  });

  // ---------------------------------------------------------------- change requests (never silent baseline edits)
  const crView = (c, u) => {
    const p = E.project(c.project_id);
    return {
      ...c,
      requested_by_name: E.uname(c.requested_by),
      changes: c.changes.map((x) => ({ ...x, wp_ref: E.wp(x.wp_id)?.ref, wp_title: E.wp(x.wp_id)?.title })),
      required: c.required_orgs.map((o) => ({
        org_id: o,
        org_name: E.oname(o),
        approval: c.approvals[o] ? { ...c.approvals[o], by_name: E.uname(c.approvals[o].user_id) } : null,
      })),
      can_decide:
        c.status === 'PENDING' &&
        !!E.findDelegation(u, 'approve_change', p.id) &&
        c.required_orgs.includes(u.org_id) &&
        !c.approvals[u.org_id],
    };
  };
  E.route('GET', '/projects/:id/change-requests', (ctx) => {
    const p = E.needProject(ctx.user, ctx.params.id, 'viewer');
    return {
      items: S.changeRequests
        .filter((c) => c.project_id === p.id)
        .reverse()
        .map((c) => crView(c, ctx.user)),
    };
  });
  E.route('POST', '/projects/:id/change-requests', (ctx) => {
    const p = E.needProject(ctx.user, ctx.params.id, 'member');
    const u = ctx.user;
    const b = ctx.body;
    if (!p.baseline_frozen) fail(409, 'INVALID_TRANSITION', 'الخطة لم تُعتمد بعد — عدّل الحزم مباشرة');
    const reason = clean(b.reason, 800);
    if (!reason) fail(422, 'MISSING_REASON', 'اكتب مبرر طلب التغيير');
    const raw = Array.isArray(b.changes) ? b.changes : [];
    if (!raw.length) fail(422, 'NO_CHANGES', 'حدّد ما تريد تغييره');
    const changes = [];
    for (const x of raw) {
      const w = E.wp(clean(x.wp_id, 40));
      if (!w || w.project_id !== p.id) fail(422, 'BAD_WP', 'حزمة غير صالحة');
      if (!(E.caps(u, p).create_wp || ownerSup(u, w)))
        fail(403, 'NO_PERMISSION', `لا تملك صلاحية طلب تغيير على ${w.ref}`);
      const c = { wp_id: w.id };
      if (x.planned_start || x.planned_end) {
        const s = x.planned_start || w.planned_start;
        const e = x.planned_end || w.planned_end;
        checkDates(s, e);
        if (s !== w.planned_start || e !== w.planned_end) {
          c.planned_start = s;
          c.planned_end = e;
        }
      }
      if ('weight' in x && Math.round(Number(x.weight)) !== w.weight) {
        const nw = Math.round(Number(x.weight));
        if (!(nw >= 0 && nw <= 100)) fail(422, 'BAD_WEIGHT', 'الوزن بين 0 و100');
        c.weight = nw;
      }
      if (Object.keys(c).length > 1) changes.push(c);
    }
    if (!changes.length) fail(422, 'NO_CHANGES', 'لا يوجد فرق عن الخطة المعتمدة');
    const newTotal = sum(wpsOf(p), (w) => changes.find((c) => c.wp_id === w.id && 'weight' in c)?.weight ?? w.weight);
    if (newTotal !== 100)
      fail(
        422,
        'WEIGHTS_NOT_100',
        `مجموع الأوزان بعد التعديل ${newTotal}٪ — يجب أن يبقى ١٠٠٪ (عدّل وزن حزمة أخرى معه)`,
      );
    const affected = changes.map((c) => E.wp(c.wp_id));
    const dependents = S.workPackages
      .filter((w) => w.project_id === p.id && w.depends_on.some((d) => changes.some((c) => c.wp_id === d)))
      .map((w) => w.ref);
    const cr = {
      id: E.id('cr'),
      ref: E.refNo('CR', p.ref),
      project_id: p.id,
      reason,
      changes,
      status: 'PENDING',
      requested_by: u.id,
      at: E.iso(),
      approvals: {},
      required_orgs: uniq([p.lead_org_id, ...affected.map((w) => w.owner_org_id)]),
      impact: dependents.length ? `يؤثر على اعتماديات: ${dependents.join('، ')}` : 'لا اعتماديات متأثرة',
      baseline_from: p.baseline_version,
    };
    S.changeRequests.push(cr);
    E.audit({
      actor_id: u.id,
      action: 'cr.create',
      object_type: 'change_request',
      object_id: cr.id,
      project_id: p.id,
      reason,
      detail: cr.ref,
    });
    const approvers = S.delegations
      .filter(
        (d) =>
          d.action === 'approve_change' &&
          !d.revoked &&
          cr.required_orgs.includes(d.org_id) &&
          d.project_ids.some((x) => x === '*' || x === p.id),
      )
      .map((d) => d.user_id);
    E.notify(
      approvers,
      {
        kind: 'change',
        title: `طلب تغيير ${cr.ref} بانتظار اعتمادك`,
        body: reason.slice(0, 100),
        link: `#/commitments?tab=changes&project=${p.id}`,
        project_id: p.id,
      },
      u.id,
    );
    ctx.status = 201;
    return { change_request: crView(cr, u) };
  });
  E.route('POST', '/change-requests/:id/decide', (ctx) => {
    const cr = S.changeRequests.find((c) => c.id === ctx.params.id);
    if (!cr) fail(404, 'NOT_FOUND', 'طلب التغيير غير موجود');
    const p = E.needProject(ctx.user, cr.project_id, 'member');
    const u = ctx.user;
    const b = ctx.body;
    const dlg = E.findDelegation(u, 'approve_change', p.id);
    if (!dlg) fail(403, 'NO_DELEGATION', 'لا تملك تفويض اعتماد طلبات التغيير', { project_id: p.id });
    if (!cr.required_orgs.includes(u.org_id))
      fail(403, 'WRONG_ORGANIZATION', 'جهتك ليست من الجهات المتأثرة بهذا الطلب', { project_id: p.id });
    if (cr.status !== 'PENDING') fail(409, 'INVALID_TRANSITION', 'تم البتّ في الطلب');
    if (cr.approvals[u.org_id]) fail(409, 'INVALID_TRANSITION', 'سبق ردّ جهتك على الطلب');
    const note = clean(b.note, 500);
    if (b.decision === 'reject') {
      if (!note) fail(422, 'MISSING_REASON', 'اكتب سبب الرفض');
      cr.status = 'REJECTED';
      cr.approvals[u.org_id] = { user_id: u.id, at: E.iso(), decision: 'reject', note, delegation_id: dlg.id };
      E.audit({
        actor_id: u.id,
        action: 'cr.reject',
        object_type: 'change_request',
        object_id: cr.id,
        project_id: p.id,
        reason: note,
        delegation_id: dlg.id,
      });
      E.notify(
        [cr.requested_by],
        {
          kind: 'change',
          title: `رُفض طلب التغيير ${cr.ref}`,
          body: note,
          link: `#/commitments?tab=changes&project=${p.id}`,
          project_id: p.id,
        },
        u.id,
      );
    } else if (b.decision === 'approve') {
      cr.approvals[u.org_id] = { user_id: u.id, at: E.iso(), decision: 'approve', note, delegation_id: dlg.id };
      E.audit({
        actor_id: u.id,
        action: 'cr.approve',
        object_type: 'change_request',
        object_id: cr.id,
        project_id: p.id,
        reason: note,
        delegation_id: dlg.id,
      });
      if (cr.required_orgs.every((o) => cr.approvals[o]?.decision === 'approve')) {
        p.baseline_version++;
        for (const c of cr.changes) {
          const w = E.wp(c.wp_id);
          if ('planned_start' in c) {
            w.planned_start = c.planned_start;
            w.planned_end = c.planned_end;
            w.baseline_start = c.planned_start;
            w.baseline_end = c.planned_end;
          }
          if ('weight' in c) w.weight = c.weight;
          w.baseline_version = p.baseline_version;
          w.version++;
          hist(w, u, 'baseline', `${cr.ref} — إصدار خط أساس ${p.baseline_version}`);
        }
        cr.status = 'APPROVED';
        cr.applied_at = E.iso();
        cr.baseline_to = p.baseline_version;
        E.migrateBaseline(p, cr, u, p.baseline_version - 1, p.baseline_version);
        E.audit({
          actor_id: u.id,
          action: 'baseline.version',
          object_type: 'project',
          object_id: p.id,
          project_id: p.id,
          from: `v${p.baseline_version - 1}`,
          to: `v${p.baseline_version}`,
          detail: cr.ref,
        });
        E.notify(
          E.projectMembers(p),
          {
            kind: 'change',
            title: `اعتُمد طلب التغيير ${cr.ref}`,
            body: `صدر خط أساس جديد (الإصدار ${p.baseline_version})`,
            link: `#/p/${p.id}/timeline`,
            project_id: p.id,
          },
          u.id,
        );
      }
    } else fail(422, 'BAD_DECISION', 'اختر اعتماد الطلب أو رفضه');
    return { change_request: crView(cr, u) };
  });

  // ---------------------------------------------------------------- board / timeline / team
  E.route('GET', '/projects/:id/board', (ctx) => {
    const u = ctx.user;
    const p = E.needProject(u, ctx.params.id, 'viewer');
    const tasks = S.tasks.filter((t) => t.project_id === p.id && E.taskVisible(u, t)).map((t) => taskView(u, t));
    return {
      project: { id: p.id, name: p.name, baseline_frozen: !!p.baseline_frozen, status: p.status },
      caps: E.caps(u, p),
      stages: M.WP_ORDER.map((k) => ({ key: k, label: M.WP_STATUS[k].ar })),
      items: wpsOf(p).map((w) => wpView(u, w, p)),
      tasks,
      task_stages: M.TASK_ORDER.map((k) => ({ key: k, label: M.TASK_STATUS[k].ar })),
      orgs: [p.lead_org_id, ...p.org_ids.filter((o) => o !== p.lead_org_id)].map((o) => ({ id: o, name: E.oname(o) })),
      progress: E.progress(p),
    };
  });

  E.route('GET', '/projects/:id/timeline', (ctx) => {
    const u = ctx.user;
    const p = E.needProject(u, ctx.params.id, 'viewer');
    const wps = wpsOf(p).map((w) => wpView(u, w, p));
    return {
      project: {
        id: p.id,
        name: p.name,
        start: p.start,
        end: p.end,
        baseline_frozen: !!p.baseline_frozen,
        baseline_version: p.baseline_version,
      },
      today: E.today(),
      caps: E.caps(u, p),
      items: wps,
      issues: S.issues.filter((i) => i.project_id === p.id).map(issueView),
      change_requests: S.changeRequests
        .filter((c) => c.project_id === p.id && c.status === 'PENDING')
        .map((c) => crView(c, u)),
    };
  });

  const WEEK = 7;
  const loadBuckets = (userId, from) => {
    const buckets = [0, 0, 0, 0];
    for (const t of S.tasks.filter(
      (x) =>
        x.assignee_id === userId && !['DONE_INTERNAL', 'CANCELLED'].includes(x.status) && x.est_hours && x.planned_end,
    )) {
      const s = t.planned_start || from;
      const span = Math.max(1, diffDays(s, t.planned_end) + 1);
      const perDay = (t.est_hours * (1 - (t.completion_pct || 0) / 100)) / span;
      for (let d = 0; d < span; d++) {
        const off = diffDays(from, addDays(s, d));
        if (off >= 0 && off < 4 * WEEK) buckets[Math.floor(off / WEEK)] += perDay;
      }
    }
    return buckets.map((x) => Math.round(x * 10) / 10);
  };

  E.route('GET', '/projects/:id/team', (ctx) => {
    const u = ctx.user;
    const p = E.needProject(u, ctx.params.id, 'viewer');
    const caps = E.caps(u, p);
    const today = E.today();
    const from = isDay(ctx.query.from) ? ctx.query.from : today;
    const orgs = [p.lead_org_id, ...p.org_ids.filter((o) => o !== p.lead_org_id)].map((o) => {
      const cms = S.commitments.filter((c) => c.project_id === p.id && c.org_id === o);
      const wps = wpsOf(p).filter((w) => w.owner_org_id === o);
      const vis = E.committeeRole(u, p) || o === u.org_id || caps.level === 'viewer';
      return {
        id: o,
        name: E.oname(o),
        role: o === p.lead_org_id ? 'lead' : 'participant',
        wp_count: wps.length,
        wp_accepted: wps.filter((w) => ['ACCEPTED', 'CLOSED'].includes(w.status)).length,
        commitments_active: cms.filter((c) => c.status === 'ACTIVE').length,
        shared_progress: cms.length ? Math.round(sum(cms, (c) => commitmentProgress(c) ?? 0) / cms.length) : null,
        detail_visible: !!vis,
      };
    });
    const mine = caps.org_member ? E.orgUsers(u.org_id).filter((x) => !E.hasRole(x, 'SCOPED_VIEWER')) : [];
    const canSeeLoad =
      caps.org_member &&
      (E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || !!S.delegations.find((d) => d.user_id === u.id && !d.revoked));
    const members = canSeeLoad
      ? mine.map((x) => {
          const open = S.tasks.filter(
            (t) =>
              t.assignee_id === x.id && t.project_id === p.id && !['DONE_INTERNAL', 'CANCELLED'].includes(t.status),
          );
          return {
            id: x.id,
            name: x.name,
            title: x.title,
            open: open.length,
            overdue: open.filter((t) => t.planned_end && t.planned_end < today).length,
            weeks: loadBuckets(x.id, from),
            capacity_week: x.capacity_week || 40,
          };
        })
      : [];
    return {
      from,
      orgs,
      members,
      org_capacity: members.length
        ? {
            total_capacity: members.reduce((a, m) => a + (m.capacity_week || 40), 0),
            weeks: [0, 1, 2, 3].map((i) => Math.round(members.reduce((a, m) => a + m.weeks[i], 0) * 10) / 10),
          }
        : null,
      members_note: canSeeLoad ? 'أحمال الموظفين تظهر لمشرفي جهتهم فقط، والأرقام تقديرية من تقديرات المهام.' : null,
      committee: {
        chair: E.uname(p.committee.chair_id),
        secretary: E.uname(p.committee.secretary_id),
        members: p.committee.member_ids.map((id) => E.uname(id)),
      },
      today,
    };
  });

  // ---------------------------------------------------------------- tasks (internal to one organisation)
  E.taskVisible = (u, t) => {
    if (u.org_id !== t.org_id || E.hasRole(u, 'SUPER_ADMIN')) return false;
    if (
      E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') ||
      S.delegations.some((d) => d.user_id === u.id && d.action === 'commit' && !d.revoked)
    )
      return true;
    return t.assignee_id === u.id || t.created_by === u.id;
  };
  const taskView = (u, t) => {
    const cm = t.commitment_id ? E.commitment(t.commitment_id) : null;
    const req = cm ? E.req(cm.request_id) : null;
    const today = E.today();
    return {
      id: t.id,
      ref: t.ref,
      project_id: t.project_id,
      project_name: E.project(t.project_id)?.name,
      org_id: t.org_id,
      title: t.title,
      description: t.description,
      assignee_id: t.assignee_id,
      assignee_name: E.uname(t.assignee_id),
      created_by_name: E.uname(t.created_by),
      priority: t.priority,
      status: t.status,
      status_ar: M.TASK_STATUS[t.status].ar,
      tone: M.TASK_STATUS[t.status].tone,
      department_id: t.department_id || null,
      department_name: S.orgUnits.find((x) => x.id === t.department_id)?.name || null,
      planned_start: t.planned_start,
      planned_end: t.planned_end,
      completion_pct: t.completion_pct,
      est_hours: t.est_hours,
      private_notes: t.private_notes,
      shared_progress_note: t.shared_progress_note,
      commitment_id: t.commitment_id,
      request_id: req?.id || null,
      request_ref: req?.ref || null,
      request_title: req?.title || null,
      wp_id: t.wp_id || req?.wp_id || null,
      wp_ref: t.wp_id || req?.wp_id ? E.wp(t.wp_id || req?.wp_id)?.ref : null,
      wp_title: t.wp_id || req?.wp_id ? E.wp(t.wp_id || req?.wp_id)?.title : null,
      overdue: !!t.planned_end && t.planned_end < today && !['DONE_INTERNAL', 'CANCELLED'].includes(t.status),
      version: t.version,
      history: (t.history || []).map((h) => ({ ...h, actor_name: E.uname(h.actor_id) })),
      can_edit: E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || t.assignee_id === u.id,
    };
  };
  const taskHist = (t, u, action, note) => t.history.push({ at: E.iso(), actor_id: u.id, action, note: note || '' });

  const createTask = (ctx, commitmentId) => {
    const u = ctx.user;
    const b = ctx.body;
    const cm = commitmentId
      ? E.commitment(commitmentId)
      : b.commitment_id
        ? E.commitment(clean(b.commitment_id, 40))
        : null;
    if (commitmentId && !cm) fail(404, 'NOT_FOUND', 'الالتزام غير موجود');
    const projectId = cm ? cm.project_id : clean(b.project_id, 40);
    const p = E.project(projectId);
    if (!p || E.access(u, p) !== 'member') fail(404, 'NOT_FOUND', 'المشروع غير موجود أو لا تملك صلاحية الاطلاع عليه');
    if (!E.orgParticipates(u.org_id, p))
      fail(403, 'WRONG_ORGANIZATION', 'جهتك ليست من جهات هذا المشروع', { project_id: p.id });
    const isSup = E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN');
    if (cm && cm.org_id !== u.org_id)
      fail(403, 'WRONG_ORGANIZATION', 'هذا الالتزام يخص جهة أخرى؛ لا يجوز إسناد مهام داخلية فيه من خارجها', {
        project_id: p.id,
      });
    if (cm && !isSup) fail(403, 'NOT_SUPERVISOR', 'توزيع مهام الالتزام على الموظفين لمشرف الجهة', { project_id: p.id });
    if (cm && cm.status !== 'ACTIVE') fail(409, 'INVALID_TRANSITION', 'الالتزام غير ساري');
    const assignee = E.user(clean(b.assignee_id, 40) || u.id);
    if (!assignee) fail(422, 'UNKNOWN_USER', 'اختر المسؤول عن المهمة');
    if (assignee.org_id !== u.org_id)
      fail(
        403,
        'CROSS_ORG_ASSIGNMENT',
        'لا يجوز إسناد مهمة إلى موظف من جهة أخرى. أنشئ طلبًا للجنة ليصل للجهة المختصة.',
        { project_id: p.id },
      );
    if (!isSup && assignee.id !== u.id)
      fail(403, 'NOT_SUPERVISOR', 'إسناد المهام لزملائك لمشرف الجهة؛ يمكنك إضافة مهام لنفسك', { project_id: p.id });
    const wp = b.wp_id ? E.wp(clean(b.wp_id, 40)) : null;
    if (wp && (wp.project_id !== p.id || wp.owner_org_id !== u.org_id))
      fail(403, 'WRONG_ORGANIZATION', 'الحزمة المرتبطة ليست من حزم جهتك', { project_id: p.id });
    const title = clean(b.title, 160);
    if (!title) fail(422, 'MISSING_TITLE', 'اكتب عنوان المهمة');
    if (b.planned_start || b.planned_end) {
      if (
        !isDay(b.planned_start || b.planned_end) ||
        !isDay(b.planned_end || b.planned_start) ||
        (b.planned_start && b.planned_end && b.planned_end < b.planned_start)
      )
        fail(422, 'BAD_DATES', 'التواريخ غير صحيحة');
    }
    const n = (S.meta.seq.task_n = (S.meta.seq.task_n || 100) + 1);
    const t = {
      id: E.id('tsk'),
      ref: `T-${n}`,
      project_id: p.id,
      org_id: u.org_id,
      commitment_id: cm?.id || null,
      wp_id: wp?.id || null,
      title,
      description: clean(b.description, 1200),
      assignee_id: assignee.id,
      created_by: u.id,
      priority: ['low', 'normal', 'high'].includes(b.priority) ? b.priority : 'normal',
      status: 'TODO',
      planned_start: isDay(b.planned_start) ? b.planned_start : E.today(),
      planned_end: isDay(b.planned_end) ? b.planned_end : null,
      completion_pct: 0,
      est_hours: Math.max(0, Math.min(Number(b.est_hours) || 0, 400)),
      department_id: assignee.unit_id || null,
      private_notes: '',
      shared_progress_note: '',
      version: 1,
      history: [],
      created_at: E.iso(),
    };
    S.tasks.push(t);
    taskHist(t, u, 'create', 'إنشاء المهمة');
    E.audit({
      actor_id: u.id,
      action: 'task.create',
      object_type: 'task',
      object_id: t.id,
      project_id: p.id,
      detail: title,
      org_id: u.org_id,
    });
    if (assignee.id !== u.id)
      E.notify([assignee.id], {
        kind: 'task',
        title: `مهمة جديدة: ${title}`,
        body: t.planned_end ? `الموعد ${t.planned_end}` : '',
        link: `#/tasks?task=${t.id}`,
        project_id: p.id,
      });
    ctx.status = 201;
    return { task: taskView(u, t) };
  };
  E.route('POST', '/tasks', (ctx) => createTask(ctx, null));
  E.route('POST', '/commitments/:id/internal-tasks', (ctx) => createTask(ctx, ctx.params.id));

  E.route('GET', '/tasks', (ctx) => {
    const u = ctx.user;
    const { scope = 'mine', project_id } = ctx.query;
    let list = S.tasks.filter((t) => E.taskVisible(u, t) && (!project_id || t.project_id === project_id));
    if (scope === 'mine') list = list.filter((t) => t.assignee_id === u.id);
    const isSup = E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN');
    return {
      items: list.map((t) => taskView(u, t)),
      stages: M.TASK_ORDER.map((k) => ({ key: k, label: M.TASK_STATUS[k].ar })),
      can_supervise: isSup,
      people: isSup
        ? E.orgUsers(u.org_id).map((x) => ({ id: x.id, name: x.name, title: x.title }))
        : [{ id: u.id, name: u.name, title: u.title }],
    };
  });
  E.route('GET', '/tasks/:id', (ctx) => {
    const t = E.task(ctx.params.id);
    if (!t || !E.taskVisible(ctx.user, t)) fail(404, 'NOT_FOUND', 'المهمة غير موجودة أو لا تملك صلاحية الاطلاع عليها');
    return { task: taskView(ctx.user, t) };
  });
  E.route('PATCH', '/tasks/:id', (ctx) => {
    const u = ctx.user;
    const t = E.task(ctx.params.id);
    const b = ctx.body;
    if (!t || !E.taskVisible(u, t)) fail(404, 'NOT_FOUND', 'المهمة غير موجودة أو لا تملك صلاحية الاطلاع عليها');
    const isSup = E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN');
    const isAssignee = t.assignee_id === u.id;
    if (!isSup && !isAssignee) fail(403, 'NO_PERMISSION', 'تعديل المهمة للمكلّف بها أو لمشرف الجهة');
    if (b.version && Number(b.version) !== t.version)
      fail(409, 'STALE_VERSION', 'تغيّرت المهمة منذ فتحتها — حدّث الصفحة وأعد المحاولة');
    const from = t.status;
    if ('status' in b) {
      if (!M.TASK_STATUS[b.status]) fail(422, 'BAD_STATUS', 'حالة غير معروفة');
      if (b.status === 'CANCELLED' && !isSup) fail(403, 'NOT_SUPERVISOR', 'إلغاء المهمة لمشرف الجهة');
      t.status = b.status;
      if (t.status === 'DONE_INTERNAL') t.completion_pct = 100;
      if (t.status === 'IN_PROGRESS' && !t.actual_start) t.actual_start = E.today();
    }
    if ('completion_pct' in b) {
      const v = Math.round(Number(b.completion_pct));
      if (!(v >= 0 && v <= 100)) fail(422, 'BAD_PCT', 'النسبة بين 0 و100');
      t.completion_pct = v;
      if (v === 100 && t.status !== 'DONE_INTERNAL' && t.status !== 'CANCELLED') t.status = 'DONE_INTERNAL';
      if (v > 0 && v < 100 && t.status === 'TODO') t.status = 'IN_PROGRESS';
    }
    if ('shared_progress_note' in b) t.shared_progress_note = clean(b.shared_progress_note, 400);
    if ('private_notes' in b) t.private_notes = clean(b.private_notes, 1200);
    if (isSup) {
      if ('title' in b) {
        const x = clean(b.title, 160);
        if (!x) fail(422, 'MISSING_TITLE', 'العنوان مطلوب');
        t.title = x;
      }
      if ('description' in b) t.description = clean(b.description, 1200);
      if ('priority' in b && ['low', 'normal', 'high'].includes(b.priority)) t.priority = b.priority;
      if ('planned_end' in b) t.planned_end = isDay(b.planned_end) ? b.planned_end : null;
      if ('planned_start' in b && isDay(b.planned_start)) t.planned_start = b.planned_start;
      if ('est_hours' in b) t.est_hours = Math.max(0, Math.min(Number(b.est_hours) || 0, 400));
      if ('assignee_id' in b) {
        const a = E.user(clean(b.assignee_id, 40));
        if (!a) fail(422, 'UNKNOWN_USER', 'مستخدم غير معروف');
        if (a.org_id !== t.org_id)
          fail(403, 'CROSS_ORG_ASSIGNMENT', 'لا يجوز إسناد مهمة إلى موظف من جهة أخرى', { project_id: t.project_id });
        if (a.id !== t.assignee_id) {
          t.assignee_id = a.id;
          E.notify(
            [a.id],
            {
              kind: 'task',
              title: `أُسندت إليك مهمة: ${t.title}`,
              link: `#/tasks?task=${t.id}`,
              project_id: t.project_id,
            },
            u.id,
          );
        }
      }
    }
    t.version++;
    t.updated_at = E.iso();
    if (from !== t.status) {
      taskHist(t, u, 'status', `${M.TASK_STATUS[from].ar} ← ${M.TASK_STATUS[t.status].ar}`);
      E.audit({
        actor_id: u.id,
        action: 'task.status',
        object_type: 'task',
        object_id: t.id,
        project_id: t.project_id,
        from,
        to: t.status,
        org_id: t.org_id,
      });
    } else taskHist(t, u, 'update', 'تحديث');
    return { task: taskView(u, t) };
  });

  // ---------------------------------------------------------------- commitments (created only when an organisation accepts)
  const commitmentProgress = (c) => {
    const ts = S.tasks.filter((t) => t.commitment_id === c.id && t.status !== 'CANCELLED');
    if (!ts.length) return null;
    return Math.round(sum(ts, (t) => t.completion_pct) / ts.length);
  };
  E.commitmentProgress = commitmentProgress;
  const commitmentView = (u, c, side) => {
    const r = E.req(c.request_id);
    const base = {
      id: c.id,
      side,
      request_id: r.id,
      request_ref: r.ref,
      request_title: r.title,
      project_id: c.project_id,
      project_name: E.project(c.project_id)?.name,
      org_id: c.org_id,
      org_name: E.oname(c.org_id),
      requester_org_name: E.oname(r.requester_org_id),
      scope_text: c.scope_text,
      conditions: c.conditions,
      due_on: c.due_on,
      status: c.status,
      accepted_at: c.accepted_at,
      accepted_by_name: E.uname(c.accepted_by),
      basis: c.basis,
      progress: commitmentProgress(c),
      shared_updates: c.shared_updates.map((x) => ({ ...x, by_name: E.uname(x.by) })),
      request_status: r.status,
      request_status_ar: M.REQUEST_STATUS[r.status].ar,
      contact_name: c.contact_user_id ? E.uname(c.contact_user_id) : null,
      overdue: !!c.due_on && c.due_on < E.today() && c.status === 'ACTIVE',
    };
    if (side === 'provider') {
      const ts = S.tasks.filter((t) => t.commitment_id === c.id);
      base.task_counts = {
        total: ts.length,
        done: ts.filter((t) => t.status === 'DONE_INTERNAL').length,
        open: ts.filter((t) => !['DONE_INTERNAL', 'CANCELLED'].includes(t.status)).length,
      };
    }
    return base;
  };
  E.route('GET', '/commitments', (ctx) => {
    const u = ctx.user;
    const out = [];
    for (const c of S.commitments) {
      const r = E.req(c.request_id);
      const p = E.project(c.project_id);
      if (c.org_id === u.org_id && E.access(u, p) === 'member') out.push(commitmentView(u, c, 'provider'));
      else if (r.requester_org_id === u.org_id && E.access(u, p) === 'member')
        out.push(commitmentView(u, c, 'requester'));
      else if (E.committeeRole(u, p) || (E.hasRole(u, 'FINAL_AUDITOR') && E.access(u, p) !== 'none'))
        out.push(commitmentView(u, c, 'committee'));
    }
    return { items: out };
  });
  E.route('POST', '/commitments/:id/updates', (ctx) => {
    const u = ctx.user;
    const c = E.commitment(ctx.params.id);
    if (!c) fail(404, 'NOT_FOUND', 'الالتزام غير موجود');
    if (c.org_id !== u.org_id)
      fail(403, 'WRONG_ORGANIZATION', 'نشر التحديثات من الجهة صاحبة الالتزام فقط', { project_id: c.project_id });
    if (!E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') && !E.findDelegation(u, 'commit', c.project_id))
      fail(403, 'NOT_SUPERVISOR', 'نشر التحديثات لمشرف الجهة أو مفوّضها');
    const note = clean(ctx.body.note, 500);
    if (!note) fail(422, 'MISSING_NOTE', 'اكتب نص التحديث المنشور للجهة الطالبة واللجنة');
    c.shared_updates.push({ at: E.iso(), by: u.id, note, pct: commitmentProgress(c) });
    const r = E.req(c.request_id);
    E.audit({
      actor_id: u.id,
      action: 'commitment.update',
      object_type: 'commitment',
      object_id: c.id,
      project_id: c.project_id,
      detail: note,
    });
    E.notify(
      [
        ...E.orgUsers(r.requester_org_id)
          .filter((x) => x.id === r.created_by)
          .map((x) => x.id),
        E.project(c.project_id).committee.secretary_id,
      ],
      {
        kind: 'progress',
        title: `تحديث على الطلب ${r.ref}`,
        body: note,
        link: `#/requests/${r.id}`,
        project_id: c.project_id,
      },
      u.id,
    );
    return { ok: true };
  });
}
