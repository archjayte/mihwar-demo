// Interagency request workflow — the heart of MIHWAR.
// Request -> Committee (referral only) -> Competent org (accept / decline with reason / counter / need info)
// -> Commitment -> internal tasks inside that org. Silence is never acceptance.
import { fail, clean, isDay, uniq } from './util.mjs';
import * as M from './model.mjs';

export function registerRequests(E) {
  const S = E.state;
  const REQ_RO_ROLES = ['SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN'];

  // ---------------------------------------------------------------- visibility
  const targetOrgsEver = (r) => uniq((r.referrals || []).map((x) => x.target_org_id));
  const isTargetMember = (u, r) =>
    targetOrgsEver(r).includes(u.org_id) &&
    (E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') ||
      S.delegations.some((d) => d.user_id === u.id && d.action === 'commit' && !d.revoked));
  E.reqVisible = (u, r) => {
    if (E.hasRole(u, ...REQ_RO_ROLES)) return E.hasRole(u, 'SUPER_ADMIN') && !!E.breakGlassOk?.(u, r.project_id);
    const p = E.project(r.project_id);
    if (!p) return false;
    if (E.committeeRole(u, p)) return true;
    if (u.org_id === r.requester_org_id) return true;
    if (isTargetMember(u, r)) return true;
    if (E.hasRole(u, 'FINAL_AUDITOR')) return true;
    if (r.dispute?.reviewer_id === u.id || r.dispute?.alt_reviewer_id === u.id) return true;
    return false;
  };
  const needReq = (ctx) => {
    const r = E.req(ctx.params.id);
    if (
      r &&
      !E.reqVisible(ctx.user, r) &&
      ctx.route?.method === 'POST' &&
      r.target_org_id === ctx.user.org_id &&
      !E.hasRole(ctx.user, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN')
    )
      fail(403, 'NO_DELEGATION', 'لا تملك تفويضًا بإجراءات هذا الطلب؛ تُتخذ قرارات الجهة من مفوّضها المعتمد.', {
        project_id: r.project_id,
      });
    if (!r || !E.reqVisible(ctx.user, r)) fail(404, 'NOT_FOUND', 'الطلب غير موجود أو لا تملك صلاحية الاطلاع عليه');
    return r;
  };
  const eventVisible = (E.eventVisible = (u, ev, r) => {
    if (!ev.vis || ev.vis === 'all') return true;
    if (ev.vis === 'committee') return !!E.committeeRole(u, E.project(r.project_id)) || E.hasRole(u, 'FINAL_AUDITOR');
    return u.org_id === ev.vis;
  });

  // ---------------------------------------------------------------- helpers
  const addEvent = (r, u, action, label, extra = {}) => {
    r.events.push({
      id: E.id('evt'),
      at: E.iso(),
      actor_id: u?.id || null,
      actor_name: u?.name || 'النظام',
      actor_org: u?.org_id ? E.oname(u.org_id) : '',
      action,
      label,
      from: extra.from || null,
      to: extra.to || null,
      reason: extra.reason || '',
      detail: extra.detail || '',
      vis: extra.vis || 'all',
    });
  };
  const compValid = (c) => {
    const t = E.today();
    return (!c.valid_from || c.valid_from <= t) && (!c.valid_to || c.valid_to >= t);
  };
  const slaHours = (r, orgId) => {
    const types = uniq(r.items.map((i) => i.service_type));
    const hs = S.competencies
      .filter((c) => compValid(c) && types.includes(c.service_type) && c.owner_org_id === orgId)
      .map((c) => c.sla_hours);
    return hs.length ? Math.max(...hs) : 72;
  };
  // master requirements 3.3(6): a request an authority declined is never silently re-created by referring it to the same authority again
  const declinedBefore = (r, org) => r.decisions.some((d) => d.type === 'DECLINE' && d.org_id === org);
  const reReferralGuard = (r, b, o) => {
    if (declinedBefore(r, o) && clean(b.review_note, 1000).length < 10)
      fail(
        422,
        'REREFERRAL_NEEDS_REVIEW_NOTE',
        `سبق أن اعتذرت ${E.oname(o)} عن هذا الطلب. لا تُعاد الإحالة إليها دون مذكرة مراجعة (10 أحرف فأكثر) توضّح ما تغيّر — أو أنشئ طلبًا جديدًا واضحًا.`,
        { target_org_id: o },
      );
  };
  // FR-REQ-020: when an approved change request issues a new baseline, open requests and evidence tied to the changed work packages
  // move to the new controlled version; the move is recorded on each record (history is never overwritten) and in the audit log.
  E.migrateBaseline = (p, cr, u, fromV, toV) => {
    const wpIds = new Set(cr.changes.map((c) => c.wp_id));
    let reqs = 0;
    let evs = 0;
    for (const r of S.requests) {
      if (r.project_id !== p.id || !r.wp_id || !wpIds.has(r.wp_id)) continue;
      if (/^(CLOSED|WITHDRAWN|CANCELLED|SPLIT)/.test(r.status)) continue;
      (r.baseline_history ||= []).push({
        from: r.baseline_version || fromV,
        to: toV,
        change_request: cr.ref,
        at: E.iso(),
      });
      r.baseline_version = toV;
      for (const e of r.evidence) {
        (e.baseline_trail ||= []).push({ from: e.baseline_version || fromV, to: toV });
        e.baseline_version = toV;
        evs++;
      }
      addEvent(r, u, 'baseline-migrated', `رُحّل الطلب والأدلة المرتبطة به إلى خط الأساس ${toV} بسبب ${cr.ref}`, {
        detail: `من v${fromV} إلى v${toV}`,
        vis: 'all',
      });
      r.version++;
      reqs++;
    }
    for (const w of S.workPackages.filter((x) => x.project_id === p.id && wpIds.has(x.id)))
      for (const e of w.evidence) {
        (e.baseline_trail ||= []).push({ from: e.baseline_version || fromV, to: toV });
        e.baseline_version = toV;
        evs++;
      }
    cr.migrated = { requests: reqs, evidence: evs };
    E.audit({
      actor_id: u.id,
      action: 'baseline.migrate',
      object_type: 'change_request',
      object_id: cr.id,
      project_id: p.id,
      from: `v${fromV}`,
      to: `v${toV}`,
      detail: `${reqs} طلبات، ${evs} دليلًا`,
    });
  };
  const requesterAuthority = (u, r) =>
    u.org_id === r.requester_org_id && !!E.findDelegation(u, 'submit_request', r.project_id);
  const requesterMember = (u, r) => u.org_id === r.requester_org_id && !E.hasRole(u, 'SCOPED_VIEWER');
  const actingDeputy = (u, r) =>
    E.committeeRole(u, E.project(r.project_id)) === 'deputy' && !!E.findDelegation(u, 'route', r.project_id);
  const committeeTriage = (u, r) => {
    const cr = E.committeeRole(u, E.project(r.project_id));
    return cr === 'chair' || cr === 'secretary' || actingDeputy(u, r);
  };
  const committeeChair = (u, r) => E.committeeRole(u, E.project(r.project_id)) === 'chair' || actingDeputy(u, r);
  const authorityOf = (orgId) =>
    S.delegations.filter((d) => d.org_id === orgId && d.action === 'commit' && !d.revoked).map((d) => d.user_id);
  const orgLeaders = (orgId) =>
    E.orgUsers(orgId)
      .filter((x) => E.hasRole(x, 'ORG_SUPERVISOR', 'ORG_ADMIN') || authorityOf(orgId).includes(x.id))
      .map((x) => x.id);
  const committeeIds = (r) => {
    const p = E.project(r.project_id);
    return [p.committee.chair_id, p.committee.secretary_id].concat(
      p.committee.deputy_id ? [p.committee.deputy_id] : [],
    );
  };
  const linkOf = (r) => `#/requests/${r.id}`;
  const curReferral = (r) => [...r.referrals].reverse().find((x) => !x.superseded_by) || null;
  const ensureThread = (r) => {
    let t = S.threads.find((x) => x.request_id === r.id);
    if (!t)
      t = E.createThread({
        project_id: r.project_id,
        kind: 'request',
        title: `[${r.ref}] ${r.title}`,
        member_ids: [
          r.created_by,
          ...committeeIds(r),
          ...authorityOf(r.requester_org_id).filter((id) => E.user(id)?.org_id === r.requester_org_id),
        ],
        request_id: r.id,
        created_by: r.created_by,
      });
    return t;
  };
  const addToThread = (r, ids) => {
    const t = ensureThread(r);
    t.member_ids = uniq([...t.member_ids, ...ids]);
  };

  // who holds the ball right now
  const ball = (r) => {
    const t = r.target_org_id;
    const cur = curReferral(r);
    const m = {
      DRAFT: ['requester', r.requester_org_id, 'الجهة الطالبة تُكمل المسودة'],
      PENDING_REQUESTER_APPROVAL: ['requester', r.requester_org_id, 'بانتظار اعتماد مفوّض الجهة الطالبة'],
      NEEDS_INFORMATION: ['requester', r.requester_org_id, 'الجهة الطالبة تستكمل المطلوب'],
      SUBMITTED_TO_COMMITTEE: ['committee', null, 'أمانة اللجنة تفرز الطلب'],
      PENDING_CHAIR_ROUTING: ['committee', null, 'رئيس اللجنة يوجّه الطلب'],
      REFERRED_TO_ORG: ['org', t, 'الجهة المختصة تستلم الطلب'],
      UNDER_ORG_REVIEW: ['org', t, 'الجهة المختصة تدرس الطلب وتردّ'],
      REOPEN_REQUESTED: ['org', t, 'الجهة المختصة تعيد النظر'],
      COUNTERPROPOSAL: ['requester', r.requester_org_id, 'الجهة الطالبة تراجع المقترح البديل'],
      DECLINED_WITH_REASON: ['committee', null, 'اللجنة تقرّر: إعادة توجيه أو إغلاق'],
      ACCEPTED_BY_ORG: ['org', t, 'الجهة تبدأ التنفيذ داخليًا'],
      READY_FOR_RELEASE: ['org', t, 'بانتظار تصريح بدء حزمة العمل من المفوّض'],
      ESCALATED: ['committee', null, 'رئيس اللجنة يتابع التصعيد'],
      CHANGE_REQUESTED: ['org', t, 'بانتظار اعتماد طلب التغيير من الجهات المتأثرة'],
      RETURNED_TO_REQUESTER: ['requester', r.requester_org_id, 'أعاد الرئيس الطلب للجهة الطالبة'],
      IN_EXECUTION: ['org', t, 'الجهة تنفّذ'],
      BLOCKED: ['org', t, 'الجهة تعالج العائق'],
      RETURNED_FOR_CORRECTION: ['org', t, 'الجهة تصحّح المخرج'],
      ORG_SUBMITTED: ['requester', r.requester_org_id, 'الجهة الطالبة تراجع المخرج'],
      ACCEPTED_DELIVERABLE: ['committee', null, 'أمانة اللجنة تغلق الطلب'],
    }[r.status];
    if (!m) return { holder: 'none', org_id: null, label: 'لا إجراء مطلوب' };
    return {
      holder: m[0],
      org_id: m[1],
      org_name: m[1] ? E.oname(m[1]) : m[0] === 'committee' ? 'لجنة المشروع' : null,
      label: m[2],
      since: r.events.at(-1)?.at,
      due: ['REFERRED_TO_ORG', 'UNDER_ORG_REVIEW'].includes(r.status) ? cur?.response_due_at || null : null,
    };
  };

  const overdue = (r) =>
    ['REFERRED_TO_ORG', 'UNDER_ORG_REVIEW'].includes(r.status) && r.response_due_at && E.iso() > r.response_due_at;

  // ---------------------------------------------------------------- action table
  // Each action: from-states, party, authorization check (returns [code,message] or null), validation, effect.
  const REASON_REQ = (b, label = 'السبب') => {
    const t = clean(b.reason_text || b.reason, 1500);
    if (!t) fail(422, 'MISSING_REASON', `${label} مطلوب`);
    return t;
  };
  const itemsComplete = (r) =>
    r.title && r.description && r.items.length && r.items.every((i) => i.title) && isDay(r.required_by);

  const ACTIONS = {
    'send-for-approval': {
      label: 'إرسال للاعتماد',
      kind: 'secondary',
      from: ['DRAFT'],
      to: 'PENDING_REQUESTER_APPROVAL',
      party: 'requester',
      auth: (u, r) =>
        requesterMember(u, r) &&
        (u.id === r.created_by || requesterAuthority(u, r) || E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN'))
          ? null
          : ['WRONG_ORGANIZATION', 'هذا الإجراء للجهة الطالبة'],
      validate: (u, r) => {
        if (!itemsComplete(r)) fail(422, 'INCOMPLETE_REQUEST', 'أكمل العنوان والوصف والعناصر وموعد الحاجة قبل الإرسال');
      },
      label_ev: 'أُرسل الطلب لاعتماد مفوّض الجهة',
    },
    submit: {
      label: 'اعتماد وإرسال إلى اللجنة',
      kind: 'primary',
      from: ['PENDING_REQUESTER_APPROVAL'],
      to: 'SUBMITTED_TO_COMMITTEE',
      party: 'requester',
      auth: (u, r) =>
        u.org_id !== r.requester_org_id
          ? ['WRONG_ORGANIZATION', 'اعتماد الإرسال من الجهة الطالبة']
          : !E.findDelegation(u, 'submit_request', r.project_id)
            ? ['NO_DELEGATION', 'اعتماد الإرسال باسم الجهة يحتاج تفويض «اعتماد وإرسال الطلبات»']
            : null,
      validate: (u, r) => {
        if (!itemsComplete(r)) fail(422, 'INCOMPLETE_REQUEST', 'الطلب غير مكتمل');
      },
      effect: (u, r) => {
        r.submitted_at = E.iso();
        const t = ensureThread(r);
        E.postMessage(
          t,
          u.id,
          `أُرسل الطلب ${r.ref} إلى لجنة المشروع. هذه المحادثة للتنسيق والاستفسار ولا تُعد قرارًا رسميًا.`,
        );
        E.notify(
          committeeIds(r),
          {
            kind: 'request',
            title: `طلب جديد لدى اللجنة: ${r.title}`,
            body: `${r.ref} — ${E.oname(r.requester_org_id)}`,
            link: linkOf(r),
            project_id: r.project_id,
          },
          u.id,
        );
      },
      label_ev: 'اعتُمد الطلب وأُرسل إلى لجنة المشروع',
    },
    'return-to-draft': {
      label: 'إعادته مسودة',
      kind: 'secondary',
      from: ['PENDING_REQUESTER_APPROVAL'],
      to: 'DRAFT',
      party: 'requester',
      needsReason: true,
      auth: (u, r) => (requesterAuthority(u, r) ? null : ['NO_DELEGATION', 'لمفوّض الجهة الطالبة']),
      validate: (u, r, b) => REASON_REQ(b, 'سبب الإعادة'),
      label_ev: 'أُعيد الطلب إلى المسودة',
    },
    'request-info': {
      label: 'طلب استكمال',
      kind: 'secondary',
      from: ['SUBMITTED_TO_COMMITTEE', 'PENDING_CHAIR_ROUTING'],
      to: 'NEEDS_INFORMATION',
      party: 'committee',
      needsMissing: true,
      auth: (u, r) => (committeeTriage(u, r) ? null : ['NO_PERMISSION', 'لأمانة اللجنة أو رئيسها']),
      validate: (u, r, b) => {
        if (
          !(Array.isArray(b.missing_items)
            ? b.missing_items.map((x) => clean(x, 200)).filter(Boolean).length
            : clean(b.missing_text, 800))
        )
          fail(422, 'MISSING_ITEMS', 'اذكر ما ينقص الطلب تحديدًا');
      },
      effect: (u, r, b) => {
        const items = Array.isArray(b.missing_items)
          ? b.missing_items.map((x) => clean(x, 200)).filter(Boolean)
          : [clean(b.missing_text, 800)];
        r.info_request = { by: 'committee', by_org: null, items, at: E.iso() };
        E.notify(
          [r.created_by, ...authorityOf(r.requester_org_id)],
          {
            kind: 'request',
            title: `مطلوب استكمال الطلب ${r.ref}`,
            body: items.join('، ').slice(0, 120),
            link: linkOf(r),
            project_id: r.project_id,
          },
          u.id,
        );
      },
      label_ev: 'طلبت اللجنة استكمال الطلب',
    },
    'respond-info': {
      label: 'إرسال الاستكمال',
      kind: 'primary',
      from: ['NEEDS_INFORMATION', 'RETURNED_TO_REQUESTER'],
      to: 'SUBMITTED_TO_COMMITTEE',
      party: 'requester',
      needsResponse: true,
      auth: (u, r) => (requesterMember(u, r) ? null : ['WRONG_ORGANIZATION', 'للجهة الطالبة']),
      validate: (u, r, b) => {
        if (!clean(b.response_text, 2000)) fail(422, 'MISSING_RESPONSE', 'اكتب ما استُكمل أو أرفق المستند');
      },
      effect: (u, r, b) => {
        const by = r.info_request?.by;
        r.info_response = { at: E.iso(), by: u.id, text: clean(b.response_text, 2000) };
        if (by === 'org') r.reroute_hint = r.target_org_id;
        E.notify(
          [...committeeIds(r)],
          {
            kind: 'request',
            title: `استُكمل الطلب ${r.ref}`,
            body: by === 'org' ? `جاهز لإعادة الإحالة إلى ${E.oname(r.target_org_id)}` : 'جاهز للفرز',
            link: linkOf(r),
            project_id: r.project_id,
          },
          u.id,
        );
      },
      label_ev: 'استكملت الجهة الطالبة المطلوب',
    },
    'route-to-chair': {
      label: 'رفع للرئيس للتوجيه',
      kind: 'primary',
      from: ['SUBMITTED_TO_COMMITTEE'],
      to: 'PENDING_CHAIR_ROUTING',
      party: 'committee',
      auth: (u, r) => (committeeTriage(u, r) ? null : ['NO_PERMISSION', 'لأمانة اللجنة أو رئيسها']),
      validate: (u, r) => {
        if (!itemsComplete(r)) fail(422, 'INCOMPLETE_REQUEST', 'الطلب غير مكتمل — اطلب استكماله أولًا');
      },
      effect: (u, r, b) => {
        r.candidate_org_id = clean(b.candidate_org_id, 40) || r.candidate_org_id;
        E.notify(
          [E.project(r.project_id).committee.chair_id],
          {
            kind: 'request',
            title: `طلب ينتظر توجيهك: ${r.title}`,
            body: r.ref,
            link: linkOf(r),
            project_id: r.project_id,
          },
          u.id,
        );
      },
      label_ev: 'تحقّقت الأمانة من اكتمال الطلب ورفعته لرئيس اللجنة',
    },
    refer: {
      label: 'إحالة إلى الجهة المختصة',
      kind: 'primary',
      from: ['SUBMITTED_TO_COMMITTEE', 'PENDING_CHAIR_ROUTING'],
      to: 'REFERRED_TO_ORG',
      party: 'committee',
      needsTarget: true,
      auth: (u, r) => {
        if (!committeeTriage(u, r)) return ['NO_PERMISSION', 'للجنة المشروع'];
        return E.findDelegation(u, 'route', r.project_id)
          ? null
          : ['NO_DELEGATION', 'الإحالة الرسمية تحتاج تفويض «إحالة الطلبات» — أمين اللجنة يرفع الطلب للرئيس'];
      },
      validate: (u, r, b) => {
        const p = E.project(r.project_id);
        const o = clean(b.target_org_id, 40);
        if (!o || !p.org_ids.includes(o) || o === r.requester_org_id)
          fail(422, 'BAD_TARGET', 'اختر جهة مشاركة في المشروع غير الجهة الطالبة');
        if (!clean(b.reason, 800)) fail(422, 'MISSING_REASON', 'اكتب مبرر الإحالة (للدراسة والإفادة في حدود الاختصاص)');
        if (!itemsComplete(r)) fail(422, 'INCOMPLETE_REQUEST', 'الطلب غير مكتمل');
        reReferralGuard(r, b, o);
      },
      effect: (u, r, b) => {
        const dlg = E.findDelegation(u, 'route', r.project_id);
        const target = clean(b.target_org_id, 40);
        const prev = curReferral(r);
        const ref = {
          id: E.id('ref'),
          target_org_id: target,
          by: u.id,
          delegation_id: dlg.id,
          reason: clean(b.reason, 800),
          review_note: clean(b.review_note, 1000) || null,
          at: E.iso(),
          ack_at: null,
          superseded_by: null,
          response_due_at: null,
        };
        if (prev) prev.superseded_by = ref.id;
        ref.response_due_at = new Date(E.now() + slaHours(r, target) * 3600000).toISOString();
        r.referrals.push(ref);
        r.target_org_id = target;
        r.response_due_at = ref.response_due_at;
        r.sla_escalated = 0;
        delete r.reroute_hint;
        addToThread(r, [
          ...authorityOf(target),
          ...E.orgUsers(target)
            .filter((x) => E.hasRole(x, 'ORG_SUPERVISOR', 'ORG_ADMIN'))
            .map((x) => x.id),
        ]);
        E.notify(
          [
            ...authorityOf(target),
            ...E.orgUsers(target)
              .filter((x) => E.hasRole(x, 'ORG_ADMIN'))
              .map((x) => x.id),
          ],
          {
            kind: 'request',
            title: `طلب محال إلى جهتكم: ${r.title}`,
            body: `${r.ref} — إحالة تنسيقية من لجنة المشروع (ليست أمرًا بالتنفيذ). الرد المطلوب قبل ${ref.response_due_at.slice(0, 10)}`,
            link: linkOf(r),
            project_id: r.project_id,
          },
          u.id,
        );
        E.notify(
          [r.created_by, ...authorityOf(r.requester_org_id)],
          {
            kind: 'request',
            title: `أُحيل طلبكم ${r.ref}`,
            body: `إلى ${E.oname(target)}`,
            link: linkOf(r),
            project_id: r.project_id,
          },
          u.id,
        );
        E.recordDecision?.(E.project(r.project_id), {
          kind: 'referral',
          title: `إحالة تنسيقية: ${r.ref} إلى ${E.oname(target)}`,
          body: clean(b.reason, 800) || 'للدراسة والإفادة في حدود الاختصاص.',
          basis: `تفويض الإحالة: ${dlg.basis}`,
          request_id: r.id,
          by: u.id,
        });
      },
      detail: (r, b) => `إلى ${E.oname(clean(b.target_org_id, 40))}`,
      reasonFrom: (b) => clean(b.reason, 800),
      label_ev: 'إحالة تنسيقية إلى الجهة المختصة (لا تُلزمها بالتنفيذ)',
    },
    reroute: {
      label: 'إعادة التوجيه إلى جهة',
      kind: 'primary',
      from: ['DECLINED_WITH_REASON', 'COUNTERPROPOSAL'],
      to: 'REFERRED_TO_ORG',
      party: 'committee',
      needsTarget: true,
      auth: (u, r) => {
        if (!committeeTriage(u, r)) return ['NO_PERMISSION', 'للجنة المشروع'];
        return E.findDelegation(u, 'route', r.project_id)
          ? null
          : ['NO_DELEGATION', 'إعادة التوجيه تحتاج تفويض الإحالة'];
      },
      validate: (u, r, b) => {
        const p = E.project(r.project_id);
        const o = clean(b.target_org_id, 40);
        if (!o || !p.org_ids.includes(o) || o === r.requester_org_id)
          fail(422, 'BAD_TARGET', 'اختر جهة مشاركة غير الجهة الطالبة');
        if (!clean(b.reason, 800)) fail(422, 'MISSING_REASON', 'اكتب مبرر إعادة التوجيه');
        reReferralGuard(r, b, o);
      },
      effect: (u, r, b) => ACTIONS.refer.effect(u, r, b),
      detail: (r, b) => `إلى ${E.oname(clean(b.target_org_id, 40))}`,
      reasonFrom: (b) => clean(b.reason, 800),
      label_ev: 'أعادت اللجنة توجيه الطلب (قرار الجهة السابقة محفوظ)',
    },
    acknowledge: {
      label: 'تأكيد الاستلام وبدء الدراسة',
      kind: 'primary',
      from: ['REFERRED_TO_ORG', 'REOPEN_REQUESTED'],
      to: 'UNDER_ORG_REVIEW',
      party: 'target',
      auth: (u, r) =>
        u.org_id !== r.target_org_id
          ? ['WRONG_ORGANIZATION', 'استلام الطلب من الجهة المحال إليها فقط']
          : isTargetMember(u, r)
            ? null
            : ['NO_PERMISSION', 'لمشرف الجهة أو مفوّضها'],
      effect: (u, r) => {
        const cur = curReferral(r);
        if (cur) {
          cur.ack_at = E.iso();
          cur.ack_by = u.id;
        }
        r.acknowledged_at = E.iso();
        E.notify(
          [...committeeIds(r), r.created_by],
          {
            kind: 'request',
            title: `استلمت ${E.oname(r.target_org_id)} الطلب ${r.ref}`,
            link: linkOf(r),
            project_id: r.project_id,
          },
          u.id,
        );
      },
      label_ev: 'استلمت الجهة الطلب وبدأت دراسته',
    },
    decide: {
      label: 'قرار الجهة',
      kind: 'primary',
      from: ['UNDER_ORG_REVIEW'],
      to: null,
      party: 'target',
      special: 'decide',
    },
    'respond-counter': {
      label: 'ردّ على المقترح البديل',
      kind: 'primary',
      from: ['COUNTERPROPOSAL'],
      to: null,
      party: 'requester',
      special: 'respond-counter',
      auth: (u, r) =>
        requesterAuthority(u, r)
          ? null
          : u.org_id === r.requester_org_id
            ? ['NO_DELEGATION', 'الرد على المقترح باسم الجهة لمفوّضها']
            : ['WRONG_ORGANIZATION', 'للجهة الطالبة'],
    },
    reconsider: {
      label: 'طلب إعادة نظر',
      kind: 'secondary',
      from: ['DECLINED_WITH_REASON'],
      to: 'REOPEN_REQUESTED',
      party: 'requester|committee',
      auth: (u, r) =>
        requesterAuthority(u, r) || committeeTriage(u, r) ? null : ['NO_PERMISSION', 'لمفوّض الجهة الطالبة أو اللجنة'],
      validate: (u, r, b) => {
        if (!clean(b.reason, 800)) fail(422, 'MISSING_REASON', 'اكتب سبب طلب إعادة النظر وما استجد');
      },
      effect: (u, r, b) => {
        E.notify(
          [...authorityOf(r.target_org_id)],
          {
            kind: 'request',
            title: `طلب إعادة نظر في ${r.ref}`,
            body: clean(b.reason, 120),
            link: linkOf(r),
            project_id: r.project_id,
          },
          u.id,
        );
      },
      reasonFrom: (b) => clean(b.reason, 800),
      label_ev: 'طُلب من الجهة إعادة النظر (لا يلغي قرارها السابق)',
    },
    'close-declined': {
      label: 'إغلاق بعد الاعتذار',
      kind: 'secondary',
      from: ['DECLINED_WITH_REASON'],
      to: 'CLOSED_DECLINED',
      party: 'requester|committee',
      auth: (u, r) =>
        requesterAuthority(u, r) || (committeeTriage(u, r) && E.findDelegation(u, 'close_request', r.project_id))
          ? null
          : ['NO_DELEGATION', 'لمفوّض الجهة الطالبة أو من يملك تفويض الإغلاق'],
      effect: (u, r) => {
        E.notify(
          [...committeeIds(r), r.created_by],
          { kind: 'request', title: `أُغلق الطلب ${r.ref} بعد الاعتذار`, link: linkOf(r), project_id: r.project_id },
          u.id,
        );
      },
      label_ev: 'أُغلق الطلب بعد اعتذار الجهة (السجل محفوظ)',
    },
    withdraw: {
      label: 'سحب الطلب',
      kind: 'danger',
      from: [
        'SUBMITTED_TO_COMMITTEE',
        'NEEDS_INFORMATION',
        'PENDING_CHAIR_ROUTING',
        'COUNTERPROPOSAL',
        'DECLINED_WITH_REASON',
        'RETURNED_TO_REQUESTER',
      ],
      to: 'WITHDRAWN',
      party: 'requester',
      needsReason: true,
      auth: (u, r) => (requesterAuthority(u, r) ? null : ['NO_DELEGATION', 'سحب الطلب لمفوّض الجهة الطالبة']),
      validate: (u, r, b) => {
        if (!clean(b.reason, 800)) fail(422, 'MISSING_REASON', 'اكتب سبب السحب');
      },
      effect: (u, r) => {
        E.notify(
          [...committeeIds(r), ...(r.target_org_id ? authorityOf(r.target_org_id) : [])],
          { kind: 'request', title: `سُحب الطلب ${r.ref}`, link: linkOf(r), project_id: r.project_id },
          u.id,
        );
      },
      reasonFrom: (b) => clean(b.reason, 800),
      label_ev: 'سحبت الجهة الطالبة الطلب',
    },
    cancel: {
      label: 'إلغاء المسودة',
      kind: 'danger',
      from: ['DRAFT'],
      to: 'CANCELLED',
      party: 'requester',
      auth: (u, r) =>
        u.id === r.created_by || requesterAuthority(u, r) ? null : ['NO_PERMISSION', 'لكاتب المسودة أو مفوّض الجهة'],
      label_ev: 'أُلغيت المسودة',
    },
    split: {
      label: 'تفكيك إلى طلبات مستقلة',
      kind: 'secondary',
      from: ['SUBMITTED_TO_COMMITTEE', 'PENDING_CHAIR_ROUTING', 'COUNTERPROPOSAL'],
      to: 'SPLIT',
      party: 'committee',
      special: 'split',
      auth: (u, r) => (committeeTriage(u, r) ? null : ['NO_PERMISSION', 'لأمانة اللجنة أو رئيسها']),
    },
    'start-execution': {
      label: 'بدء التنفيذ',
      kind: 'primary',
      from: ['ACCEPTED_BY_ORG', 'READY_FOR_RELEASE'],
      to: 'IN_EXECUTION',
      party: 'target',
      auth: (u, r) =>
        u.org_id !== r.target_org_id
          ? ['WRONG_ORGANIZATION', 'للجهة الملتزمة']
          : E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || authorityOf(u.org_id).includes(u.id)
            ? null
            : ['NO_PERMISSION', 'لمشرف الجهة أو مفوّضها'],
      validate: (u, r) => {
        const w = r.wp_id ? E.wp(r.wp_id) : null;
        if (w && w.status !== 'RELEASED' && w.status !== 'IN_EXECUTION')
          fail(409, 'NOT_READY_FOR_RELEASE', `حزمة العمل المرتبطة (${w.ref}) لم يصدر لها تصريح بدء بعد`, {
            project_id: r.project_id,
          });
      },
      effect: (u, r) => {
        const c = S.commitments.find((x) => x.request_id === r.id && x.status === 'ACTIVE');
        if (c) c.started_at = E.iso();
        E.notify(
          [...committeeIds(r), r.created_by],
          { kind: 'request', title: `بدأ تنفيذ الطلب ${r.ref}`, link: linkOf(r), project_id: r.project_id },
          u.id,
        );
      },
      label_ev: 'بدأت الجهة التنفيذ',
    },
    block: {
      label: 'الإبلاغ عن عائق',
      kind: 'secondary',
      from: ['IN_EXECUTION'],
      to: 'BLOCKED',
      party: 'target',
      needsReason: true,
      auth: (u, r) =>
        u.org_id === r.target_org_id &&
        (E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || authorityOf(u.org_id).includes(u.id))
          ? null
          : ['WRONG_ORGANIZATION', 'لمشرف الجهة الملتزمة'],
      validate: (u, r, b) => {
        if (!clean(b.reason, 800)) fail(422, 'MISSING_REASON', 'اكتب سبب التوقف والجهة المطلوب منها الحل');
      },
      effect: (u, r) => {
        E.notify(
          [...committeeIds(r), r.created_by],
          { kind: 'request', title: `تعثّر تنفيذ الطلب ${r.ref}`, link: linkOf(r), project_id: r.project_id },
          u.id,
        );
      },
      reasonFrom: (b) => clean(b.reason, 800),
      label_ev: 'أبلغت الجهة عن عائق',
    },
    unblock: {
      label: 'استئناف التنفيذ',
      kind: 'primary',
      from: ['BLOCKED'],
      to: 'IN_EXECUTION',
      party: 'target',
      auth: (u, r) =>
        u.org_id === r.target_org_id &&
        (E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || authorityOf(u.org_id).includes(u.id))
          ? null
          : ['WRONG_ORGANIZATION', 'لمشرف الجهة الملتزمة'],
      label_ev: 'زال العائق واستؤنف التنفيذ',
    },
    'return-to-requester': {
      label: 'إعادة للجهة الطالبة',
      kind: 'secondary',
      from: ['PENDING_CHAIR_ROUTING'],
      to: 'RETURNED_TO_REQUESTER',
      party: 'committee',
      needsReason: true,
      auth: (u, r) => (committeeChair(u, r) ? null : ['NO_PERMISSION', 'لرئيس اللجنة']),
      validate: (u, r, b) => {
        REASON_REQ(b, 'سبب الإعادة');
      },
      effect: (u, r, b) => {
        const t = clean(b.reason, 1500);
        r.info_request = { by: 'committee', by_org: null, items: [t], at: E.iso() };
        E.notify(
          [r.created_by, ...authorityOf(r.requester_org_id)],
          {
            kind: 'request',
            title: `أعاد رئيس اللجنة الطلب ${r.ref}`,
            body: t.slice(0, 110),
            link: linkOf(r),
            project_id: r.project_id,
          },
          u.id,
        );
      },
      reasonFrom: (b) => clean(b.reason, 1500),
      label_ev: 'أعاد رئيس اللجنة الطلب للجهة الطالبة قبل التوجيه',
    },
    'await-release': {
      label: 'بانتظار تصريح البدء',
      kind: 'secondary',
      from: ['ACCEPTED_BY_ORG'],
      to: 'READY_FOR_RELEASE',
      party: 'target',
      auth: (u, r) =>
        u.org_id === r.target_org_id &&
        (E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || authorityOf(u.org_id).includes(u.id))
          ? null
          : ['WRONG_ORGANIZATION', 'لمشرف الجهة الملتزمة أو مفوّضها'],
      validate: (u, r) => {
        const w = r.wp_id ? E.wp(r.wp_id) : null;
        if (!w) fail(422, 'NO_WORK_PACKAGE', 'الطلب غير مرتبط بحزمة عمل خاضعة لتصريح بدء — ابدأ التنفيذ مباشرة');
        if (['RELEASED', 'IN_EXECUTION'].includes(w.status))
          fail(409, 'INVALID_TRANSITION', 'صدر تصريح بدء الحزمة بالفعل — ابدأ التنفيذ');
      },
      effect: (u, r) => {
        const w = E.wp(r.wp_id);
        const p = E.project(r.project_id);
        const ids = S.delegations
          .filter((d) => d.action === 'release' && !d.revoked && d.org_id === p.lead_org_id)
          .map((d) => d.user_id);
        E.notify(
          ids,
          {
            kind: 'release',
            title: `طلب ${r.ref} ينتظر تصريح بدء ${w.ref}`,
            link: `#/p/${p.id}/board?wp=${w.id}`,
            project_id: p.id,
          },
          u.id,
        );
      },
      label_ev: 'التزام الجهة جاهز وينتظر تصريح بدء حزمة العمل',
    },
    escalate: {
      label: 'تصعيد',
      kind: 'danger',
      from: ['BLOCKED'],
      to: 'ESCALATED',
      party: 'target|committee',
      needsReason: true,
      auth: (u, r) =>
        (u.org_id === r.target_org_id &&
          (E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || authorityOf(u.org_id).includes(u.id))) ||
        committeeTriage(u, r)
          ? null
          : ['NO_PERMISSION', 'لمشرف الجهة الملتزمة أو أمانة اللجنة ورئيسها'],
      validate: (u, r, b) => {
        REASON_REQ(b, 'سبب التصعيد');
      },
      effect: (u, r, b) => {
        E.notify(
          [...committeeIds(r), ...orgLeaders(r.target_org_id), r.created_by],
          {
            kind: 'escalation',
            title: `تصعيد: ${r.ref} متوقف بعائق`,
            body: clean(b.reason, 110),
            link: linkOf(r),
            project_id: r.project_id,
          },
          u.id,
        );
      },
      reasonFrom: (b) => clean(b.reason, 1500),
      label_ev: 'صُعِّد الطلب المتوقف إلى اللجنة (لا يغيّر التزام الجهة)',
    },
    'resolve-escalation': {
      label: 'إنهاء التصعيد واستئناف التنفيذ',
      kind: 'primary',
      from: ['ESCALATED'],
      to: 'IN_EXECUTION',
      party: 'committee',
      needsReason: true,
      auth: (u, r) => (committeeChair(u, r) ? null : ['NO_PERMISSION', 'لرئيس اللجنة']),
      validate: (u, r, b) => {
        REASON_REQ(b, 'ما تمّ لمعالجة العائق');
      },
      effect: (u, r, b) => {
        E.notify(
          [...orgLeaders(r.target_org_id), r.created_by],
          {
            kind: 'request',
            title: `عولج التصعيد في ${r.ref}`,
            body: clean(b.reason, 110),
            link: linkOf(r),
            project_id: r.project_id,
          },
          u.id,
        );
      },
      reasonFrom: (b) => clean(b.reason, 1500),
      label_ev: 'أنهى رئيس اللجنة التصعيد واستؤنف التنفيذ',
    },
    'request-change': {
      label: 'طلب تغيير على الخطة',
      kind: 'secondary',
      from: ['IN_EXECUTION', 'BLOCKED', 'ESCALATED'],
      to: 'CHANGE_REQUESTED',
      party: 'target',
      auth: (u, r) =>
        u.org_id === r.target_org_id &&
        (E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || authorityOf(u.org_id).includes(u.id))
          ? null
          : ['WRONG_ORGANIZATION', 'لمشرف الجهة الملتزمة أو مفوّضها'],
      validate: (u, r, b) => {
        const cr = S.changeRequests.find((c) => c.id === clean(b.change_request_id, 40));
        if (!cr || cr.project_id !== r.project_id)
          fail(422, 'BAD_CHANGE_REQUEST', 'اربط الطلب بطلب تغيير قائم على الخطة (أنشئه من الجدول الزمني أولًا)');
        if (cr.status !== 'PENDING') fail(409, 'INVALID_TRANSITION', 'طلب التغيير ليس بانتظار القرار');
      },
      effect: (u, r, b) => {
        r.change_request_id = clean(b.change_request_id, 40);
      },
      detail: (r, b) =>
        `طلب التغيير ${S.changeRequests.find((c) => c.id === clean(b.change_request_id, 40))?.ref || ''}`,
      label_ev: 'أوقفت الجهة المتابعة بانتظار قرار طلب تغيير',
    },
    'resume-after-change': {
      label: 'استئناف التنفيذ بعد قرار التغيير',
      kind: 'primary',
      from: ['CHANGE_REQUESTED'],
      to: 'IN_EXECUTION',
      party: 'target',
      auth: (u, r) =>
        u.org_id === r.target_org_id &&
        (E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || authorityOf(u.org_id).includes(u.id))
          ? null
          : ['WRONG_ORGANIZATION', 'لمشرف الجهة الملتزمة أو مفوّضها'],
      validate: (u, r) => {
        const cr = S.changeRequests.find((c) => c.id === r.change_request_id);
        if (cr && cr.status === 'PENDING') fail(409, 'CHANGE_PENDING', 'طلب التغيير لم يُحسم بعد');
      },
      effect: (u, r) => {
        delete r.change_request_id;
      },
      label_ev: 'حُسم طلب التغيير واستؤنف التنفيذ',
    },
    'submit-deliverable': {
      label: 'تسليم المخرج للمراجعة',
      kind: 'primary',
      from: ['IN_EXECUTION', 'RETURNED_FOR_CORRECTION'],
      to: 'ORG_SUBMITTED',
      party: 'target',
      auth: (u, r) =>
        u.org_id === r.target_org_id &&
        (E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || authorityOf(u.org_id).includes(u.id))
          ? null
          : ['WRONG_ORGANIZATION', 'لمشرف الجهة الملتزمة أو مفوّضها'],
      validate: (u, r, b) => {
        const shared = r.evidence.filter((e) => e.shared && !e.superseded);
        if (!shared.length)
          fail(422, 'EVIDENCE_REQUIRED', 'أرفق دليلًا مشتركًا واحدًا على الأقل قبل التسليم', {
            project_id: r.project_id,
          });
      },
      effect: (u, r) => {
        r.submitted_by = u.id;
        E.notify(
          [r.created_by, ...authorityOf(r.requester_org_id)],
          {
            kind: 'review',
            title: `مخرج بانتظار مراجعتكم: ${r.title}`,
            body: r.ref,
            link: linkOf(r),
            project_id: r.project_id,
          },
          u.id,
        );
      },
      label_ev: 'سلّمت الجهة المخرج مع الأدلة',
    },
    'review-deliverable': {
      label: 'مراجعة المخرج',
      kind: 'primary',
      from: ['ORG_SUBMITTED'],
      to: null,
      party: 'requester',
      special: 'review',
    },
    close: {
      label: 'إغلاق الطلب إداريًا',
      kind: 'primary',
      from: ['ACCEPTED_DELIVERABLE'],
      to: 'CLOSED_COMPLETED',
      party: 'committee',
      auth: (u, r) =>
        committeeTriage(u, r) && E.findDelegation(u, 'close_request', r.project_id)
          ? null
          : committeeTriage(u, r)
            ? ['NO_DELEGATION', 'الإغلاق يحتاج تفويض «إغلاق الطلبات»']
            : ['NO_PERMISSION', 'لأمانة اللجنة أو رئيسها'],
      effect: (u, r) => {
        for (const c of S.commitments.filter((x) => x.request_id === r.id)) {
          c.status = 'CLOSED';
          c.closed_at = E.iso();
        }
        E.notify(
          [r.created_by, ...authorityOf(r.target_org_id), ...authorityOf(r.requester_org_id)],
          { kind: 'request', title: `أُغلق الطلب ${r.ref} بالإنجاز`, link: linkOf(r), project_id: r.project_id },
          u.id,
        );
      },
      label_ev: 'أُغلق الطلب إداريًا بعد قبول المخرج (الإغلاق لا يُعد إذنًا بالصرف أو توقيع عقد)',
    },
  };

  // ---------------------------------------------------------------- core runner
  const transition = (ctx, r, key, extra = {}) => {
    const u = ctx.user;
    const b = ctx.body;
    const a = ACTIONS[key];
    if (!a) fail(404, 'NOT_FOUND', 'إجراء غير معروف');
    if (b.request_version != null && Number(b.request_version) !== r.version)
      fail(409, 'STALE_VERSION', 'تغيّر الطلب منذ فتحته (قرار آخر سبقك) — حدّث الصفحة وراجع الحالة الجديدة', {
        current_version: r.version,
        status: r.status,
        project_id: r.project_id,
      });
    if (!a.from.includes(r.status))
      fail(409, 'INVALID_TRANSITION', `هذا الإجراء غير متاح والطلب «${M.REQUEST_STATUS[r.status].ar}»`, {
        status: r.status,
      });
    if (a.special === 'decide') return decide(ctx, r);
    if (a.special === 'respond-counter') return respondCounter(ctx, r);
    if (a.special === 'split') return split(ctx, r);
    if (a.special === 'review') return reviewDeliverable(ctx, r);
    const bad = a.auth?.(u, r);
    if (bad) fail(403, bad[0], bad[1], { project_id: r.project_id });
    a.validate?.(u, r, b);
    const from = r.status;
    const to = a.to;
    if (from === 'SUBMITTED_TO_COMMITTEE' && key === 'refer')
      addEvent(r, u, 'route-to-chair', 'فرز مباشر من رئيس اللجنة', { from, to: 'PENDING_CHAIR_ROUTING' });
    const dlgAction = {
      submit: 'submit_request',
      refer: 'route',
      reroute: 'route',
      'route-to-chair': 'route',
      'close-declined': 'close_request',
      close: 'close_request',
    }[key];
    const usedDlg = dlgAction ? E.findDelegation(u, dlgAction, r.project_id) : null; // recorded in the audit record so every delegated act cites its basis
    a.effect?.(u, r, b);
    r.status = to;
    r.version++;
    r.updated_at = E.iso();
    if (to === 'DRAFT') delete r.info_request;
    addEvent(r, u, key, a.label_ev || a.label, {
      from,
      to,
      reason: a.reasonFrom ? a.reasonFrom(b) : '',
      detail: a.detail ? a.detail(r, b) : '',
      ...extra,
    });
    E.audit({
      actor_id: u.id,
      action: `request.${key}`,
      object_type: 'request',
      object_id: r.id,
      project_id: r.project_id,
      from,
      to,
      reason: a.reasonFrom ? a.reasonFrom(b) : undefined,
      version: r.version,
      delegation_id: usedDlg?.id || ctx.dlg?.id,
    });
    return reqView(u, r, true);
  };

  const decide = (ctx, r) => {
    const u = ctx.user;
    const b = ctx.body;
    const d = clean(b.decision, 20).toUpperCase();
    if (u.org_id !== r.target_org_id)
      fail(
        403,
        'WRONG_ORGANIZATION',
        'القرار يصدر من الجهة المحال إليها الطلب فقط — لا يملك الرئيس ولا الجهة الطالبة قبول الطلب نيابة عنها',
        { project_id: r.project_id },
      );
    const dlg = E.findDelegation(u, 'commit', r.project_id);
    if (!dlg)
      fail(
        403,
        'NO_DELEGATION',
        'الرد الرسمي باسم الجهة يحتاج تفويضًا ساريًا لقبول أو رفض الالتزامات. يمكنك إعداد مسودة توصية للمفوّض.',
        { project_id: r.project_id },
      );
    if (!['ACCEPT', 'DECLINE', 'COUNTER', 'NEED_INFO'].includes(d))
      fail(422, 'BAD_DECISION', 'اختر قبول الطلب أو الاعتذار أو اقتراح بديل أو طلب استكمال');
    if (b.request_version == null) fail(422, 'MISSING_VERSION', 'رقم نسخة الطلب مطلوب لمنع القرارات المتعارضة');
    const from = r.status;
    const rec = {
      id: E.id('dec'),
      type: d,
      by: u.id,
      org_id: u.org_id,
      delegation_id: dlg.id,
      referral_id: curReferral(r)?.id,
      request_version: r.version,
      at: E.iso(),
    };
    let to;
    let label;
    let reason = '';
    if (d === 'ACCEPT') {
      const scope = clean(b.scope_text, 2000);
      if (!scope) fail(422, 'MISSING_SCOPE', 'اكتب نطاق ما ستنفّذه الجهة وشروطه');
      const types = uniq(r.items.map((i) => i.service_type));
      if (!E.findDelegation(u, 'commit', r.project_id, types))
        fail(403, 'NO_DELEGATION', 'تفويضك لا يشمل نوع الخدمة المطلوب. اعتذر عن الطلب أو اقترح تفكيكه (مقترح بديل).', {
          project_id: r.project_id,
          uncovered: types
            .filter((t) => !E.findDelegation(u, 'commit', r.project_id, [t]))
            .map((t) => M.SERVICE_TYPES[t]),
        });
      if (r.estimated_value > 0 && !E.findDelegation(u, 'commit', r.project_id, types, r.estimated_value))
        fail(
          403,
          'OVER_LIMIT',
          `القيمة التقديرية للطلب (${r.estimated_value.toLocaleString('en-US')} د.إ) تتجاوز الحد المالي لتفويضك. أحِل القرار إلى مفوّض بحد أعلى أو اعتذر/اقترح بديلًا.`,
          { project_id: r.project_id, estimated_value: r.estimated_value, limit: dlg.max_amount },
        );
      if (b.due_on && !isDay(b.due_on)) fail(422, 'BAD_DATES', 'تاريخ غير صحيح');
      const c = {
        id: E.id('cmt'),
        request_id: r.id,
        project_id: r.project_id,
        org_id: u.org_id,
        accept_decision_id: rec.id,
        scope_text: scope,
        conditions: clean(b.conditions, 1000),
        due_on: isDay(b.due_on) ? b.due_on : r.required_by,
        status: 'ACTIVE',
        accepted_by: u.id,
        accepted_at: E.iso(),
        basis: dlg.basis,
        contact_user_id:
          b.contact_user_id && E.user(clean(b.contact_user_id, 40))?.org_id === u.org_id
            ? clean(b.contact_user_id, 40)
            : u.id,
        shared_updates: [],
      };
      S.commitments.push(c);
      rec.commitment_id = c.id;
      rec.scope_text = scope;
      to = 'ACCEPTED_BY_ORG';
      label = 'قبلت الجهة الطلب وتحوّل إلى التزام مؤسسي';
      reason = scope;
      E.notify(
        [r.created_by, ...authorityOf(r.requester_org_id), ...committeeIds(r)],
        {
          kind: 'request',
          title: `قبلت ${E.oname(u.org_id)} الطلب ${r.ref}`,
          body: scope.slice(0, 110),
          link: linkOf(r),
          project_id: r.project_id,
        },
        u.id,
      );
      E.notify(
        orgLeaders(u.org_id),
        {
          kind: 'task',
          title: `التزام جديد يحتاج توزيعًا على فريقكم: ${r.title}`,
          body: r.ref,
          link: '#/commitments',
          project_id: r.project_id,
        },
        u.id,
      );
    } else if (d === 'DECLINE') {
      const code = clean(b.reason_code, 40);
      const text = clean(b.reason_text, 1500);
      if (!M.REASON_CODES[code])
        fail(422, 'MISSING_REJECTION_REASON', 'اختر تصنيف سبب الاعتذار', { project_id: r.project_id });
      if (!text || text.length < 5)
        fail(422, 'MISSING_REJECTION_REASON', 'اكتب سببًا واضحًا للاعتذار — لا يُقبل اعتذار بلا شرح', {
          project_id: r.project_id,
        });
      rec.reason_code = code;
      rec.reason_text = text;
      rec.reference_document = clean(b.reference_document, 200);
      to = 'DECLINED_WITH_REASON';
      label = `اعتذرت الجهة: ${M.REASON_CODES[code]}`;
      reason = text;
      E.notify(
        [r.created_by, ...authorityOf(r.requester_org_id), ...committeeIds(r)],
        {
          kind: 'request',
          title: `اعتذرت ${E.oname(u.org_id)} عن الطلب ${r.ref}`,
          body: `${M.REASON_CODES[code]} — ${text.slice(0, 90)}`,
          link: linkOf(r),
          project_id: r.project_id,
        },
        u.id,
      );
    } else if (d === 'COUNTER') {
      const scope = clean(b.new_scope, 2000);
      const text = clean(b.reason_text || b.reason, 1500);
      if (!scope) fail(422, 'MISSING_SCOPE', 'اكتب المقترح البديل (النطاق أو التفكيك)');
      if (!text) fail(422, 'MISSING_REASON', 'اكتب سبب المقترح البديل');
      rec.new_scope = scope;
      rec.reason_text = text;
      to = 'COUNTERPROPOSAL';
      label = 'قدّمت الجهة مقترحًا بديلًا';
      reason = `${scope} — ${text}`;
      E.notify(
        [r.created_by, ...authorityOf(r.requester_org_id), ...committeeIds(r)],
        {
          kind: 'request',
          title: `مقترح بديل من ${E.oname(u.org_id)} على ${r.ref}`,
          body: scope.slice(0, 110),
          link: linkOf(r),
          project_id: r.project_id,
        },
        u.id,
      );
    } else {
      const items = Array.isArray(b.missing_items) ? b.missing_items.map((x) => clean(x, 200)).filter(Boolean) : [];
      const txt = clean(b.missing_text, 800);
      if (!items.length && !txt) fail(422, 'MISSING_ITEMS', 'اذكر المستندات أو المعلومات الناقصة تحديدًا');
      r.info_request = { by: 'org', by_org: u.org_id, items: items.length ? items : [txt], at: E.iso() };
      rec.missing = r.info_request.items;
      to = 'NEEDS_INFORMATION';
      label = 'طلبت الجهة استكمال معلومات';
      reason = r.info_request.items.join('، ');
      E.notify(
        [r.created_by, ...authorityOf(r.requester_org_id), ...committeeIds(r)],
        {
          kind: 'request',
          title: `${E.oname(u.org_id)} تطلب استكمال ${r.ref}`,
          body: reason.slice(0, 110),
          link: linkOf(r),
          project_id: r.project_id,
        },
        u.id,
      );
    }
    r.decisions.push(rec);
    r.status = to;
    r.version++;
    r.updated_at = E.iso();
    addEvent(r, u, `decide:${d}`, label, { from, to, reason, detail: `بتفويض: ${dlg.basis}` });
    E.audit({
      actor_id: u.id,
      action: `request.decide.${d.toLowerCase()}`,
      object_type: 'request',
      object_id: r.id,
      project_id: r.project_id,
      from,
      to,
      reason,
      delegation_id: dlg.id,
      version: r.version,
    });
    return reqView(u, r, true);
  };

  const respondCounter = (ctx, r) => {
    const u = ctx.user;
    const b = ctx.body;
    const a = ACTIONS['respond-counter'];
    const bad = a.auth(u, r);
    if (bad) fail(403, bad[0], bad[1], { project_id: r.project_id });
    const note = clean(b.note, 800);
    if (b.agree === true) {
      const last = [...r.decisions].reverse().find((x) => x.type === 'COUNTER');
      r.agreed_scope = last?.new_scope;
      r.status = 'UNDER_ORG_REVIEW';
      r.version++;
      addEvent(
        r,
        u,
        'counter:agree',
        'وافقت الجهة الطالبة على النطاق المقترح — بانتظار القرار الرسمي النهائي من الجهة',
        { from: 'COUNTERPROPOSAL', to: 'UNDER_ORG_REVIEW', reason: note },
      );
      E.audit({
        actor_id: u.id,
        action: 'request.counter.agree',
        object_type: 'request',
        object_id: r.id,
        project_id: r.project_id,
        from: 'COUNTERPROPOSAL',
        to: 'UNDER_ORG_REVIEW',
        reason: note,
        version: r.version,
      });
      E.notify(
        authorityOf(r.target_org_id),
        {
          kind: 'request',
          title: `وافق الطالب على مقترحكم في ${r.ref}`,
          body: 'أصدروا قراركم الرسمي',
          link: linkOf(r),
          project_id: r.project_id,
        },
        u.id,
      );
    } else {
      if (!note) fail(422, 'MISSING_REASON', 'اكتب سبب عدم الموافقة');
      r.version++;
      addEvent(r, u, 'counter:disagree', 'لم توافق الجهة الطالبة على المقترح — بانتظار توجيه اللجنة', { reason: note });
      E.audit({
        actor_id: u.id,
        action: 'request.counter.disagree',
        object_type: 'request',
        object_id: r.id,
        project_id: r.project_id,
        reason: note,
        version: r.version,
      });
      E.notify(
        committeeIds(r),
        {
          kind: 'request',
          title: `الطالب لم يوافق على المقترح البديل في ${r.ref}`,
          body: note.slice(0, 100),
          link: linkOf(r),
          project_id: r.project_id,
        },
        u.id,
      );
    }
    return reqView(u, r, true);
  };

  const split = (ctx, r) => {
    const u = ctx.user;
    const a = ACTIONS.split;
    const bad = a.auth(u, r);
    if (bad) fail(403, bad[0], bad[1], { project_id: r.project_id });
    if (r.items.length < 2) fail(422, 'NOT_COMPOSITE', 'الطلب يحتوي عنصرًا واحدًا فقط');
    const reason = clean(ctx.body.reason, 800) || 'تفكيك لاختلاف جهة القبول أو السند لكل عنصر';
    const kids = [];
    r.items.forEach((it, idx) => {
      const letter = String.fromCharCode(65 + idx);
      const k = newRequest({
        project_id: r.project_id,
        requester_org_id: r.requester_org_id,
        created_by: r.created_by,
        title: `${r.title} — ${it.title}`,
        description: `${r.description}\n\nالعنصر: ${it.title}\n${it.spec || ''}`,
        required_by: r.required_by,
        impact_text: r.impact_text,
        items: [{ ...it, id: E.id('itm') }],
        parent_id: r.id,
        ref: `${r.ref}-${letter}`,
        wp_id: r.wp_id,
        depends_on: idx > 0 && ctx.body.sequential ? kids[idx - 1].id : null,
      });
      k.status = 'PENDING_CHAIR_ROUTING';
      k.submitted_at = r.submitted_at;
      k.version = 1;
      addEvent(k, u, 'split:child', `فُكّك من الطلب ${r.ref}`, { to: 'PENDING_CHAIR_ROUTING', reason });
      S.requests.push(k);
      kids.push(k);
      ensureThread(k);
    });
    const from = r.status;
    r.status = 'SPLIT';
    r.children = kids.map((k) => k.id);
    r.version++;
    addEvent(r, u, 'split', `فُكّك إلى ${kids.length} طلبات مستقلة لكل منها قبولها وجهتها`, {
      from,
      to: 'SPLIT',
      reason,
    });
    E.audit({
      actor_id: u.id,
      action: 'request.split',
      object_type: 'request',
      object_id: r.id,
      project_id: r.project_id,
      from,
      to: 'SPLIT',
      reason,
      version: r.version,
    });
    E.notify(
      [r.created_by, ...authorityOf(r.requester_org_id)],
      {
        kind: 'request',
        title: `فُكّك طلبكم ${r.ref}`,
        body: kids.map((k) => k.ref).join('، '),
        link: linkOf(r),
        project_id: r.project_id,
      },
      u.id,
    );
    return reqView(u, r, true);
  };

  const reviewDeliverable = (ctx, r) => {
    const u = ctx.user;
    const b = ctx.body;
    if (u.org_id !== r.requester_org_id)
      fail(403, 'WRONG_ORGANIZATION', 'مراجعة المخرج من الجهة الطالبة المستلمة', { project_id: r.project_id });
    const dlg = E.findDelegation(u, 'accept_deliverable', r.project_id);
    if (!dlg) fail(403, 'NO_DELEGATION', 'قبول المخرج يحتاج تفويض «قبول المخرجات»', { project_id: r.project_id });
    if (u.id === r.submitted_by)
      fail(403, 'CONFLICT_OF_INTEREST', 'لا يجوز لمن سلّم المخرج أن يقبله', { project_id: r.project_id });
    const note = clean(b.note, 800);
    if (b.decision === 'return') {
      if (!note) fail(422, 'MISSING_REASON', 'اكتب سبب الإعادة والمطلوب تصحيحه');
      const from = r.status;
      r.status = 'RETURNED_FOR_CORRECTION';
      r.version++;
      addEvent(r, u, 'review:return', 'أُعيد المخرج للتصحيح', { from, to: r.status, reason: note });
      E.audit({
        actor_id: u.id,
        action: 'request.review.return',
        object_type: 'request',
        object_id: r.id,
        project_id: r.project_id,
        from,
        to: r.status,
        reason: note,
        delegation_id: dlg.id,
        version: r.version,
      });
      E.notify(
        [...authorityOf(r.target_org_id), ...orgLeaders(r.target_org_id)],
        {
          kind: 'review',
          title: `أُعيد المخرج للتصحيح: ${r.ref}`,
          body: note,
          link: linkOf(r),
          project_id: r.project_id,
        },
        u.id,
      );
    } else if (b.decision === 'accept') {
      if (!r.evidence.some((e) => e.shared && !e.superseded))
        fail(422, 'EVIDENCE_REQUIRED', 'لا يُقبل مخرج بلا أدلة', { project_id: r.project_id });
      const from = r.status;
      r.status = 'ACCEPTED_DELIVERABLE';
      r.version++;
      addEvent(r, u, 'review:accept', 'قُبل المخرج من الجهة الطالبة', { from, to: r.status, reason: note });
      E.audit({
        actor_id: u.id,
        action: 'request.review.accept',
        object_type: 'request',
        object_id: r.id,
        project_id: r.project_id,
        from,
        to: r.status,
        reason: note,
        delegation_id: dlg.id,
        version: r.version,
      });
      E.notify(
        [...committeeIds(r), ...authorityOf(r.target_org_id)],
        {
          kind: 'review',
          title: `قُبل المخرج: ${r.ref}`,
          body: 'بانتظار الإغلاق الإداري من أمانة اللجنة',
          link: linkOf(r),
          project_id: r.project_id,
        },
        u.id,
      );
    } else fail(422, 'BAD_DECISION', 'اختر قبول المخرج أو إعادته');
    return reqView(u, r, true);
  };

  // ---------------------------------------------------------------- creation & views
  const money = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!(n >= 0) || !isFinite(n)) fail(422, 'BAD_AMOUNT', 'القيمة التقديرية رقم موجب');
    return Math.round(n);
  };
  const newRequest = (o) => {
    const p = E.project(o.project_id);
    return {
      id: E.id('req'),
      ref: o.ref || E.refNo('REQ', `MHW-${new Date(E.now()).getUTCFullYear()}`),
      project_id: o.project_id,
      requester_org_id: o.requester_org_id,
      created_by: o.created_by,
      title: o.title,
      description: o.description,
      required_by: o.required_by,
      impact_text: o.impact_text || '',
      estimated_value: o.estimated_value ?? null,
      baseline_version: p?.baseline_frozen ? p.baseline_version : null,
      items: o.items,
      attachments: o.attachments || [],
      wp_id: o.wp_id || null,
      parent_id: o.parent_id || null,
      depends_on: o.depends_on || null,
      status: 'DRAFT',
      version: 1,
      target_org_id: null,
      response_due_at: null,
      referrals: [],
      decisions: [],
      events: [],
      evidence: [],
      children: [],
      created_at: E.iso(),
      updated_at: E.iso(),
      project_name: p?.name,
    };
  };
  const parseItems = (raw) => {
    const arr = Array.isArray(raw) ? raw : [];
    return arr
      .slice(0, 8)
      .map((i) => ({
        id: E.id('itm'),
        title: clean(i.title, 160),
        spec: clean(i.spec, 1000),
        service_type: M.SERVICE_TYPES[i.service_type] ? i.service_type : 'other',
      }))
      .filter((i) => i.title);
  };

  const ownerFields = (u, r) => requesterMember(u, r);

  const reqCard = (r) => ({
    id: r.id,
    ref: r.ref,
    title: r.title,
    project_id: r.project_id,
    project_name: E.project(r.project_id)?.name,
    status: r.status,
    status_ar: M.REQUEST_STATUS[r.status].ar,
    tone: M.REQUEST_STATUS[r.status].tone,
    requester_org_id: r.requester_org_id,
    requester_org_name: E.oname(r.requester_org_id),
    target_org_id: r.target_org_id,
    target_org_name: r.target_org_id ? E.oname(r.target_org_id) : null,
    required_by: r.required_by,
    estimated_value: r.estimated_value ?? null,
    baseline_version: r.baseline_version ?? null,
    baseline_history: r.baseline_history || [],
    items: r.items.map((i) => ({
      id: i.id,
      title: i.title,
      service_type: i.service_type,
      service_label: M.SERVICE_TYPES[i.service_type],
    })),
    ball: ball(r),
    overdue: overdue(r),
    stage: M.STATUS_STAGE[r.status],
    updated_at: r.updated_at,
    submitted_at: r.submitted_at || null,
    parent_ref: r.parent_id ? E.req(r.parent_id)?.ref : null,
    response_due_at: r.response_due_at,
  });

  const availableActions = (u, r) => {
    const out = [];
    for (const [key, a] of Object.entries(ACTIONS)) {
      if (!a.from.includes(r.status)) continue;
      const parties = a.party.split('|');
      const isParty = parties.some(
        (pt) =>
          (pt === 'requester' && u.org_id === r.requester_org_id) ||
          (pt === 'committee' && !!E.committeeRole(u, E.project(r.project_id))) ||
          (pt === 'target' && u.org_id === r.target_org_id),
      );
      if (!isParty) continue;
      if (key === 'decide' || key === 'respond-counter' || key === 'split' || key === 'review-deliverable') {
        let reason = null;
        if (key === 'decide') {
          if (!E.findDelegation(u, 'commit', r.project_id))
            reason = 'الرد الرسمي لمفوّض الجهة (تفويض «قبول أو رفض الالتزامات»). يمكنك مراسلته في محادثة الطلب.';
          else if (!isTargetMember(u, r)) reason = 'للجهة المحال إليها';
        }
        if (key === 'respond-counter') reason = a.auth(u, r)?.[1] || null;
        if (key === 'split') {
          reason = a.auth(u, r)?.[1] || (r.items.length < 2 ? 'الطلب لا يحتوي أكثر من عنصر' : null);
          if (r.items.length < 2) continue;
        }
        if (key === 'review-deliverable') {
          if (!E.findDelegation(u, 'accept_deliverable', r.project_id))
            reason = 'قبول المخرج لمن يملك تفويض «قبول المخرجات»';
          else if (u.id === r.submitted_by) reason = 'لا يجوز لمن سلّم المخرج أن يقبله';
        }
        out.push({ key, label: a.label, kind: a.kind, enabled: !reason, reason });
        continue;
      }
      const bad = a.auth?.(u, r);
      if (bad && !['NO_DELEGATION'].includes(bad[0]) && !(a.party.includes('committee') && committeeTriage(u, r)))
        continue;
      out.push({ key, label: a.label, kind: a.kind, enabled: !bad, reason: bad ? bad[1] : null });
    }
    if (
      ['IN_EXECUTION', 'ACCEPTED_BY_ORG', 'BLOCKED', 'RETURNED_FOR_CORRECTION'].includes(r.status) &&
      u.org_id === r.target_org_id
    )
      out.push({
        key: 'add-evidence',
        label: 'إرفاق دليل',
        kind: 'secondary',
        enabled: E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || authorityOf(u.org_id).includes(u.id),
        reason: 'لمشرف الجهة',
      });
    if (
      !M.TERMINAL.includes(r.status) &&
      committeeTriage(u, r) &&
      ['REFERRED_TO_ORG', 'UNDER_ORG_REVIEW'].includes(r.status)
    )
      out.push({ key: 'remind', label: 'إرسال تذكير للجهة', kind: 'secondary', enabled: true });
    if (
      !M.TERMINAL.includes(r.status) &&
      committeeChair(u, r) &&
      !r.dispute &&
      ['DECLINED_WITH_REASON', 'COUNTERPROPOSAL'].includes(r.status)
    )
      out.push({ key: 'dispute', label: 'إحالة لمرجع مستقل', kind: 'secondary', enabled: true });
    if (r.dispute?.status === 'OPEN' && (r.dispute.reviewer_id === u.id || r.dispute.alt_reviewer_id === u.id))
      out.push({ key: 'opinion', label: 'تسجيل الرأي', kind: 'primary', enabled: true });
    return out;
  };

  E.requestEvidenceVisible = (u, r, e) => u.org_id === r.target_org_id || !!e.shared;
  const evidenceView = (u, r) =>
    r.evidence
      .filter((e) => u.org_id === r.target_org_id || e.shared || (E.hasRole(u, 'FINAL_AUDITOR') && e.shared))
      .map((e) => ({
        ...e,
        by_name: E.uname(e.by),
        visibility: e.shared ? 'مشترك مع الطالب واللجنة' : 'داخلي للجهة',
        can_download: !!e.file_id && E.canReadFile(u, E.file(e.file_id)),
        ...E.fileGrantInfo(u, e),
      }));

  const reqView = (u, r, detail = false) => {
    const card = reqCard(r);
    if (!detail) return { ...card, actions: availableActions(u, r) };
    const isTarget = u.org_id === r.target_org_id;
    const cm = S.commitments
      .filter((c) => c.request_id === r.id)
      .map((c) => ({
        id: c.id,
        org_name: E.oname(c.org_id),
        scope_text: c.scope_text,
        conditions: c.conditions,
        due_on: c.due_on,
        status: c.status,
        progress: E.commitmentProgress(c),
        accepted_by_name: E.uname(c.accepted_by),
        accepted_at: c.accepted_at,
        basis: c.basis,
        shared_updates: c.shared_updates.map((x) => ({ ...x, by_name: E.uname(x.by) })),
        mine: c.org_id === u.org_id,
      }));
    const myCm = cm.find((c) => c.mine && c.status === 'ACTIVE');
    return {
      ...card,
      description: r.description,
      impact_text: r.impact_text,
      version: r.version,
      attachments: r.attachments,
      wp: r.wp_id
        ? {
            id: r.wp_id,
            ref: E.wp(r.wp_id)?.ref,
            title: E.wp(r.wp_id)?.title,
            status_ar: M.WP_STATUS[E.wp(r.wp_id)?.status]?.ar,
          }
        : null,
      created_by_name: E.uname(r.created_by),
      created_at: r.created_at,
      info_request: r.info_request || null,
      info_response: r.info_response || null,
      reroute_hint: r.reroute_hint ? { org_id: r.reroute_hint, org_name: E.oname(r.reroute_hint) } : null,
      referrals: r.referrals.map((x) => ({
        id: x.id,
        target_org_name: E.oname(x.target_org_id),
        by_name: E.uname(x.by),
        reason: x.reason,
        at: x.at,
        ack_at: x.ack_at,
        superseded: !!x.superseded_by,
        response_due_at: x.response_due_at,
      })),
      decisions: r.decisions.map((d) => ({
        id: d.id,
        type: d.type,
        org_name: E.oname(d.org_id),
        by_name: E.uname(d.by),
        at: d.at,
        reason_code: d.reason_code,
        reason_label: d.reason_code ? M.REASON_CODES[d.reason_code] : null,
        reason_text: d.reason_text,
        scope_text: d.scope_text,
        new_scope: d.new_scope,
        missing: d.missing,
        request_version: d.request_version,
      })),
      events: r.events
        .filter((e) => eventVisible(u, e, r))
        .map((e) => ({
          id: e.id,
          at: e.at,
          actor_name: e.actor_name,
          actor_org: e.actor_org,
          action: e.action,
          label: e.label,
          from: e.from,
          to: e.to,
          reason: e.reason,
          detail: e.detail,
          vis: e.vis,
        })),
      commitments: cm,
      evidence: evidenceView(u, r),
      sla: {
        due: r.response_due_at,
        overdue: overdue(r),
        hours: r.target_org_id ? slaHours(r, r.target_org_id) : null,
      },
      thread_id: S.threads.find((t) => t.request_id === r.id && t.member_ids.includes(u.id))?.id || null,
      children: r.children
        .map((id) => E.req(id))
        .filter(Boolean)
        .map((k) => ({
          id: k.id,
          ref: k.ref,
          title: k.title,
          status: k.status,
          status_ar: M.REQUEST_STATUS[k.status].ar,
          target: k.target_org_id ? E.oname(k.target_org_id) : null,
          tone: M.REQUEST_STATUS[k.status].tone,
        })),
      parent: r.parent_id ? { id: r.parent_id, ref: E.req(r.parent_id)?.ref } : null,
      depends_on: r.depends_on ? { id: r.depends_on, ref: E.req(r.depends_on)?.ref } : null,
      dispute: r.dispute
        ? {
            ...r.dispute,
            reviewer_name: E.uname(r.dispute.reviewer_id),
            alt_name: E.uname(r.dispute.alt_reviewer_id),
            opened_by_name: E.uname(r.dispute.opened_by),
          }
        : null,
      actions: availableActions(u, r),
      editable: ['DRAFT', 'NEEDS_INFORMATION'].includes(r.status) && ownerFields(u, r),
      can_add_tasks: !!myCm && E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN'),
      my_commitment_id: myCm?.id || null,
      declined_org_ids: uniq(r.decisions.filter((d) => d.type === 'DECLINE').map((d) => d.org_id)),
      candidates: E.project(r.project_id)
        .org_ids.filter((o) => o !== r.requester_org_id)
        .map((o) => {
          const own = S.competencies.filter(
            (c) => compValid(c) && c.owner_org_id === o && r.items.some((i) => i.service_type === c.service_type),
          );
          const sub = S.competencies.filter(
            (c) => compValid(c) && c.substitute_org_id === o && r.items.some((i) => i.service_type === c.service_type),
          );
          return {
            id: o,
            name: E.oname(o),
            suggested: own.length > 0,
            substitute_for: sub.length ? uniq(sub.map((c) => E.oname(c.owner_org_id))) : [],
            authority: own[0]?.acceptance_authority || null,
            types: own.map((c) => M.SERVICE_TYPES[c.service_type]),
          };
        }),
      people: { org_people: isTarget ? E.orgUsers(u.org_id).map((x) => ({ id: x.id, name: x.name })) : [] },
      project_caps: { chair: committeeChair(u, r) },
    };
  };

  E.route('GET', '/interagency-requests', (ctx) => {
    const u = ctx.user;
    const { scope = 'all', project_id, status } = ctx.query;
    let list = S.requests.filter((r) => E.reqVisible(u, r) && (!project_id || r.project_id === project_id));
    // hide other orgs' drafts from committee/target
    list = list.filter(
      (r) => !(['DRAFT', 'PENDING_REQUESTER_APPROVAL'].includes(r.status) && u.org_id !== r.requester_org_id),
    );
    if (scope === 'incoming')
      list = list.filter(
        (r) => r.referrals.some((x) => x.target_org_id === u.org_id) && u.org_id !== r.requester_org_id,
      );
    else if (scope === 'outgoing') list = list.filter((r) => r.requester_org_id === u.org_id);
    else if (scope === 'committee') list = list.filter((r) => !!E.committeeRole(u, E.project(r.project_id)));
    if (status) list = list.filter((r) => status.split(',').includes(r.status));
    list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const total = list.length;
    const limit = Math.min(500, Math.max(1, parseInt(ctx.query.limit, 10) || 150));
    const offset = Math.max(0, parseInt(ctx.query.offset, 10) || 0);
    list = list.slice(offset, offset + limit);
    return {
      items: list.map((r) => reqView(u, r)),
      total,
      limit,
      offset,
      has_more: offset + list.length < total,
      tabs: {
        incoming: S.requests.filter(
          (r) =>
            E.reqVisible(u, r) &&
            r.referrals.some((x) => x.target_org_id === u.org_id) &&
            u.org_id !== r.requester_org_id,
        ).length,
        outgoing: S.requests.filter((r) => r.requester_org_id === u.org_id).length,
      },
    };
  });

  E.route('POST', '/interagency-requests', (ctx) => {
    const u = ctx.user;
    const b = ctx.body;
    const p = E.project(clean(b.project_id, 40));
    if (!p || E.access(u, p) !== 'member') fail(404, 'NOT_FOUND', 'المشروع غير موجود أو لا تملك صلاحية الاطلاع عليه');
    if (!E.caps(u, p).create_request)
      fail(403, 'NO_PERMISSION', 'رفع الطلبات لأعضاء الجهات المشاركة في المشروع', { project_id: p.id });
    const title = clean(b.title, 160);
    if (!title) fail(422, 'MISSING_TITLE', 'اكتب عنوانًا واضحًا للطلب');
    const items = parseItems(b.items);
    if (!items.length) fail(422, 'MISSING_ITEMS', 'أضف عنصرًا واحدًا على الأقل (مثال: توفير مورد)');
    const wp = b.wp_id ? E.wp(clean(b.wp_id, 40)) : null;
    if (wp && wp.project_id !== p.id) fail(422, 'BAD_WP', 'حزمة غير صالحة');
    if (b.required_by && !isDay(b.required_by)) fail(422, 'BAD_DATES', 'موعد الحاجة غير صحيح');
    const r = newRequest({
      project_id: p.id,
      requester_org_id: u.org_id,
      created_by: u.id,
      title,
      description: clean(b.description, 3000),
      required_by: b.required_by || '',
      impact_text: clean(b.impact_text, 600),
      estimated_value: money(b.estimated_value),
      items,
      wp_id: wp?.id,
      attachments: (Array.isArray(b.attachments) ? b.attachments : [])
        .slice(0, 8)
        .map((a) => ({ name: clean(a.name, 160), size: Math.max(0, Number(a.size) || 0) })),
    });
    addEvent(r, u, 'create', 'أُنشئت مسودة الطلب', { to: 'DRAFT' });
    S.requests.push(r);
    E.audit({
      actor_id: u.id,
      action: 'request.create',
      object_type: 'request',
      object_id: r.id,
      project_id: p.id,
      detail: r.ref,
    });
    ctx.status = 201;
    return { request: reqView(u, r, true) };
  });

  E.route('PATCH', '/interagency-requests/:id', (ctx) => {
    const u = ctx.user;
    const r = needReq(ctx);
    const b = ctx.body;
    if (!['DRAFT', 'NEEDS_INFORMATION'].includes(r.status) || !ownerFields(u, r))
      fail(403, 'NO_PERMISSION', 'التعديل للجهة الطالبة والطلب مسودة أو مطلوب استكماله');
    if (b.request_version != null && Number(b.request_version) !== r.version)
      fail(409, 'STALE_VERSION', 'تغيّر الطلب منذ فتحته');
    if ('title' in b) {
      const t = clean(b.title, 160);
      if (!t) fail(422, 'MISSING_TITLE', 'اكتب عنوانًا واضحًا للطلب');
      r.title = t;
    }
    if ('description' in b) r.description = clean(b.description, 3000);
    if ('estimated_value' in b) r.estimated_value = money(b.estimated_value);
    if ('impact_text' in b) r.impact_text = clean(b.impact_text, 600);
    if ('required_by' in b) {
      if (b.required_by && !isDay(b.required_by)) fail(422, 'BAD_DATES', 'موعد الحاجة غير صحيح');
      r.required_by = b.required_by || '';
    }
    if ('items' in b) {
      const it = parseItems(b.items);
      if (!it.length) fail(422, 'MISSING_ITEMS', 'أضف عنصرًا واحدًا على الأقل');
      r.items = it;
    }
    if ('attachments' in b)
      r.attachments = (Array.isArray(b.attachments) ? b.attachments : [])
        .slice(0, 8)
        .map((a) => ({ name: clean(a.name, 160), size: Math.max(0, Number(a.size) || 0) }));
    r.version++;
    r.updated_at = E.iso();
    addEvent(r, u, 'edit', 'عُدّلت بيانات الطلب');
    E.audit({
      actor_id: u.id,
      action: 'request.edit',
      object_type: 'request',
      object_id: r.id,
      project_id: r.project_id,
      version: r.version,
    });
    return { request: reqView(u, r, true) };
  });

  E.route('GET', '/interagency-requests/:id', (ctx) => ({ request: reqView(ctx.user, needReq(ctx), true) }));

  E.route('POST', '/interagency-requests/:id/notes', (ctx) => {
    const u = ctx.user;
    const r = needReq(ctx);
    const text = clean(ctx.body.text, 1500);
    if (!text) fail(422, 'MISSING_NOTE', 'اكتب الملاحظة');
    const p = E.project(r.project_id);
    let vis;
    if (ctx.body.vis === 'committee') {
      if (!E.committeeRole(u, p)) fail(403, 'NO_PERMISSION', 'ملاحظات اللجنة الداخلية لأعضائها');
      vis = 'committee';
    } else {
      if (u.org_id !== r.target_org_id && u.org_id !== r.requester_org_id)
        fail(403, 'NO_PERMISSION', 'الملاحظة الداخلية لجهة طرف في الطلب');
      vis = u.org_id;
    }
    addEvent(r, u, 'note', `ملاحظة داخلية (${vis === 'committee' ? 'اللجنة' : E.oname(u.org_id)} فقط)`, {
      detail: text,
      vis,
    });
    E.audit({
      actor_id: u.id,
      action: 'request.note',
      object_type: 'request',
      object_id: r.id,
      project_id: r.project_id,
      detail: vis === 'committee' ? 'committee' : 'org',
    });
    ctx.status = 201;
    return { request: reqView(u, r, true) };
  });

  E.route('POST', '/interagency-requests/:id/evidence', (ctx) => {
    const u = ctx.user;
    const r = needReq(ctx);
    const b = ctx.body;
    if (
      u.org_id !== r.target_org_id ||
      !(E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN') || authorityOf(u.org_id).includes(u.id))
    )
      fail(403, 'WRONG_ORGANIZATION', 'الأدلة ترفعها الجهة الملتزمة (المشرف أو المفوّض)', { project_id: r.project_id });
    if (!['ACCEPTED_BY_ORG', 'IN_EXECUTION', 'BLOCKED', 'RETURNED_FOR_CORRECTION'].includes(r.status))
      fail(409, 'INVALID_TRANSITION', 'ارفع الأدلة بعد قبول الالتزام');
    const title = clean(b.title, 160);
    if (!title) fail(422, 'MISSING_TITLE', 'اكتب عنوانًا للدليل');
    const shared = b.shared !== false;
    const p = E.project(r.project_id);
    let f = null;
    if (b.file_id) f = E.useFileAsEvidence(u, b.file_id, { project: p, shared, grantOrgIds: [r.requester_org_id] });
    const e = {
      id: E.id('evd'),
      title,
      file_id: f?.id || null,
      file_name: f ? f.name : clean(b.file_name, 160),
      size: f ? f.size : Math.max(0, Math.min(Number(b.size) || 0, 1e9)),
      sha256: f?.sha256 || null,
      ref_only: !f,
      note: clean(b.note, 500),
      shared,
      by: u.id,
      at: E.iso(),
    };
    r.evidence.push(e);
    addEvent(r, u, 'evidence', `أُرفق دليل: ${title}`, { vis: e.shared ? 'all' : u.org_id });
    E.audit({
      actor_id: u.id,
      action: 'request.evidence',
      object_type: 'request',
      object_id: r.id,
      project_id: r.project_id,
      detail: title,
      reason: e.shared ? 'shared' : 'org-only',
    });
    ctx.status = 201;
    return { request: reqView(u, r, true) };
  });

  E.route('POST', '/interagency-requests/:id/remind', (ctx) => {
    const u = ctx.user;
    const r = needReq(ctx);
    if (!committeeTriage(u, r))
      fail(403, 'NO_PERMISSION', 'التذكير لأمانة اللجنة أو رئيسها', { project_id: r.project_id });
    if (!['REFERRED_TO_ORG', 'UNDER_ORG_REVIEW'].includes(r.status))
      fail(409, 'INVALID_TRANSITION', 'لا ينتظر الطلب ردًا من جهة');
    E.notify(
      [...authorityOf(r.target_org_id)],
      {
        kind: 'reminder',
        title: `تذكير: الطلب ${r.ref} بانتظار ردّ جهتكم`,
        body: overdue(r) ? 'تجاوز الطلب مدة الرد المرجعية' : '',
        link: linkOf(r),
        project_id: r.project_id,
      },
      u.id,
    );
    addEvent(r, u, 'remind', 'تذكير للجهة بالرد (التذكير لا يعني القبول)');
    E.audit({
      actor_id: u.id,
      action: 'request.remind',
      object_type: 'request',
      object_id: r.id,
      project_id: r.project_id,
    });
    return { request: reqView(u, r, true) };
  });

  E.route('POST', '/interagency-requests/:id/dispute', (ctx) => {
    const u = ctx.user;
    const r = needReq(ctx);
    const p = E.project(r.project_id);
    if (!committeeChair(u, r))
      fail(403, 'NO_PERMISSION', 'فتح قضية اختلاف اختصاص لرئيس اللجنة', { project_id: r.project_id });
    if (r.dispute) fail(409, 'INVALID_TRANSITION', 'توجد قضية مفتوحة على هذا الطلب');
    const reason = clean(ctx.body.reason, 1000);
    if (!reason) fail(422, 'MISSING_REASON', 'اكتب موضوع الخلاف');
    const reviewers = S.users.filter(
      (x) =>
        x.roles.includes('INDEPENDENT_REVIEWER') &&
        x.org_id !== r.requester_org_id &&
        x.org_id !== r.target_org_id &&
        !E.committeeRole(x, p),
    );
    if (!reviewers.length) fail(409, 'CONFLICT_OF_INTEREST', 'لا يوجد مرجع مستقل بلا تعارض مصالح');
    r.dispute = {
      status: 'OPEN',
      reviewer_id: reviewers[0].id,
      alt_reviewer_id: reviewers[1]?.id || reviewers[0].id,
      opened_by: u.id,
      reason,
      at: E.iso(),
    };
    addEvent(r, u, 'dispute', 'أُحيلت القضية إلى مرجع مستقل (رأيه استشاري)', { reason });
    E.audit({
      actor_id: u.id,
      action: 'request.dispute',
      object_type: 'request',
      object_id: r.id,
      project_id: r.project_id,
      reason,
    });
    E.notify([r.dispute.reviewer_id], {
      kind: 'dispute',
      title: `قضية اختلاف اختصاص: ${r.ref}`,
      body: reason.slice(0, 100),
      link: linkOf(r),
      project_id: r.project_id,
    });
    return { request: reqView(u, r, true) };
  });
  E.route('POST', '/interagency-requests/:id/opinion', (ctx) => {
    const u = ctx.user;
    const r = needReq(ctx);
    if (!r.dispute || r.dispute.status !== 'OPEN' || ![r.dispute.reviewer_id, r.dispute.alt_reviewer_id].includes(u.id))
      fail(403, 'NO_PERMISSION', 'الرأي للمرجع المستقل المعيّن', { project_id: r.project_id });
    const t = clean(ctx.body.opinion, 2000);
    if (!t) fail(422, 'MISSING_REASON', 'اكتب رأيك مسببًا');
    r.dispute.status = 'RESOLVED';
    r.dispute.opinion = t;
    r.dispute.resolved_at = E.iso();
    addEvent(r, u, 'opinion', 'صدر رأي المرجع المستقل (استشاري وغير ملزم)', { reason: t });
    E.audit({
      actor_id: u.id,
      action: 'request.opinion',
      object_type: 'request',
      object_id: r.id,
      project_id: r.project_id,
      reason: t,
    });
    E.notify(committeeIds(r), {
      kind: 'dispute',
      title: `رأي المرجع المستقل في ${r.ref}`,
      body: t.slice(0, 100),
      link: linkOf(r),
      project_id: r.project_id,
    });
    return { request: reqView(u, r, true) };
  });

  // generic dispatcher
  E.route('POST', '/interagency-requests/:id/:action', (ctx) => {
    const r = needReq(ctx);
    const key = ctx.params.action;
    if (!ACTIONS[key]) fail(404, 'NOT_FOUND', 'إجراء غير معروف');
    return { request: transition(ctx, r, key) };
  });

  // SLA ticks: reminders and escalation only. Never changes status — silence is not acceptance.
  E.tickRequests = () => {
    const now = E.iso();
    for (const r of S.requests) {
      if (!['REFERRED_TO_ORG', 'UNDER_ORG_REVIEW'].includes(r.status) || !r.response_due_at || r.response_due_at > now)
        continue;
      const hrs = slaHours(r, r.target_org_id);
      const lateH = (E.now() - Date.parse(r.response_due_at)) / 3600000;
      if (!r.sla_escalated) {
        r.sla_escalated = 1;
        addEvent(r, null, 'sla:reminder', 'تجاوز الطلب مدة الرد المرجعية — تذكير للجهة وأمانة اللجنة (لا قبول تلقائي)');
        E.notify([...authorityOf(r.target_org_id), E.project(r.project_id).committee.secretary_id], {
          kind: 'reminder',
          title: `تأخر الرد على ${r.ref}`,
          body: 'تجاوز مدة الرد المرجعية',
          link: linkOf(r),
          project_id: r.project_id,
        });
        E.audit({
          action: 'sla.reminder',
          object_type: 'request',
          object_id: r.id,
          project_id: r.project_id,
          actor_name: 'النظام',
        });
      } else if (r.sla_escalated === 1 && lateH > hrs) {
        r.sla_escalated = 2;
        addEvent(r, null, 'sla:escalation', 'تصعيد إلى رئيس اللجنة (لا قبول تلقائي)');
        E.notify([E.project(r.project_id).committee.chair_id], {
          kind: 'reminder',
          title: `تصعيد: ${r.ref} بلا ردّ من ${E.oname(r.target_org_id)}`,
          link: linkOf(r),
          project_id: r.project_id,
        });
        E.audit({
          action: 'sla.escalation',
          object_type: 'request',
          object_id: r.id,
          project_id: r.project_id,
          actor_name: 'النظام',
        });
      }
    }
  };
  E.reqCard = (u, r) => reqView(u, r);
  E.requestBall = ball;
}
