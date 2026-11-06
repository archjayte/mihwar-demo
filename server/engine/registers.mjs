// Platform-level registers required by the workspace specification's complementary screens: decisions & permits, evidence, executive overview.
// Every row is limited to what the caller may already see in the underlying project / request / work package; downloads still need a file grant.
import { fail, addDays } from './util.mjs';
import * as M from './model.mjs';

export function registerRegisters(E) {
  const S = E.state;
  const visibleProjects = (u) => S.projects.filter((p) => E.access(u, p) !== 'none');
  const noContent = (u) => E.hasRole(u, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN');
  const inRange = (at, q) => (!q.from || at.slice(0, 10) >= q.from) && (!q.to || at.slice(0, 10) <= q.to);
  const hit = (q, ...vals) => !q.q || vals.some((v) => String(v || '').includes(q.q));

  // ---------------------------------------------------------------- decisions & permits
  E.route('GET', '/registers/decisions', (ctx) => {
    const u = ctx.user;
    const q = ctx.query;
    const rows = [];
    if (noContent(u))
      return {
        items: [],
        types: {},
        note: 'سجل القرارات والتصاريح يعرض محتوى الجهات، ومالك المنصة ومشغّلها لا يطّلعان عليه.',
      };
    const pids = new Set(visibleProjects(u).map((p) => p.id));
    const pname = (id) => E.project(id)?.name;
    for (const d of S.decisions)
      if (pids.has(d.project_id) && E.access(u, E.project(d.project_id)) !== 'meta')
        rows.push({
          id: d.id,
          type: 'committee',
          type_label: 'قرار / محضر لجنة',
          ref: d.ref,
          title: d.title,
          outcome: d.status === 'OPEN' ? 'مفتوح' : 'مغلق',
          project_id: d.project_id,
          project_name: pname(d.project_id),
          at: d.at,
          by_name: E.uname(d.by),
          org_name: '',
          basis: d.basis,
          link: d.request_id ? `#/requests/${d.request_id}` : `#/p/${d.project_id}/committee?tab=decisions`,
        });
    for (const r of S.requests) {
      if (!pids.has(r.project_id) || !E.reqVisible(u, r)) continue;
      for (const d of r.decisions)
        rows.push({
          id: d.id,
          type: 'org_decision',
          type_label: 'قرار جهة مختصة',
          ref: r.ref,
          title: `${{ ACCEPT: 'قبول', DECLINE: 'اعتذار', COUNTER: 'مقترح بديل', NEED_INFO: 'طلب استكمال' }[d.type] || d.type}: ${r.title}`,
          outcome: d.reason_code ? M.REASON_CODES?.[d.reason_code] || d.reason_code : '',
          project_id: r.project_id,
          project_name: pname(r.project_id),
          at: d.at,
          by_name: E.uname(d.by),
          org_name: E.oname(d.org_id),
          basis: (S.delegations.find((x) => x.id === d.delegation_id) || {}).basis || '',
          link: `#/requests/${r.id}`,
        });
    }
    for (const w of S.workPackages)
      if (pids.has(w.project_id) && w.release && E.access(u, E.project(w.project_id)) !== 'meta')
        rows.push({
          id: `rel_${w.id}`,
          type: 'permit',
          type_label: 'تصريح بدء',
          ref: w.release.order_no,
          title: `${w.ref} — ${w.title}`,
          outcome: 'صدر',
          project_id: w.project_id,
          project_name: pname(w.project_id),
          at: w.release.at,
          by_name: w.release.by_name,
          org_name: E.oname(w.owner_org_id),
          basis: (S.delegations.find((x) => x.id === w.release.delegation_id) || {}).basis || '',
          link: `#/p/${w.project_id}/board?wp=${w.id}`,
        });
    for (const c of S.changeRequests)
      if (
        pids.has(c.project_id) &&
        ['APPROVED', 'REJECTED'].includes(c.status) &&
        E.access(u, E.project(c.project_id)) !== 'meta'
      )
        rows.push({
          id: c.id,
          type: 'baseline',
          type_label: 'تغيير خط الأساس',
          ref: c.ref,
          title: c.reason.slice(0, 90),
          outcome: c.status === 'APPROVED' ? `اعتُمد — إصدار ${c.baseline_to}` : 'رُفض',
          project_id: c.project_id,
          project_name: pname(c.project_id),
          at:
            c.applied_at ||
            Object.values(c.approvals)
              .map((a) => a.at)
              .sort()
              .pop() ||
            c.at,
          by_name: E.uname(c.requested_by),
          org_name: '',
          basis: '',
          link: `#/commitments?tab=changes&project=${c.project_id}`,
        });
    const types = {};
    const items = rows
      .filter(
        (r) =>
          (!q.type || r.type === q.type) &&
          (!q.project_id || r.project_id === q.project_id) &&
          inRange(r.at, q) &&
          hit(q, r.title, r.ref, r.by_name, r.org_name),
      )
      .sort((a, b) => b.at.localeCompare(a.at));
    for (const r of rows) types[r.type] = (types[r.type] || 0) + 1;
    return {
      items: items.slice(0, 300),
      total: items.length,
      types,
      projects: visibleProjects(u).map((p) => ({ id: p.id, name: p.name })),
      note: 'يجمع القرارات والتصاريح من المشاريع التي تراها. كل صف يفتح سجله الأصلي.',
    };
  });

  // ---------------------------------------------------------------- evidence register
  E.route('GET', '/registers/evidence', (ctx) => {
    const u = ctx.user;
    const q = ctx.query;
    const rows = [];
    if (noContent(u))
      return { items: [], note: 'سجل الأدلة يعرض محتوى الجهات، ومالك المنصة ومشغّلها لا يطّلعان عليه.' };
    const base = (e) => {
      const f = e.file_id ? E.file(e.file_id) : null;
      return {
        id: e.id,
        title: e.title,
        file_id: e.file_id || null,
        file_name: e.file_name || null,
        size: e.size || null,
        sha256: e.sha256 || null,
        by_name: E.uname(e.by),
        at: e.at,
        ref_only: !!e.ref_only,
        baseline_version: e.baseline_version ?? null,
        can_download: !!f && E.canReadFile(u, f),
        version: f?.version || null,
      };
    };
    for (const p of visibleProjects(u)) {
      if (E.access(u, p) === 'meta') continue;
      for (const w of S.workPackages.filter((x) => x.project_id === p.id))
        if (E.evidenceVisibleFor(u, w, p))
          for (const e of w.evidence)
            rows.push({
              ...base(e),
              source: 'wp',
              source_label: 'حزمة عمل',
              object_ref: w.ref,
              object_title: w.title,
              org_name: E.oname(w.owner_org_id),
              project_id: p.id,
              project_name: p.name,
              link: `#/p/${p.id}/board?wp=${w.id}`,
              status: M.WP_STATUS[w.status]?.ar || w.status,
            });
    }
    for (const r of S.requests) {
      if (!E.reqVisible(u, r) || E.access(u, E.project(r.project_id)) === 'meta') continue;
      for (const e of r.evidence)
        if (E.requestEvidenceVisible(u, r, e))
          rows.push({
            ...base(e),
            source: 'request',
            source_label: 'طلب',
            object_ref: r.ref,
            object_title: r.title,
            org_name: E.oname(r.target_org_id || r.requester_org_id),
            project_id: r.project_id,
            project_name: E.project(r.project_id)?.name,
            link: `#/requests/${r.id}`,
            status: M.REQUEST_STATUS[r.status]?.ar || r.status,
          });
    }
    const items = rows
      .filter(
        (r) =>
          (!q.source || r.source === q.source) &&
          (!q.project_id || r.project_id === q.project_id) &&
          inRange(r.at, q) &&
          hit(q, r.title, r.file_name, r.object_ref, r.object_title, r.by_name, r.sha256),
      )
      .sort((a, b) => b.at.localeCompare(a.at));
    return {
      items: items.slice(0, 300),
      total: items.length,
      counts: {
        wp: rows.filter((r) => r.source === 'wp').length,
        request: rows.filter((r) => r.source === 'request').length,
        files: rows.filter((r) => r.file_id).length,
        downloadable: rows.filter((r) => r.can_download).length,
      },
      projects: visibleProjects(u).map((p) => ({ id: p.id, name: p.name })),
      note: 'تُعرض الأدلة التي يحق لك رؤيتها فقط. التنزيل يتطلب منحة اطلاع صريحة على الملف.',
    };
  });

  // ---------------------------------------------------------------- executive overview (derived from the same visible data; no separate store)
  E.route('GET', '/overview', (ctx) => {
    const u = ctx.user;
    const t = E.today();
    const pr = visibleProjects(u).filter((p) => p.status !== 'CLOSED');
    if (
      !E.hasRole(
        u,
        'PLATFORM_OWNER_ADMIN',
        'COORDINATING_ADMIN',
        'ORG_ADMIN',
        'FINAL_AUDITOR',
        'INDEPENDENT_REVIEWER',
      ) &&
      !S.projects.some((p) => E.committeeRole(u, p)) &&
      !S.delegations.some((d) => d.user_id === u.id && !d.revoked)
    )
      fail(403, 'NO_PERMISSION', 'النظرة التنفيذية للقيادة واللجان والمفوّضين');
    const agg = noContent(u);
    const open = (r) => !/^(CLOSED|WITHDRAWN|CANCELLED|SPLIT|DRAFT)/.test(r.status);
    const projects = pr.map((p) => {
      const wps = S.workPackages.filter((w) => w.project_id === p.id);
      const reqs = agg ? [] : S.requests.filter((r) => r.project_id === p.id && E.reqVisible(u, r));
      const late = wps.filter((w) => w.planned_end < t && !['ACCEPTED', 'CANCELLED'].includes(w.status)).length;
      const blockers = agg
        ? 0
        : S.issues.filter(
            (i) =>
              wps.some((w) => w.id === i.wp_id) &&
              !['RESOLVED', 'APPROVED', 'REJECTED'].includes(i.status) &&
              i.blocking,
          ).length;
      const overdueReq = reqs.filter(
        (r) =>
          open(r) &&
          r.response_due_at &&
          r.response_due_at.slice(0, 10) < t &&
          ['REFERRED_TO_ORG', 'UNDER_ORG_REVIEW'].includes(r.status),
      ).length;
      const wsum = wps.reduce((a, w) => a + (w.weight || 0), 0) || 1;
      const approved = Math.round(
        (wps.filter((w) => w.status === 'ACCEPTED').reduce((a, w) => a + (w.weight || 0), 0) / wsum) * 100,
      );
      const operational = Math.round(
        wps.reduce((a, w) => a + (w.weight || 0) * Math.min(100, w.self_pct || 0), 0) / wsum,
      );
      const health = blockers || late > 1 || overdueReq > 1 ? 'red' : late || overdueReq ? 'amber' : 'green';
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        baseline_version: p.baseline_frozen ? p.baseline_version : null,
        wp_count: wps.length,
        approved_pct: approved,
        operational_pct: operational,
        late_wps: late,
        blockers,
        open_requests: reqs.filter(open).length,
        overdue_requests: overdueReq,
        health,
        link: `#/p/${p.id}/board`,
      };
    });
    const mine = agg ? [] : S.requests.filter((r) => E.reqVisible(u, r) && open(r));
    const stage = {};
    for (const r of mine) {
      const s = M.STAGE_LABEL[M.STATUS_STAGE[r.status]] || '—';
      stage[s] = (stage[s] || 0) + 1;
    }
    const expiring = agg
      ? []
      : S.delegations
          .filter(
            (d) =>
              !d.revoked &&
              d.valid_to &&
              d.valid_to <= addDays(t, 30) &&
              (E.hasRole(u, 'PLATFORM_OWNER_ADMIN') ||
                d.org_id === u.org_id ||
                S.projects.some((p) => E.committeeRole(u, p))),
          )
          .map((d) => ({
            user_name: E.uname(d.user_id),
            action_label: M.DELEGATION_LABEL[d.action],
            valid_to: d.valid_to,
            org_name: E.oname(d.org_id),
          }));
    const waiting = agg
      ? []
      : mine
          .filter((r) =>
            [
              'SUBMITTED_TO_COMMITTEE',
              'PENDING_CHAIR_ROUTING',
              'REFERRED_TO_ORG',
              'UNDER_ORG_REVIEW',
              'COUNTERPROPOSAL',
              'DECLINED_WITH_REASON',
              'ESCALATED',
            ].includes(r.status),
          )
          .sort((a, b) => (a.response_due_at || a.updated_at).localeCompare(b.response_due_at || b.updated_at))
          .slice(0, 8)
          .map((r) => ({
            id: r.id,
            ref: r.ref,
            title: r.title,
            status_ar: M.REQUEST_STATUS[r.status].ar,
            ball: r.target_org_id ? E.oname(r.target_org_id) : 'اللجنة',
            due: r.response_due_at ? r.response_due_at.slice(0, 10) : null,
            link: `#/requests/${r.id}`,
          }));
    const kpi = {
      projects: projects.length,
      red: projects.filter((p) => p.health === 'red').length,
      amber: projects.filter((p) => p.health === 'amber').length,
      open_requests: mine.length,
      overdue_requests: projects.reduce((a, p) => a + p.overdue_requests, 0),
      blockers: projects.reduce((a, p) => a + p.blockers, 0),
      late_wps: projects.reduce((a, p) => a + p.late_wps, 0),
    };
    return {
      generated_at: E.iso(),
      aggregate_only: agg,
      kpi,
      projects,
      stages: stage,
      waiting,
      expiring_delegations: expiring,
      note: agg
        ? 'بصفتك مالك المنصة ترى أرقامًا مجمّعة فقط دون محتوى الطلبات.'
        : 'مأخوذة مباشرة من بيانات المشاريع والطلبات التي تراها.',
    };
  });
}
