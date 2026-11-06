// Role-aware dashboard and reports. Every figure is computed from authorised records only — nothing is typed in.
import { addDays, sum, uniq } from './util.mjs';
import * as M from './model.mjs';

export function registerInsights(E) {
  const S = E.state;
  const hoursBetween = (a, b) => Math.max(0, Math.round(((Date.parse(b) - Date.parse(a)) / 3600000) * 10) / 10);
  const avg = (arr) => (arr.length ? Math.round((sum(arr) / arr.length) * 10) / 10 : null);
  const orgAuthority = (u) => S.delegations.some((d) => d.user_id === u.id && d.action === 'commit' && !d.revoked);

  const visibleRequests = (u) =>
    S.requests.filter(
      (r) =>
        E.reqVisible(u, r) &&
        !(['DRAFT', 'PENDING_REQUESTER_APPROVAL'].includes(r.status) && u.org_id !== r.requester_org_id),
    );

  // ------------------------------------------------------------------ dashboard
  E.route('GET', '/dashboard', (ctx) => {
    const u = ctx.user;
    const today = E.today();
    if (E.hasRole(u, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN') && !E.hasRole(u, 'COORDINATING_ADMIN')) {
      return {
        persona: E.hasRole(u, 'SUPER_ADMIN') ? 'مشغّل المنصة' : 'مالك المنصة',
        order: ['platform', 'projects'],
        widgets: {
          platform: {
            counts: {
              users: S.users.length,
              orgs: S.orgs.length,
              projects: S.projects.length,
              requests: S.requests.length,
              sessions: Object.keys(S.sessions).length,
            },
            audit: E.verifyAudit(),
            note: 'مؤشرات تشغيلية مجمّعة. لا يطّلع هذا الدور على محتوى الجهات تلقائيًا.',
          },
          projects: E.hasRole(u, 'PLATFORM_OWNER_ADMIN')
            ? S.projects.map((p) => ({
                id: p.id,
                ref: p.ref,
                name: p.name,
                status: p.status,
                lead_org: E.oname(p.lead_org_id),
                progress: E.progress(p),
                delayed: 0,
                limited: true,
              }))
            : undefined,
        },
        guide: null,
        prefs: S.prefs[u.id]?.widgets || null,
      };
    }
    const projects = E.projectsFor(u).filter((p) => E.access(u, p) !== 'meta');
    const pids = projects.map((p) => p.id);
    const reqs = visibleRequests(u).filter((r) => pids.includes(r.project_id));
    const cards = reqs.map((r) => E.reqCard(u, r));
    const isCommittee = projects.some((p) => E.committeeRole(u, p));
    const isTriage = projects.some((p) => ['chair', 'secretary'].includes(E.committeeRole(u, p)));
    const isSup = E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN');
    const isCoord = E.hasRole(u, 'COORDINATING_ADMIN');
    const isAuth = orgAuthority(u);
    const isAuditor = E.hasRole(u, 'FINAL_AUDITOR');

    // ---- action center: anything where the user has an enabled primary step
    const act = [];
    for (const c of cards) {
      const a = c.actions.find((x) => x.enabled && x.kind === 'primary');
      if (!a) continue;
      act.push({
        kind: 'request',
        icon: 'inbox',
        title: c.title,
        sub: `${c.ref} — ${c.ball.label}`,
        cta: a.label,
        link: `#/requests/${c.id}`,
        urgency: c.overdue ? 'high' : c.required_by && c.required_by <= addDays(today, 5) ? 'high' : 'normal',
        project: c.project_name,
        since: c.updated_at,
      });
    }
    for (const w of S.workPackages.filter((x) => pids.includes(x.project_id))) {
      const p = E.project(w.project_id);
      const caps = E.caps(u, p);
      if (w.status === 'AWAITING_RELEASE' && caps.release)
        act.push({
          kind: 'wp',
          icon: 'key',
          title: `تصريح بدء: ${w.title}`,
          sub: `${w.ref} — ${E.oname(w.owner_org_id)}`,
          cta: 'راجع وأصدر التصريح',
          link: `#/p/${p.id}/board?wp=${w.id}`,
          urgency: 'normal',
          project: p.name,
          since: w.history.at(-1)?.at,
        });
      if (w.status === 'ORG_SUBMITTED' && caps.review_deliverable && u.org_id !== w.owner_org_id)
        act.push({
          kind: 'wp',
          icon: 'check',
          title: `مراجعة مخرج: ${w.title}`,
          sub: `${w.ref} — سلّمته ${E.oname(w.owner_org_id)}`,
          cta: 'راجع المخرج',
          link: `#/p/${p.id}/board?wp=${w.id}`,
          urgency: 'normal',
          project: p.name,
          since: w.submitted_at,
        });
      if (w.status === 'RELEASED' && u.org_id === w.owner_org_id && isSup)
        act.push({
          kind: 'wp',
          icon: 'play',
          title: `ابدأ تنفيذ: ${w.title}`,
          sub: `${w.ref} — صدر التصريح ${w.release?.order_no || ''}`,
          cta: 'ابدأ التنفيذ',
          link: `#/p/${p.id}/board?wp=${w.id}`,
          urgency: 'normal',
          project: p.name,
          since: w.release?.at,
        });
    }
    for (const cr of S.changeRequests.filter((x) => pids.includes(x.project_id) && x.status === 'PENDING')) {
      const p = E.project(cr.project_id);
      if (E.findDelegation(u, 'approve_change', p.id) && cr.required_orgs.includes(u.org_id) && !cr.approvals[u.org_id])
        act.push({
          kind: 'change',
          icon: 'git',
          title: `طلب تغيير ${cr.ref}`,
          sub: cr.reason.slice(0, 80),
          cta: 'ابتّ في الطلب',
          link: `#/commitments?tab=changes&project=${p.id}`,
          urgency: 'normal',
          project: p.name,
          since: cr.at,
        });
    }
    for (const iss of S.issues.filter((x) => pids.includes(x.project_id) && x.status === 'PROPOSED')) {
      const p = E.project(iss.project_id);
      if (E.caps(u, p).create_wp || E.committeeRole(u, p) === 'chair')
        act.push({
          kind: 'issue',
          icon: 'alert',
          title: `عائق خارجي بانتظار الاعتماد: ${iss.title}`,
          sub: `${iss.days} يومًا — ${E.wp(iss.wp_id)?.ref}`,
          cta: 'راجع الدليل',
          link: `#/p/${p.id}/timeline`,
          urgency: 'normal',
          project: p.name,
          since: iss.at,
        });
    }
    for (const c of S.commitments.filter(
      (x) => x.org_id === u.org_id && x.status === 'ACTIVE' && pids.includes(x.project_id),
    )) {
      if (isSup && !S.tasks.some((t) => t.commitment_id === c.id && t.status !== 'CANCELLED'))
        act.push({
          kind: 'commitment',
          icon: 'users',
          title: `وزّع التزام «${E.req(c.request_id).title}» على فريقك`,
          sub: E.req(c.request_id).ref,
          cta: 'أنشئ المهام',
          link: `#/requests/${c.request_id}`,
          urgency: 'high',
          project: E.project(c.project_id).name,
          since: c.accepted_at,
        });
    }
    for (const p of S.projects.filter((x) => x.participation?.[u.org_id]?.status === 'INVITED'))
      if (isAuth)
        act.push({
          kind: 'invite',
          icon: 'mail',
          title: `دعوة للمشاركة في مشروع «${p.name}»`,
          sub: `من ${E.oname(p.lead_org_id)}`,
          cta: 'رد على الدعوة',
          link: '#/projects',
          urgency: 'normal',
          project: p.name,
          since: p.participation[u.org_id].at,
        });
    const myTasks = S.tasks
      .filter((t) => t.assignee_id === u.id && !['DONE_INTERNAL', 'CANCELLED'].includes(t.status))
      .sort((a, b) => (a.planned_end || '9999').localeCompare(b.planned_end || '9999'));
    for (const t of myTasks.filter((t) => t.planned_end && t.planned_end < today).slice(0, 3))
      act.push({
        kind: 'task',
        icon: 'clock',
        title: `مهمة متأخرة: ${t.title}`,
        sub: `${t.ref} — الموعد ${t.planned_end}`,
        cta: 'حدّث الحالة',
        link: `#/tasks?task=${t.id}`,
        urgency: 'high',
        project: E.project(t.project_id)?.name,
        since: t.planned_end,
      });
    act.sort(
      (a, b) =>
        (a.urgency === 'high' ? 0 : 1) - (b.urgency === 'high' ? 0 : 1) || (a.since || '').localeCompare(b.since || ''),
    );

    // ---- KPIs
    const k = [];
    const kp = (key, label, value, hint, link, tone) => k.push({ key, label, value, hint, link, tone });
    const cnt = (f) => cards.filter(f).length;
    if (isCommittee) {
      kp(
        'atc',
        'لدى اللجنة الآن',
        cnt((c) => ['SUBMITTED_TO_COMMITTEE', 'PENDING_CHAIR_ROUTING'].includes(c.status)),
        'طلبات تنتظر فرزًا أو توجيهًا',
        '#/committee',
        'info',
      );
      kp(
        'ato',
        'بانتظار ردّ الجهات',
        cnt((c) => ['REFERRED_TO_ORG', 'UNDER_ORG_REVIEW'].includes(c.status)),
        'محالة ولم يصدر قرارها',
        '#/requests?scope=committee',
        'info',
      );
      kp(
        'ovd',
        'متأخرة في الرد',
        cnt((c) => c.overdue),
        'تجاوزت المدة المرجعية — تذكير لا قبول',
        '#/requests?scope=committee',
        cnt((c) => c.overdue) ? 'danger' : 'success',
      );
      kp(
        'dec',
        'اعتذارات تنتظر قرارك',
        cnt((c) => c.status === 'DECLINED_WITH_REASON'),
        'إعادة توجيه أو إغلاق',
        '#/committee',
        'attention',
      );
    } else if (isAuth || isSup) {
      kp(
        'inc',
        'طلبات واردة لجهتي',
        cnt(
          (c) =>
            c.target_org_id === u.org_id &&
            ['REFERRED_TO_ORG', 'UNDER_ORG_REVIEW', 'REOPEN_REQUESTED'].includes(c.status),
        ),
        'بانتظار قرار الجهة',
        '#/requests?scope=incoming',
        'info',
      );
      kp(
        'out',
        'طلبات صادرة مفتوحة',
        cnt(
          (c) =>
            c.requester_org_id === u.org_id &&
            !['CLOSED_COMPLETED', 'CLOSED_DECLINED', 'WITHDRAWN', 'CANCELLED', 'SPLIT'].includes(c.status),
        ),
        'من جهتي إلى اللجنة والجهات',
        '#/requests?scope=outgoing',
        'info',
      );
      const cms = S.commitments.filter(
        (c) => c.org_id === u.org_id && c.status === 'ACTIVE' && pids.includes(c.project_id),
      );
      kp(
        'cmt',
        'التزامات سارية',
        cms.length,
        `${cms.filter((c) => c.overdue || (c.due_on && c.due_on < today)).length} متأخر`,
        '#/commitments',
        'success',
      );
      const ot = S.tasks.filter((t) => t.org_id === u.org_id && !['DONE_INTERNAL', 'CANCELLED'].includes(t.status));
      kp(
        'tsk',
        'مهام الجهة المفتوحة',
        ot.length,
        `${ot.filter((t) => t.planned_end && t.planned_end < today).length} متأخرة`,
        '#/tasks',
        ot.some((t) => t.planned_end && t.planned_end < today) ? 'attention' : 'info',
      );
    } else {
      kp('mine', 'مهامي المفتوحة', myTasks.length, 'الموكلة إليّ', '#/tasks', 'info');
      kp(
        'late',
        'متأخرة',
        myTasks.filter((t) => t.planned_end && t.planned_end < today).length,
        'تجاوزت موعدها',
        '#/tasks',
        'danger',
      );
      kp(
        'week',
        'تستحق خلال ٧ أيام',
        myTasks.filter((t) => t.planned_end && t.planned_end >= today && t.planned_end <= addDays(today, 7)).length,
        'خطّط لها هذا الأسبوع',
        '#/tasks',
        'attention',
      );
      kp(
        'done',
        'أنجزتُها',
        S.tasks.filter((t) => t.assignee_id === u.id && t.status === 'DONE_INTERNAL').length,
        'مكتملة داخليًا',
        '#/tasks',
        'success',
      );
    }

    // ---- pipeline by stage
    const pipeline = M.STAGES.map((s) => ({
      stage: s,
      label: M.STAGE_LABEL[s],
      count: cards.filter((c) => c.stage === s && !M.TERMINAL.includes(c.status)).length,
    }));

    // ---- upcoming deadlines (14 days)
    const lim = addDays(today, 14);
    const up = [];
    for (const w of S.workPackages.filter(
      (x) => pids.includes(x.project_id) && !['ACCEPTED', 'CLOSED'].includes(x.status) && x.planned_end <= lim,
    ))
      up.push({
        date: w.planned_end,
        title: w.title,
        sub: `${w.ref} — ${E.oname(w.owner_org_id)}`,
        kind: 'حزمة',
        link: `#/p/${w.project_id}/timeline`,
        late: w.planned_end < today,
      });
    for (const t of myTasks.filter((x) => x.planned_end && x.planned_end <= lim))
      up.push({
        date: t.planned_end,
        title: t.title,
        sub: t.ref,
        kind: 'مهمة',
        link: `#/tasks?task=${t.id}`,
        late: t.planned_end < today,
      });
    for (const c of cards.filter(
      (x) =>
        x.required_by &&
        x.required_by <= lim &&
        !M.TERMINAL.includes(x.status) &&
        !['CLOSED_COMPLETED'].includes(x.status),
    ))
      up.push({
        date: c.required_by,
        title: c.title,
        sub: `${c.ref} — موعد الحاجة`,
        kind: 'طلب',
        link: `#/requests/${c.id}`,
        late: c.required_by < today,
      });
    up.sort((a, b) => a.date.localeCompare(b.date));

    // ---- activity
    const activity = [];
    for (const r of reqs)
      for (const e of r.events)
        if (E.eventVisible(u, e, r) && !['note'].includes(e.action))
          activity.push({ at: e.at, text: e.label, who: e.actor_name, ref: r.ref, link: `#/requests/${r.id}` });
    activity.sort((a, b) => b.at.localeCompare(a.at));

    // ---- decline reasons / sla (committee, coordinator, auditor, org own)
    let decl = null;
    let sla = null;
    if (isCommittee || isCoord || isAuditor || isAuth) {
      const counts = {};
      for (const r of reqs)
        for (const d of r.decisions.filter((x) => x.type === 'DECLINE')) {
          counts[d.reason_code] = (counts[d.reason_code] || 0) + 1;
        }
      decl = {
        items: Object.entries(counts)
          .map(([code, n]) => ({ code, label: M.REASON_CODES[code], count: n }))
          .sort((a, b) => b.count - a.count),
        note: 'ارتفاع الاعتذارات لا يعني ضعف أداء جهة — قد يعكس توجيهًا خارج اختصاصها.',
      };
      const rows = reqs.flatMap((r) =>
        r.referrals.map((ref) => {
          const dec = r.decisions.find((d) => d.referral_id === ref.id);
          return { org: ref.target_org_id, h: dec ? hoursBetween(ref.at, dec.at) : null };
        }),
      );
      const orgs = uniq(rows.map((x) => x.org));
      sla = orgs
        .map((o) => ({
          org_id: o,
          org_name: E.oname(o),
          received: rows.filter((x) => x.org === o).length,
          avg_hours: avg(rows.filter((x) => x.org === o && x.h != null).map((x) => x.h)),
        }))
        .filter((x) => isCommittee || isCoord || isAuditor || x.org_id === u.org_id);
    }

    // ---- workload for supervisors
    let workload = null;
    if (isSup) {
      workload = E.orgUsers(u.org_id)
        .filter((x) => !E.hasRole(x, 'SCOPED_VIEWER') && S.tasks.some((t) => t.assignee_id === x.id))
        .map((x) => {
          const ot = S.tasks.filter(
            (t) => t.assignee_id === x.id && !['DONE_INTERNAL', 'CANCELLED'].includes(t.status),
          );
          return {
            id: x.id,
            name: x.name,
            open: ot.length,
            overdue: ot.filter((t) => t.planned_end && t.planned_end < today).length,
            hours: Math.round(sum(ot, (t) => (t.est_hours || 0) * (1 - (t.completion_pct || 0) / 100))),
          };
        });
    }

    const projectCards = projects.map((p) => ({
      id: p.id,
      ref: p.ref,
      name: p.name,
      status: p.status,
      lead_org: E.oname(p.lead_org_id),
      progress: E.progress(p),
      delayed: S.workPackages.filter(
        (w) => w.project_id === p.id && E.wpDelay(w).accountable > 0 && !['ACCEPTED', 'CLOSED'].includes(w.status),
      ).length,
      awaiting: S.workPackages.filter(
        (w) => w.project_id === p.id && ['AWAITING_RELEASE', 'ORG_SUBMITTED'].includes(w.status),
      ).length,
      end: p.end,
    }));

    const persona = isTriage
      ? projects.some((p) => E.committeeRole(u, p) === 'chair')
        ? 'رئيس اللجنة'
        : 'أمانة اللجنة'
      : isCoord
        ? 'منسّق المشروع'
        : isAuth
          ? 'مفوّض جهة'
          : isSup
            ? 'مشرف جهة'
            : isAuditor
              ? 'مدقق'
              : E.hasRole(u, 'INDEPENDENT_REVIEWER')
                ? 'مرجع مستقل'
                : isCommittee
                  ? 'عضو لجنة'
                  : 'منفّذ';
    // a light default: what needs me, my nearest work and dates; charts, activity and analysis widgets are one click away in «تخصيص الصفحة»
    const order = isTriage
      ? ['action_center', 'kpis', 'pipeline', 'projects', 'upcoming']
      : isCoord
        ? ['action_center', 'kpis', 'projects', 'upcoming']
        : isAuth || isSup
          ? ['action_center', 'kpis', 'my_tasks', 'pipeline', 'upcoming']
          : ['action_center', 'kpis', 'my_tasks', 'upcoming', 'projects'];

    // ---- first-steps guide (dismissable)
    const guide = S.prefs[u.id]?.dismissed_guide
      ? null
      : {
          title: 'ابدأ من هنا',
          steps: isTriage
            ? [
                'افتح «لجنة المشروع» وافرز الطلبات الواردة',
                'أحِل الطلب المكتمل إلى الجهة المختصة بمبرر واضح',
                'تابع الردود من لوحة «ماذا أفعل الآن؟»',
              ]
            : isCoord
              ? [
                  'أضف حزم العمل وحدّد الجهة والوزن لكل حزمة',
                  'اعتمد خطة المشروع عندما يصبح مجموع الأوزان ١٠٠٪',
                  'أصدر تصاريح البدء للحزم الجاهزة',
                ]
              : isAuth || isSup
                ? [
                    'راجع الطلبات الواردة لجهتك وردّ بقبول أو اعتذار مسبَّب',
                    'وزّع الالتزامات المقبولة على فريقك كمهام',
                    'حدّث تقدّم المهام لتظهر النسبة للجهة الطالبة',
                  ]
                : [
                    'افتح «مهامي» وحدّث حالة كل مهمة بالسحب بين الأعمدة',
                    'سجّل نسبة الإنجاز وأي عائق',
                    'راسل فريقك من «المحادثات»',
                  ],
        };
    // ---- extra widget sources (§4.4): every row comes from records the user is already authorised to read
    const wpsV = S.workPackages.filter((w) => pids.includes(w.project_id));
    const mini_gantt = wpsV
      .filter((w) => !['CLOSED'].includes(w.status))
      .sort((a, b) => a.planned_start.localeCompare(b.planned_start))
      .slice(0, 8)
      .map((w) => ({
        id: w.id,
        ref: w.ref,
        title: w.title,
        org: E.oname(w.owner_org_id),
        start: w.planned_start,
        end: w.planned_end,
        status: w.status,
        status_ar: M.WP_STATUS[w.status].ar,
        pct: ['ACCEPTED', 'CLOSED'].includes(w.status) ? 100 : w.self_pct || 0,
        project_id: w.project_id,
        link: `#/p/${w.project_id}/timeline`,
        today,
      }));
    const delays_w = wpsV
      .map((w) => ({ w, d: E.wpDelay(w) }))
      .filter((x) => x.d.actual > 0 && !['ACCEPTED', 'CLOSED'].includes(x.w.status))
      .sort((a, b) => b.d.accountable - a.d.accountable)
      .slice(0, 6)
      .map((x) => ({
        id: x.w.id,
        ref: x.w.ref,
        title: x.w.title,
        org: E.oname(x.w.owner_org_id),
        actual: x.d.actual,
        external_approved: x.d.external_approved,
        accountable: x.d.accountable,
        link: `#/p/${x.w.project_id}/board?wp=${x.w.id}`,
      }));
    const blockers = S.issues
      .filter((i) => pids.includes(i.project_id) && ['OPEN', 'PROPOSED'].includes(i.status))
      .slice(0, 8)
      .map((i) => ({
        id: i.id,
        title: i.title,
        kind: i.kind,
        days: i.days || 0,
        status: i.status,
        wp_ref: E.wp(i.wp_id)?.ref,
        link: `#/p/${i.project_id}/timeline`,
      }));
    const deliverables = ['ORG_SUBMITTED', 'ACCEPTED', 'RETURNED'].length
      ? projects.map((p) => {
          const ws = wpsV.filter((w) => w.project_id === p.id);
          return {
            project: p.name,
            id: p.id,
            submitted: ws.filter((w) => w.status === 'ORG_SUBMITTED').length,
            accepted: ws.filter((w) => ['ACCEPTED', 'CLOSED'].includes(w.status)).length,
            total: ws.length,
            link: `#/p/${p.id}/board`,
          };
        })
      : [];
    const meetings = S.decisions
      .filter(
        (d) =>
          pids.includes(d.project_id) &&
          projects.some((p) => p.id === d.project_id && (E.committeeRole(u, p) || E.hasRole(u, 'FINAL_AUDITOR'))),
      )
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 5)
      .map((d) => ({
        id: d.id,
        ref: d.ref,
        title: d.title,
        kind: d.kind === 'minutes' ? 'محضر' : 'قرار',
        meeting_no: d.meeting_no,
        at: d.at,
        link: `#/p/${d.project_id}/committee?tab=decisions`,
      }));
    const comments = S.messages
      .filter((m) => {
        const t = S.threads.find((x) => x.id === m.thread_id);
        return t && t.member_ids.includes(u.id) && m.user_id !== u.id;
      })
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 5)
      .map((m) => {
        const t = S.threads.find((x) => x.id === m.thread_id);
        return {
          id: m.id,
          by: E.uname(m.user_id),
          text: String(m.text).slice(0, 120),
          thread: t.title,
          at: m.at,
          link: `#/messages/${t.id}`,
        };
      });
    // ---- chart data (all derived from the same authorised sets; nothing typed in)
    const monthEnd = (iso) => {
      const d = new Date(iso + 'T00:00:00Z');
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    };
    const scurve = projects
      .map((p) => {
        const ws = S.workPackages.filter((w) => w.project_id === p.id);
        if (!ws.length) return null;
        const lo =
          [p.start, ...ws.map((w) => w.baseline_start || w.planned_start)].filter(Boolean).sort()[0].slice(0, 7) +
          '-01';
        const hi = [p.end, ...ws.map((w) => w.baseline_end || w.planned_end)].filter(Boolean).sort().pop();
        const pts = [];
        let cur = monthEnd(lo);
        let guard = 0;
        while (cur <= monthEnd(hi) && guard++ < 48) {
          const planned = sum(ws.filter((w) => (w.baseline_end || w.planned_end) <= cur).map((w) => w.weight));
          const accepted =
            cur <= monthEnd(today)
              ? sum(
                  ws
                    .filter(
                      (w) => ['ACCEPTED', 'CLOSED'].includes(w.status) && (w.accepted_at || '').slice(0, 10) <= cur,
                    )
                    .map((w) => w.weight),
                )
              : null;
          pts.push({ at: cur, planned: Math.min(100, planned), accepted });
          cur = monthEnd(addDays(cur, 1));
        }
        return { id: p.id, name: p.name, ref: p.ref, today, points: pts };
      })
      .filter(Boolean);
    const wp_status = M.WP_ORDER.map((k) => ({
      key: k,
      label: M.WP_STATUS[k].ar,
      tone: M.WP_STATUS[k].tone,
      count: wpsV.filter((w) => w.status === k).length,
    }));
    const taskScope = S.tasks.filter(
      (t) =>
        (isSup ? t.org_id === u.org_id : t.assignee_id === u.id) &&
        t.status !== 'CANCELLED' &&
        (!t.project_id || pids.includes(t.project_id)),
    );
    const tasks_status = M.TASK_ORDER.map((k) => ({
      key: k,
      label: M.TASK_STATUS[k].ar,
      tone: M.TASK_STATUS[k].tone,
      count: taskScope.filter((t) => t.status === k).length,
    }));
    const due_weeks = Array.from({ length: 8 }, (_, i) => {
      const a = addDays(today, i * 7);
      const b = addDays(today, i * 7 + 6);
      const inR = (d) => d && (i === 0 ? d <= b : d >= a && d <= b);
      return {
        from: a,
        to: b,
        wp: wpsV.filter((w) => !['ACCEPTED', 'CLOSED'].includes(w.status) && inR(w.planned_end)).length,
        tasks: taskScope.filter((t) => t.status !== 'DONE_INTERNAL' && inR(t.planned_end)).length,
        requests: cards.filter((c) => !M.TERMINAL.includes(c.status) && inR(c.required_by)).length,
      };
    });
    const delay_org = uniq(wpsV.map((w) => w.owner_org_id))
      .map((o) => {
        const lw = wpsV
          .filter((w) => w.owner_org_id === o && !['ACCEPTED', 'CLOSED'].includes(w.status))
          .map((w) => E.wpDelay(w));
        return {
          org: E.oname(o),
          days: sum(lw.map((d) => d.accountable)),
          late: lw.filter((d) => d.accountable > 0).length,
          open: lw.length,
        };
      })
      .filter((x) => x.open)
      .sort((a, b) => b.days - a.days);
    const charts = { wp_status, tasks_status, due_weeks, delay_org, scurve, pipeline };
    const catalog = [
      'action_center',
      'charts',
      'pipeline',
      'projects',
      'my_tasks',
      'workload',
      'upcoming',
      'activity',
      'sla',
      'decline',
      'mini_gantt',
      'delays',
      'blockers',
      'deliverables',
      'meetings',
      'comments',
    ].filter(
      // a plain executive cannot add the organisation-level widgets (request pipeline, team load, response times, declines, committee minutes)
      (w) => persona !== 'منفّذ' || !['pipeline', 'workload', 'sla', 'decline', 'meetings'].includes(w),
    );
    return {
      persona,
      order,
      catalog,
      guide,
      prefs: S.prefs[u.id]?.widgets || null,
      today,
      widgets: {
        action_center: { items: act.slice(0, 12), total: act.length },
        kpis: k,
        pipeline,
        projects: projectCards,
        my_tasks: myTasks.slice(0, 7).map((t) => ({
          id: t.id,
          ref: t.ref,
          title: t.title,
          status: t.status,
          status_ar: M.TASK_STATUS[t.status].ar,
          tone: M.TASK_STATUS[t.status].tone,
          end: t.planned_end,
          pct: t.completion_pct,
          overdue: !!t.planned_end && t.planned_end < today,
          project: E.project(t.project_id)?.name,
        })),
        charts,
        upcoming: up.slice(0, 9),
        activity: activity.slice(0, 8),
        decline: decl,
        sla,
        workload,
        mini_gantt,
        delays: delays_w,
        blockers,
        deliverables,
        meetings,
        comments,
      },
    };
  });

  // ------------------------------------------------------------------ reports
  E.route('GET', '/reports', (ctx) => {
    const u = ctx.user;
    const { project_id } = ctx.query;
    let projects = E.projectsFor(u).filter((p) => E.access(u, p) !== 'meta');
    if (project_id) projects = [E.needProject(u, project_id, 'viewer')];
    const pids = projects.map((p) => p.id);
    const reqs = visibleRequests(u).filter((r) => pids.includes(r.project_id));
    const wide = projects.some((p) => E.committeeRole(u, p)) || E.hasRole(u, 'COORDINATING_ADMIN', 'FINAL_AUDITOR');
    const rows = [];
    for (const r of reqs) {
      const firstRef = r.referrals[0];
      for (const ref of r.referrals) {
        const dec = r.decisions.find((d) => d.referral_id === ref.id);
        rows.push({ req: r, ref, dec, first: ref === firstRef });
      }
      if (!r.referrals.length) rows.push({ req: r, ref: null, dec: null, first: false });
    }
    const triageH = avg(
      reqs.filter((r) => r.submitted_at && r.referrals[0]).map((r) => hoursBetween(r.submitted_at, r.referrals[0].at)),
    );
    const orgRespH = avg(rows.filter((x) => x.ref && x.dec).map((x) => hoursBetween(x.ref.at, x.dec.at)));
    const execH = avg(
      S.commitments
        .filter(
          (c) =>
            pids.includes(c.project_id) &&
            c.status !== 'ACTIVE' &&
            c.closed_at &&
            (wide || c.org_id === u.org_id || E.req(c.request_id).requester_org_id === u.org_id),
        )
        .map((c) => hoursBetween(c.accepted_at, c.closed_at)),
    );
    const byStatus = Object.entries(
      reqs.reduce((m, r) => {
        m[r.status] = (m[r.status] || 0) + 1;
        return m;
      }, {}),
    ).map(([s, n]) => ({ status: s, label: M.REQUEST_STATUS[s].ar, tone: M.REQUEST_STATUS[s].tone, count: n }));
    const declines = reqs.flatMap((r) =>
      r.decisions.filter((d) => d.type === 'DECLINE').map((d) => ({ code: d.reason_code, ref: r.ref, id: r.id })),
    );
    const declineBy = Object.entries(
      declines.reduce((m, d) => {
        m[d.code] = (m[d.code] || 0) + 1;
        return m;
      }, {}),
    )
      .map(([code, count]) => ({ code, label: M.REASON_CODES[code], count }))
      .sort((a, b) => b.count - a.count);
    const orgIds = uniq([
      ...rows.filter((x) => x.ref).map((x) => x.ref.target_org_id),
      ...(wide || !u.org_id ? [] : [u.org_id]),
    ]).filter((o) => wide || o === u.org_id);
    const orgs = orgIds.map((o) => {
      const rs = rows.filter((x) => x.ref?.target_org_id === o);
      const decs = rs.filter((x) => x.dec);
      return {
        org_id: o,
        org_name: E.oname(o),
        received: rs.length,
        accepted: decs.filter((x) => x.dec.type === 'ACCEPT').length,
        declined: decs.filter((x) => x.dec.type === 'DECLINE').length,
        counter: decs.filter((x) => x.dec.type === 'COUNTER').length,
        need_info: decs.filter((x) => x.dec.type === 'NEED_INFO').length,
        pending: rs.filter((x) => !x.dec && !x.ref.superseded_by).length,
        avg_hours: avg(decs.map((x) => hoursBetween(x.ref.at, x.dec.at))),
        overdue_now: reqs.filter(
          (r) =>
            r.target_org_id === o &&
            ['REFERRED_TO_ORG', 'UNDER_ORG_REVIEW'].includes(r.status) &&
            r.response_due_at &&
            E.iso() > r.response_due_at,
        ).length,
        outgoing: reqs.filter(
          (r) => r.requester_org_id === o && !['DRAFT', 'PENDING_REQUESTER_APPROVAL'].includes(r.status),
        ).length,
        completion_pct: (() => {
          const own = S.commitments.filter((c) => c.org_id === o && pids.includes(c.project_id));
          return own.length ? Math.round((own.filter((c) => c.status !== 'ACTIVE').length / own.length) * 100) : null;
        })(),
        active_commitments: S.commitments.filter(
          (c) => c.org_id === o && c.status === 'ACTIVE' && pids.includes(c.project_id),
        ).length,
        open_tasks:
          o === u.org_id
            ? S.tasks.filter(
                (t) =>
                  t.org_id === o && pids.includes(t.project_id) && !['DONE_INTERNAL', 'CANCELLED'].includes(t.status),
              ).length
            : null,
        team_load_hours:
          o === u.org_id
            ? Math.round(
                S.tasks
                  .filter(
                    (t) =>
                      t.org_id === o &&
                      pids.includes(t.project_id) &&
                      !['DONE_INTERNAL', 'CANCELLED'].includes(t.status),
                  )
                  .reduce((a, t) => a + (t.est_hours || 0) * (1 - (t.completion_pct || 0) / 100), 0),
              )
            : null,
        accountable_delay_days: sum(
          S.workPackages.filter(
            (w) => w.owner_org_id === o && pids.includes(w.project_id) && !['ACCEPTED', 'CLOSED'].includes(w.status),
          ),
          (w) => E.wpDelay(w).accountable,
        ),
        deliverables_submitted: S.workPackages.filter(
          (w) =>
            w.owner_org_id === o &&
            pids.includes(w.project_id) &&
            ['ORG_SUBMITTED', 'ACCEPTED', 'CLOSED'].includes(w.status),
        ).length,
        deliverables_accepted: S.workPackages.filter(
          (w) => w.owner_org_id === o && pids.includes(w.project_id) && ['ACCEPTED', 'CLOSED'].includes(w.status),
        ).length,
        decline_reasons:
          Object.entries(
            decs
              .filter((x) => x.dec.type === 'DECLINE')
              .reduce((m, x) => {
                m[x.dec.reason_code] = (m[x.dec.reason_code] || 0) + 1;
                return m;
              }, {}),
          )
            .map(([k, n]) => `${M.REASON_CODES[k] || k}: ${n}`)
            .join('، ') || '—',
      };
    });
    const wps = S.workPackages.filter((w) => pids.includes(w.project_id));
    const delays = wps
      .map((w) => ({
        id: w.id,
        ref: w.ref,
        title: w.title,
        project: E.project(w.project_id).name,
        org: E.oname(w.owner_org_id),
        status_ar: M.WP_STATUS[w.status].ar,
        ...E.wpDelay(w),
      }))
      .filter((d) => d.actual > 0);
    const extDays = sum(
      S.issues.filter((i) => pids.includes(i.project_id) && i.kind === 'external' && i.status === 'APPROVED'),
      (i) => i.days,
    );
    const prog = projects.map((p) => ({
      id: p.id,
      name: p.name,
      ref: p.ref,
      ...E.progress(p),
      wp: S.workPackages
        .filter((w) => w.project_id === p.id)
        .map((w) => ({
          ref: w.ref,
          title: w.title,
          weight: w.weight,
          status: w.status,
          status_ar: M.WP_STATUS[w.status].ar,
          tone: M.WP_STATUS[w.status].tone,
          org: E.oname(w.owner_org_id),
        })),
    }));

    // ---- §12.1 project-level KPIs: each number carries the authorised records it was computed from (drill-down)
    const rec = (r) => ({
      id: r.id,
      ref: r.ref,
      title: r.title,
      status_ar: M.REQUEST_STATUS[r.status].ar,
      link: `#/requests/${r.id}`,
    });
    const by = (sts) => reqs.filter((r) => sts.includes(r.status));
    const overdueReqs = reqs.filter((r) => E.reqCard(u, r).sla?.overdue && !M.TERMINAL.includes(r.status));
    const delayedWps = wps.filter((w) => !['ACCEPTED', 'CLOSED'].includes(w.status) && E.wpDelay(w).accountable > 0);
    const wpRec = (w) => ({
      id: w.id,
      ref: w.ref,
      title: w.title,
      status_ar: M.WP_STATUS[w.status].ar,
      link: `#/p/${w.project_id}/board?wp=${w.id}`,
    });
    const critDeps = wps.filter(
      (w) =>
        !['ACCEPTED', 'CLOSED'].includes(w.status) &&
        wps.some((x) => x.depends_on.includes(w.id) && !['ACCEPTED', 'CLOSED'].includes(x.status)),
    );
    const activeCm = S.commitments.filter(
      (c) =>
        pids.includes(c.project_id) &&
        c.status === 'ACTIVE' &&
        (wide || c.org_id === u.org_id || E.req(c.request_id)?.requester_org_id === u.org_id),
    );
    const K = (key, label, label_en, recs, extra = {}) => ({
      key,
      label,
      label_en,
      value: recs.length,
      records: recs.slice(0, 50),
      link: extra.link || null,
      source: extra.source || 'سجل الطلبات المصرّح بها',
      updated_at: E.iso(),
    });
    const verifiedAvg = projects.length
      ? Math.round(projects.reduce((a, p) => a + E.progress(p).verified, 0) / projects.length)
      : 0;
    const project_kpis = [
      K('total_requests', 'إجمالي الطلبات', 'Total Requests', reqs.map(rec)),
      K(
        'waiting_committee',
        'بانتظار اللجنة',
        'Waiting Committee',
        by(['SUBMITTED_TO_COMMITTEE', 'PENDING_CHAIR_ROUTING']).map(rec),
      ),
      K(
        'waiting_org',
        'بانتظار قرار الجهة',
        'Waiting Org Decision',
        by(['REFERRED_TO_ORG', 'UNDER_ORG_REVIEW', 'COUNTERPROPOSAL', 'REOPEN_REQUESTED']).map(rec),
      ),
      K(
        'accepted_commitments',
        'التزامات مقبولة سارية',
        'Accepted Commitments',
        activeCm.map((c) => rec(E.req(c.request_id))),
        { source: 'سجل الالتزامات' },
      ),
      K('declined', 'طلبات معتذر عنها', 'Declined Requests', by(['DECLINED_WITH_REASON', 'CLOSED_DECLINED']).map(rec)),
      K(
        'awaiting_info',
        'بانتظار استكمال معلومات',
        'Awaiting Information',
        by(['NEEDS_INFORMATION', 'RETURNED_TO_REQUESTER']).map(rec),
      ),
      K(
        'in_execution',
        'قيد التنفيذ',
        'In Execution',
        by([
          'ACCEPTED_BY_ORG',
          'READY_FOR_RELEASE',
          'IN_EXECUTION',
          'BLOCKED',
          'ESCALATED',
          'CHANGE_REQUESTED',
          'RETURNED_FOR_CORRECTION',
        ]).map(rec),
      ),
      K(
        'accepted_deliverables',
        'مخرجات معتمدة',
        'Accepted Deliverables',
        by(['ACCEPTED_DELIVERABLE', 'CLOSED_COMPLETED']).map(rec),
      ),
      K('overdue_response', 'تجاوز مدة الرد', 'Overdue Response', overdueReqs.map(rec)),
      K('delayed_wps', 'حزم متأخرة (قابلة للمساءلة)', 'Delayed Work Packages', delayedWps.map(wpRec), {
        source: 'سجل الحزم بعد خصم العوائق المعتمدة',
      }),
      K('critical_deps', 'اعتماديات حرجة', 'Critical Dependencies', critDeps.map(wpRec), {
        source: 'حزم غير مقبولة تنتظرها حزم أخرى',
      }),
    ];
    project_kpis.push({
      key: 'weighted_verified',
      label: 'الإنجاز المعتمد الموزون',
      label_en: '% Weighted Verified Completion',
      value: verifiedAvg,
      unit: '%',
      records: prog.map((x) => ({
        id: x.id,
        ref: x.ref,
        title: x.name,
        status_ar: `معتمد ${x.verified}%`,
        link: `#/p/${x.id}/overview`,
      })),
      source: 'مجموع أوزان الحزم المقبولة — لا متوسط التصريحات الذاتية',
      updated_at: E.iso(),
    });
    // ---- who received what, when, who answered, did they accept, what changed (project report, §12.3)
    const routing_log = reqs
      .filter((r) => r.referrals.length)
      .slice(0, 100)
      .flatMap((r) =>
        r.referrals.map((ref) => {
          const d = r.decisions.find((x) => x.referral_id === ref.id);
          return {
            request_id: r.id,
            ref: r.ref,
            title: r.title,
            submitted_at: r.submitted_at,
            routed_at: ref.at,
            routed_by: E.uname(ref.by),
            target_org: E.oname(ref.target_org_id),
            received_by: ref.ack_by ? E.uname(ref.ack_by) : null,
            received_at: ref.ack_at || null,
            answered_by: d ? E.uname(d.by) : null,
            answered_at: d?.at || null,
            decision: d
              ? { ACCEPT: 'قبول', DECLINE: 'اعتذار', COUNTER: 'مقترح بديل', NEED_INFO: 'طلب استكمال' }[d.type] || d.type
              : 'لم يرد بعد',
            superseded: !!ref.superseded_by,
            status_now: M.REQUEST_STATUS[r.status].ar,
          };
        }),
      );
    return {
      generated_at: E.iso(),
      project_kpis,
      routing_log,
      scope: project_id ? projects[0].name : 'كل المشاريع المتاحة لك',
      wide,
      kpis: [
        {
          label: 'متوسط زمن فرز اللجنة وتوجيهها',
          value: triageH,
          unit: 'ساعة',
          hint: 'من استلام اللجنة إلى الإحالة الأولى',
          source: 'سجل أحداث الطلبات',
        },
        {
          label: 'متوسط زمن رد الجهات',
          value: orgRespH,
          unit: 'ساعة',
          hint: 'من الإحالة إلى أول قرار رسمي',
          source: 'سجل الإحالات والقرارات',
        },
        {
          label: 'متوسط زمن الالتزامات المنجزة',
          value: execH,
          unit: 'ساعة',
          hint: 'من القبول إلى الإغلاق',
          source: 'سجل الالتزامات',
        },
        {
          label: 'أيام العوائق الخارجية المعتمدة',
          value: extDays,
          unit: 'يوم',
          hint: 'تُخصم من التأخير القابل للمساءلة بدليل فقط',
          source: 'سجل العوائق',
        },
      ],
      requests_total: reqs.length,
      by_status: byStatus,
      decline_reasons: declineBy,
      decline_note: 'عدد الاعتذارات لا يقيس أداء الجهة؛ فسبب «خارج الاختصاص» مثلًا يعكس التوجيه لا التقصير.',
      orgs,
      progress: prog,
      delays,
      delay_note:
        'التأخير الفعلي يظهر دائمًا؛ يُخصم منه فقط العائق الخارجي الموثّق والمعتمد. تعديل خط الأساس لا يتم إلا بطلب تغيير.',
      delay_split: {
        routing: triageH,
        org_response: orgRespH,
        execution_days: sum(delays, (d) => d.accountable),
        external_days: extDays,
      },
    };
  });
}
