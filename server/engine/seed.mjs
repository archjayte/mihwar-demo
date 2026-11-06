// Synthetic demonstration data. All names, orgs and documents are fictional.
// The scenario is produced by calling the real engine (with a travelling clock), so every record,
// audit entry and notification is consistent with the rules enforced at run time.
import { createEngine, emptyState } from './core.mjs';
import { dayStr, DAY, b64encode } from './util.mjs';

const ORGS = [
  ['coord', 'الجهة المنسقة', 'coordinating'],
  ['police', 'الشرطة', 'agency'],
  ['finance', 'المالية', 'agency'],
  ['proc', 'المشتريات', 'agency'],
  ['services', 'الخدمات العامة', 'agency'],
  ['muni', 'البلدية', 'agency'],
  ['hr', 'الموارد البشرية', 'agency'],
  ['digital', 'الإدارة الرقمية', 'agency'],
  ['registry', 'السجل المركزي للمراجعين', 'registry'],
  ['platform', 'مشغّل المنصة', 'platform'],
];

// id, name, title, org, roles, login hint
const USERS = [
  [
    'u_chair',
    'د. ماجد الشامسي',
    'رئيس لجنة المشاريع',
    'coord',
    ['ORG_SUPERVISOR'],
    'يوجّه الطلبات إلى الجهات المختصة ويتابع الردود',
  ],
  [
    'u_sec',
    'مريم السويدي',
    'أمينة لجنة المشاريع',
    'coord',
    ['ORG_EXECUTIVE'],
    'تفرز الطلبات وتتحقق من اكتمالها وترفعها للرئيس',
  ],
  [
    'u_deputy',
    'م. راشد المزروعي',
    'نائب رئيس اللجنة',
    'coord',
    ['ORG_EXECUTIVE'],
    'نائب الرئيس: يتابع ويطّلع، ولا يحيل إلا بتفويض صريح',
  ],
  [
    'u_coord',
    'هند القاسمي',
    'منسّقة المشاريع',
    'coord',
    ['COORDINATING_ADMIN', 'ORG_ADMIN'],
    'تبني خطة المشروع وتصدر تصاريح البدء وتراجع المخرجات',
  ],
  [
    'u_member',
    'فاطمة المطروشي',
    'عضو لجنة — الخدمات العامة',
    'services',
    ['ORG_EXECUTIVE'],
    'عضو في لجنة المشروع (اطلاع ومتابعة)',
  ],
  [
    'u_pol_auth',
    'سالم الكعبي',
    'مدير الخدمات المساندة',
    'police',
    ['ORG_ADMIN'],
    'مفوّض الشرطة: يعتمد الطلبات ويقبل المخرجات',
  ],
  ['u_pol_sup', 'خالد النعيمي', 'مشرف المشاريع', 'police', ['ORG_SUPERVISOR'], 'يعدّ الطلبات ويوزّع مهام فريق الشرطة'],
  ['u_pol_exe', 'عائشة الشحي', 'منفّذة', 'police', ['ORG_EXECUTIVE'], 'تنفّذ مهامها وتحدّث تقدّمها'],
  ['u_pol_exe2', 'أحمد الظنحاني', 'منفّذ', 'police', ['ORG_EXECUTIVE'], 'منفّذ في فريق الشرطة'],
  [
    'u_fin_auth',
    'عبدالله الحمادي',
    'مدير دائرة المالية',
    'finance',
    ['ORG_ADMIN'],
    'مفوّض المالية: يقبل أو يعتذر عن الطلبات الواردة',
  ],
  [
    'u_fin_sup',
    'نورة العلي',
    'مشرفة الشؤون المالية',
    'finance',
    ['ORG_SUPERVISOR'],
    'توزّع التزامات المالية على فريقها',
  ],
  ['u_fin_s1', 'يوسف البلوشي', 'محاسب', 'finance', ['ORG_EXECUTIVE'], 'منفّذ مالي — بلا تفويض رد رسمي'],
  ['u_fin_s2', 'ليلى الزعابي', 'محاسبة', 'finance', ['ORG_EXECUTIVE'], 'منفّذة مالية'],
  ['u_proc_auth', 'حمد الجنيبي', 'مدير المشتريات', 'proc', ['ORG_ADMIN'], 'مفوّض المشتريات'],
  ['u_proc_sup', 'سعيد المرر', 'مشرف العقود', 'proc', ['ORG_SUPERVISOR'], 'يوزّع التزامات المشتريات'],
  ['u_proc_s1', 'أمل الخاطري', 'أخصائية مشتريات', 'proc', ['ORG_EXECUTIVE'], 'منفّذة في المشتريات'],
  ['u_svc_auth', 'محمد النقبي', 'مدير الخدمات العامة', 'services', ['ORG_ADMIN'], 'مفوّض الخدمات العامة'],
  ['u_svc_sup', 'شيخة الطنيجي', 'مشرفة المرافق', 'services', ['ORG_SUPERVISOR'], 'مشرفة الخدمات العامة'],
  ['u_svc_s1', 'عيسى المهيري', 'فنّي صيانة', 'services', ['ORG_EXECUTIVE'], 'منفّذ'],
  ['u_mun_auth', 'جاسم الحوسني', 'مدير التراخيص', 'muni', ['ORG_ADMIN'], 'مفوّض البلدية'],
  ['u_mun_sup', 'مروة الغيثي', 'مشرفة المعاينات', 'muni', ['ORG_SUPERVISOR'], 'مشرفة البلدية'],
  ['u_mun_s1', 'سلطان الزحمي', 'مهندس معاينة', 'muni', ['ORG_EXECUTIVE'], 'منفّذ'],
  ['u_hr_auth', 'منى العامري', 'مديرة الموارد البشرية', 'hr', ['ORG_ADMIN'], 'مفوّضة الموارد البشرية'],
  ['u_hr_sup', 'فيصل الكتبي', 'مشرف الخدمات', 'hr', ['ORG_SUPERVISOR'], 'مشرف'],
  ['u_hr_s1', 'بدرية الشامسي', 'أخصائية موارد', 'hr', ['ORG_EXECUTIVE'], 'منفّذة'],
  ['u_dig_auth', 'ناصر الجابري', 'مدير الإدارة الرقمية', 'digital', ['ORG_ADMIN'], 'مفوّض الإدارة الرقمية'],
  ['u_dig_sup', 'رنا الفلاسي', 'مشرفة التطوير', 'digital', ['ORG_SUPERVISOR'], 'مشرفة'],
  ['u_dig_s1', 'زايد القبيسي', 'مطوّر', 'digital', ['ORG_EXECUTIVE'], 'منفّذ'],
  [
    'u_indep',
    'د. علياء الرميثي',
    'مرجع مستقل (أصيل)',
    'registry',
    ['INDEPENDENT_REVIEWER'],
    'تنظر في قضايا اختلاف الاختصاص المحالة إليها فقط',
  ],
  [
    'u_indep2',
    'م. حارب السعدي',
    'مرجع مستقل (بديل)',
    'registry',
    ['INDEPENDENT_REVIEWER'],
    'المرجع البديل عند التعارض',
  ],
  ['u_audit', 'طارق الشرياني', 'مدقق', 'registry', ['FINAL_AUDITOR'], 'اطلاع وتدقيق للقراءة فقط'],
  [
    'u_owner',
    'مالك المنصة',
    'إدارة المنصة',
    'platform',
    ['PLATFORM_OWNER_ADMIN'],
    'مؤشرات مجمّعة بلا اطّلاع على محتوى الجهات',
  ],
  [
    'u_super',
    'مشغّل المنصة التقني',
    'تشغيل تقني',
    'platform',
    ['SUPER_ADMIN'],
    'تشغيل وصيانة تقنية — لا يرى محتوى الجهات',
  ],
];

const UNITS = {
  coord: [
    ['coord_a', 'مكتب اللجنة'],
    ['coord_b', 'التنسيق والمتابعة'],
  ],
  police: [
    ['police_a', 'إدارة الخدمات المساندة'],
    ['police_b', 'إدارة المشاريع'],
  ],
  finance: [
    ['finance_a', 'الميزانية والتخصيص'],
    ['finance_b', 'المحاسبة والتدقيق المالي'],
  ],
  proc: [
    ['proc_a', 'العقود'],
    ['proc_b', 'الموردون'],
  ],
  services: [
    ['services_a', 'المرافق'],
    ['services_b', 'الصيانة'],
  ],
  muni: [
    ['muni_a', 'التراخيص'],
    ['muni_b', 'المعاينات'],
  ],
  hr: [
    ['hr_a', 'الخدمات'],
    ['hr_b', 'التطوير والتدريب'],
  ],
  digital: [
    ['digital_a', 'التطوير'],
    ['digital_b', 'البنية التقنية'],
  ],
};
// who sits in which unit (first unit: leadership and supervision; second: executives)
const unitOf = (u) =>
  `${u.org_id}_${u.roles.includes('ORG_EXECUTIVE') && !['u_sec', 'u_deputy'].includes(u.id) ? 'b' : 'a'}`;

const COMPETENCIES = [
  ['supplier_provisioning', 'proc', 'توفير الموردين المعتمدين واختيارهم', 72],
  ['contract_execution', 'proc', 'إبرام العقود وتوقيعها وفق نظام المشتريات', 96],
  ['financial_approval', 'finance', 'الاعتمادات والموافقات المالية', 48],
  ['budget_allocation', 'finance', 'تخصيص الموازنات وتعديلها', 72],
  ['facility_services', 'services', 'تجهيز المنشآت والصيانة والخدمات المساندة', 72],
  ['hr_services', 'hr', 'خدمات الموارد البشرية والتوظيف والتدريب', 72],
  ['it_integration', 'digital', 'الحلول التقنية والتكامل بين الأنظمة', 96],
  ['municipal_permits', 'muni', 'التصاريح والاشتراطات والمعاينات', 120],
].map(([service_type, owner_org_id, scope, sla_hours], i) => ({
  id: `cmp_${i + 1}`,
  service_type,
  owner_org_id,
  scope,
  legal_basis_ref: 'سند الاختصاص — بيانات تجريبية',
  sla_hours,
  required_docs: ['وصف الطلب', 'المواصفات أو المرفقات'],
  escalation_path: 'أمانة اللجنة ثم رئيس اللجنة',
}));

export function buildState(nowMs = Date.now(), blobs = null) {
  const S = emptyState();
  S.meta.createdAt = new Date(nowMs).toISOString();
  S.orgs = ORGS.map(([id, name, kind]) => ({ id, name, kind }));
  S.users = USERS.map(([id, name, title, org_id, roles, hint]) => ({
    id,
    name,
    title,
    org_id,
    roles,
    hint,
    active: true,
    capacity_week: 40,
  }));
  S.competencies = COMPETENCIES.map((c) => ({
    ...c,
    valid_from: dayStr(nowMs - 365 * 86400000),
    valid_to: dayStr(nowMs + 365 * 86400000),
    acceptance_authority: 'مفوّض قبول الالتزامات في الجهة (بتفويض ساري)',
    substitute_org_id: c.owner_org_id === 'proc' ? 'finance' : c.owner_org_id === 'services' ? 'muni' : null,
  }));
  S.orgUnits = Object.entries(UNITS).flatMap(([org_id, us]) => us.map(([id, name]) => ({ id, org_id, name })));
  for (const u of S.users) if (UNITS[u.org_id]) u.unit_id = unitOf(u);
  const REPS = {
    police: ['u_pol_auth', 'u_pol_sup'],
    finance: ['u_fin_auth', 'u_fin_sup'],
    proc: ['u_proc_auth', 'u_proc_sup'],
    services: ['u_svc_auth', 'u_svc_sup'],
    muni: ['u_mun_auth', 'u_mun_sup'],
    hr: ['u_hr_auth', 'u_hr_sup'],
    digital: ['u_dig_auth', 'u_dig_sup'],
    coord: ['u_coord', 'u_chair'],
  };
  for (const o of S.orgs)
    if (REPS[o.id]) {
      o.representative_id = REPS[o.id][0];
      o.alternate_id = REPS[o.id][1];
    }

  let cur = nowMs - 47 * DAY;
  const E = createEngine({ state: S, now: () => cur, demo: true, blobs });
  const T = (d, h = 9) => {
    cur = nowMs + d * DAY + (h - 12) * 3600000;
  };
  const D = (n) => dayStr(nowMs + n * DAY);
  const until = D(400);

  // org-wide delegations (project-level mandates are issued automatically at project creation)
  let dn = 0;
  const dg = (user_id, action, service_types = ['*']) =>
    S.delegations.push({
      id: `dlg_s${++dn}`,
      user_id,
      org_id: E.user(user_id).org_id,
      action,
      project_ids: ['*'],
      service_types,
      valid_from: D(-60),
      valid_to: until,
      basis: 'قرار تفويض داخلي — بيانات تجريبية',
      granted_by: 'u_coord',
      revoked: false,
    });
  const AUTH = {
    u_pol_auth: ['other'],
    u_fin_auth: ['financial_approval', 'budget_allocation'],
    u_proc_auth: ['supplier_provisioning', 'contract_execution'],
    u_svc_auth: ['facility_services'],
    u_mun_auth: ['municipal_permits'],
    u_hr_auth: ['hr_services'],
    u_dig_auth: ['it_integration'],
  };
  for (const [u, types] of Object.entries(AUTH)) {
    dg(u, 'commit', types);
    dg(u, 'submit_request');
    dg(u, 'accept_deliverable');
    dg(u, 'approve_change');
  }
  S.delegations.find((d) => d.user_id === 'u_fin_auth' && d.action === 'commit').max_amount = 500000; // demo: financial limit of the Finance authority
  dg('u_coord', 'accept_deliverable');
  dg('u_sec', 'close_request');
  S.meta.seq.dlg = 100;

  const go = (uid, method, path, body = {}, query = {}) => {
    S.sessions.seed = { user_id: uid, created: cur, last: cur };
    const r = E.handle({ method, path, body, query, headers: { 'x-session': 'seed' } });
    if (r.status >= 400)
      throw new Error(`SEED ${method} ${path} as ${uid}: ${r.status} ${JSON.stringify(r.body.error)}`);
    return r.body;
  };
  const post = (uid, path, body) => go(uid, 'POST', path, body);
  const rq = (id) => E.req(id);
  const act = (uid, id, action, body = {}) =>
    post(uid, `/interagency-requests/${id}/${action}`, { request_version: rq(id).version, ...body }).request;
  const mkReq = (uid, project_id, o) => {
    const r = post(uid, '/interagency-requests', { project_id, ...o }).request;
    return r.id;
  };
  const submitFlow = (id, sup, auth) => {
    act(sup, id, 'send-for-approval');
    act(auth, id, 'submit');
  };
  const task = (uid, body) => post(uid, '/tasks', body).task;
  // minimal, valid single-page PDF (ASCII only) — every demo evidence file is a real, downloadable document
  const makePdf = (label) => {
    const esc = (t) => t.replace(/[\\()]/g, '');
    const stream = `BT /F1 14 Tf 60 760 Td (MIHWAR DEMO DOCUMENT - SYNTHETIC) Tj 0 -28 Td (${esc(label).slice(0, 70)}) Tj 0 -28 Td (No real data. For demonstration only.) Tj ET`;
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let out = '%PDF-1.4\n';
    const off = [];
    objs.forEach((o, i) => {
      off.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const x = out.length;
    out +=
      `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
      off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
      `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    return new TextEncoder().encode(out);
  };
  const up = (uid, project_id, name, label) => {
    const bytes = name.endsWith('.pdf')
      ? makePdf(name.replace(/[^\x20-\x7e]/g, ''))
      : new TextEncoder().encode(`${label}\n(synthetic demo file)\n`);
    return post(uid, '/files', { project_id, name, content_base64: b64encode(bytes) }).file.id;
  };

  // ================================================================== Project A — facility set-up
  T(-46);
  const A = post('u_coord', '/projects', {
    name: 'تجهيز منشأة مشتركة',
    objective:
      'تجهيز منشأة تشغيلية تشاركية بين الجهات: توفير المورد والتعاقد، الاعتماد المالي، التصاريح، والاستلام النهائي.',
    start: D(-45),
    end: D(120),
    org_ids: ['police', 'finance', 'proc', 'services', 'muni'],
    chair_id: 'u_chair',
    deputy_id: 'u_deputy',
    secretary_id: 'u_sec',
  }).project.id;
  T(-45);
  for (const u of ['u_pol_auth', 'u_fin_auth', 'u_proc_auth', 'u_svc_auth', 'u_mun_auth'])
    post(u, `/projects/${A}/participation`, { decision: 'accept' });
  E.project(A).committee.member_ids.push('u_member');
  E.state.threads
    .find((t) => t.project_id === A)
    .member_ids.push('u_member', 'u_pol_auth', 'u_fin_auth', 'u_proc_auth', 'u_svc_auth', 'u_mun_auth');

  T(-44);
  const wp = (uid, project, o) => post(uid, `/projects/${project}/work-packages`, o).work_package.id;
  const a1 = wp('u_coord', A, {
    title: 'إعداد الاحتياجات والمواصفات',
    description: 'حصر الاحتياجات التشغيلية للمنشأة وإعداد المواصفات الفنية المعتمدة.',
    owner_org_id: 'police',
    owner_user_id: 'u_pol_sup',
    weight: 10,
    planned_start: D(-44),
    planned_end: D(-28),
    criteria: ['مواصفات معتمدة من مدير الخدمات المساندة', 'قائمة احتياجات مرتبة بالأولوية'],
    required_evidence: 1,
  });
  const a2 = wp('u_coord', A, {
    title: 'الاعتماد المالي وتخصيص الموازنة',
    description: 'اعتماد بنود الصرف وتخصيص الموازنة اللازمة لتجهيز المنشأة.',
    owner_org_id: 'finance',
    owner_user_id: 'u_fin_sup',
    weight: 20,
    planned_start: D(-30),
    planned_end: D(-9),
    depends_on: [a1],
    criteria: ['كتاب اعتماد الموازنة', 'جدول بنود الصرف المعتمد'],
    required_evidence: 2,
  });
  const a3 = wp('u_coord', A, {
    title: 'توفير المورد وإبرام العقد',
    description: 'اختيار المورد المعتمد واستكمال إجراءات التعاقد وفق نظام المشتريات.',
    owner_org_id: 'proc',
    owner_user_id: 'u_proc_sup',
    weight: 25,
    planned_start: D(-26),
    planned_end: D(20),
    depends_on: [a1],
    criteria: ['محضر اختيار المورد', 'العقد الموقع'],
    required_evidence: 2,
  });
  const a4 = wp('u_coord', A, {
    title: 'تجهيز الموقع وتركيب الأنظمة',
    description: 'تجهيز الموقع وتركيب الأنظمة بعد توريد المستلزمات.',
    owner_org_id: 'services',
    owner_user_id: 'u_svc_sup',
    weight: 20,
    planned_start: D(5),
    planned_end: D(50),
    depends_on: [a3],
    criteria: ['محضر تسليم الموقع', 'نتائج اختبار التركيب'],
    required_evidence: 1,
  });
  const a5 = wp('u_coord', A, {
    title: 'الاشتراطات والتصاريح البلدية',
    description: 'استخراج التصاريح والاشتراطات اللازمة لتشغيل المنشأة.',
    owner_org_id: 'muni',
    owner_user_id: 'u_mun_sup',
    weight: 15,
    planned_start: D(-8),
    planned_end: D(30),
    depends_on: [a1],
    criteria: ['تصريح التشغيل', 'تقرير المعاينة'],
    required_evidence: 1,
  });
  const a6 = wp('u_coord', A, {
    title: 'الاستلام والاختبار والتسليم النهائي',
    description: 'الاستلام النهائي بعد اكتمال التجهيز والتصاريح.',
    owner_org_id: 'police',
    owner_user_id: 'u_pol_sup',
    weight: 10,
    planned_start: D(51),
    planned_end: D(80),
    depends_on: [a4, a5],
    criteria: ['محضر الاستلام النهائي'],
    required_evidence: 1,
  });
  T(-43);
  post('u_coord', `/projects/${A}/freeze-baseline`);

  const toAwait = (u, id) => post(u, `/work-packages/${id}/transition`, { to: 'AWAITING_RELEASE' });
  const release = (id, note) => post('u_coord', `/work-packages/${id}/release`, { note });
  const start = (u, id) => post(u, `/work-packages/${id}/transition`, { to: 'IN_EXECUTION' });
  const evid = (u, id, title, file) =>
    post(u, `/work-packages/${id}/evidence`, { title, kind: 'doc', file_id: up(u, E.wp(id).project_id, file, title) });
  const submitWp = (u, id) => post(u, `/work-packages/${id}/transition`, { to: 'ORG_SUBMITTED' });

  T(-42);
  toAwait('u_pol_sup', a1);
  T(-41);
  release(a1, 'استيفاء شروط الجاهزية');
  T(-40);
  start('u_pol_sup', a1);
  T(-30);
  evid('u_pol_sup', a1, 'وثيقة المواصفات الفنية المعتمدة', 'specs-v3.pdf');
  T(-29);
  submitWp('u_pol_sup', a1);
  T(-27);
  post('u_coord', `/work-packages/${a1}/review`, {
    decision: 'accept',
    note: 'المواصفات مكتملة ومطابقة لمعايير القبول.',
  });
  T(-26);
  toAwait('u_fin_sup', a2);
  release(a2, 'اعتماد بعد قبول المواصفات');
  toAwait('u_proc_sup', a3);
  release(a3, 'جاهزة للبدء');
  T(-25);
  start('u_fin_sup', a2);
  T(-24);
  start('u_proc_sup', a3);
  T(-12);
  evid('u_fin_sup', a2, 'كتاب اعتماد الموازنة', 'budget-approval.pdf');
  evid('u_fin_sup', a2, 'جدول بنود الصرف', 'items.csv');
  T(-6);
  submitWp('u_fin_sup', a2);
  T(-5);
  go('u_proc_sup', 'PATCH', `/work-packages/${a3}`, { self_pct: 45 });
  T(-3);
  toAwait('u_mun_sup', a5);

  // ---------------- Project A requests
  // R1: finance declines out of scope -> committee reroutes to procurement -> accepted and executed
  T(-22);
  const r1 = mkReq('u_pol_sup', A, {
    title: 'توفير مورد واستكمال إجراءات التعاقد',
    description:
      'نرجو توفير المورد المعتمد للمستلزمات المحددة في المواصفات، واستكمال إجراءات التعاقد وتوقيعه، ليتسنى البدء بتجهيز المنشأة.',
    required_by: D(15),
    impact_text: 'تأخر التوريد يؤخر تجهيز الموقع وتسليمه.',
    wp_id: a3,
    items: [
      {
        title: 'توفير المورد المعتمد للمستلزمات',
        spec: 'وفق وثيقة المواصفات v3',
        service_type: 'supplier_provisioning',
      },
      { title: 'استكمال إجراءات التعاقد وتوقيعه', spec: 'عقد توريد وتركيب', service_type: 'contract_execution' },
    ],
    attachments: [{ name: 'specs-v3.pdf', size: 214000 }],
  });
  submitFlow(r1, 'u_pol_sup', 'u_pol_auth');
  T(-21);
  act('u_sec', r1, 'route-to-chair', { candidate_org_id: 'finance' });
  T(-21, 14);
  act('u_chair', r1, 'refer', {
    target_org_id: 'finance',
    reason: 'للدراسة والإفادة في حدود الاختصاص بشأن الشق المالي والتعاقدي.',
  });
  T(-20);
  act('u_fin_auth', r1, 'acknowledge');
  T(-19);
  act('u_fin_auth', r1, 'decide', {
    decision: 'DECLINE',
    reason_code: 'OUT_OF_SCOPE',
    reason_text:
      'توفير الموردين وإبرام العقود ليس من اختصاص دائرة المالية وفق سجل الاختصاصات؛ نوصي بإحالته إلى جهة المشتريات المختصة.',
  });
  T(-18);
  act('u_chair', r1, 'reroute', {
    target_org_id: 'proc',
    reason: 'إعادة توجيه إلى المشتريات بناءً على اعتذار المالية المسبَّب.',
  });
  T(-17);
  act('u_proc_auth', r1, 'acknowledge');
  T(-16);
  act('u_proc_auth', r1, 'decide', {
    decision: 'ACCEPT',
    scope_text: 'اختيار المورد وفق نظام المشتريات وإبرام عقد التوريد والتركيب، شاملًا مراجعة العروض وتأكيد المواصفات.',
    conditions: 'تزويد المشتريات بالمواصفات المعتمدة وبند الموازنة قبل الترسية.',
    due_on: D(14),
  });
  T(-15);
  act('u_proc_sup', r1, 'start-execution');
  const cm1 = E.state.commitments.find((c) => c.request_id === r1).id;
  const pt = (uid, title, assignee, extra) =>
    post(uid, `/commitments/${cm1}/internal-tasks`, { title, assignee_id: assignee, ...extra }).task;
  const t1 = pt('u_proc_sup', 'استلام المواصفات ومراجعة اكتمالها', 'u_proc_s1', {
    planned_start: D(-15),
    planned_end: D(-10),
    est_hours: 10,
    priority: 'high',
  });
  const t2 = pt('u_proc_sup', 'طلب عروض الأسعار من الموردين المعتمدين', 'u_proc_s1', {
    planned_start: D(-10),
    planned_end: D(-2),
    est_hours: 24,
  });
  const t3 = pt('u_proc_sup', 'تقييم العروض وإعداد محضر الترسية', 'u_proc_sup', {
    planned_start: D(-2),
    planned_end: D(5),
    est_hours: 18,
    priority: 'high',
  });
  pt('u_proc_sup', 'إعداد مسودة العقد ومراجعتها قانونيًا', 'u_proc_s1', {
    planned_start: D(4),
    planned_end: D(12),
    est_hours: 20,
  });
  T(-9);
  go('u_proc_s1', 'PATCH', `/tasks/${t1.id}`, {
    status: 'DONE_INTERNAL',
    shared_progress_note: 'اكتملت مراجعة المواصفات',
  });
  T(-3);
  go('u_proc_s1', 'PATCH', `/tasks/${t2.id}`, {
    status: 'IN_PROGRESS',
    completion_pct: 70,
    private_notes: 'مورّد واحد لم يرد بعد، سنتابعه هاتفيًا.',
  });
  T(-1);
  go('u_proc_sup', 'PATCH', `/tasks/${t3.id}`, { status: 'IN_PROGRESS', completion_pct: 20 });
  post('u_proc_sup', `/commitments/${cm1}/updates`, { note: 'استلمنا عروض ثلاثة موردين وجارٍ التقييم الفني.' });
  post('u_proc_sup', `/interagency-requests/${r1}/evidence`, {
    title: 'محضر فتح عروض الأسعار',
    file_id: up('u_proc_sup', A, 'bids-opening.pdf', 'محضر فتح عروض الأسعار'),
    shared: true,
  });
  post('u_chair', `/interagency-requests/${r1}/notes`, {
    text: 'متابعة أسبوعية مع المشتريات إلى حين الترسية.',
    vis: 'committee',
  });
  const th1 = E.state.threads.find((t) => t.request_id === r1).id;
  T(-14);
  post('u_pol_auth', `/threads/${th1}/messages`, { text: 'شكرًا للمشتريات. هل تحتاجون أي إيضاح على المواصفات؟' });
  T(-14, 12);
  post('u_proc_auth', `/threads/${th1}/messages`, { text: 'المواصفات واضحة، سنطلب فقط تأكيد سقف البند المالي.' });

  // R2: finance accepts, executes, delivers — awaiting police review
  T(-16);
  const r2 = mkReq('u_pol_sup', A, {
    title: 'اعتماد بند الصرف لتجهيز المنشأة',
    description: 'نرجو اعتماد بند الصرف المخصص لتجهيز المنشأة وفق الجدول المرفق.',
    required_by: D(-2),
    impact_text: 'الاعتماد مطلوب قبل الترسية.',
    items: [{ title: 'اعتماد بند الصرف', spec: 'وفق جدول البنود', service_type: 'financial_approval' }],
  });
  submitFlow(r2, 'u_pol_sup', 'u_pol_auth');
  act('u_sec', r2, 'route-to-chair', {});
  T(-15, 11);
  act('u_chair', r2, 'refer', { target_org_id: 'finance', reason: 'اعتماد مالي ضمن اختصاص دائرة المالية.' });
  T(-14, 9);
  act('u_fin_auth', r2, 'acknowledge');
  act('u_fin_auth', r2, 'decide', {
    decision: 'ACCEPT',
    scope_text: 'مراجعة جدول البنود واعتمادها وإصدار كتاب الاعتماد المالي.',
    due_on: D(-3),
  });
  T(-13);
  act('u_fin_sup', r2, 'start-execution');
  const cm2 = E.state.commitments.find((c) => c.request_id === r2).id;
  const ft = (title, a, pct) => {
    const t = post('u_fin_sup', `/commitments/${cm2}/internal-tasks`, {
      title,
      assignee_id: a,
      planned_start: D(-13),
      planned_end: D(-5),
      est_hours: 8,
    }).task;
    go(a, 'PATCH', `/tasks/${t.id}`, {
      status: 'DONE_INTERNAL',
      completion_pct: pct,
      private_notes: 'تمت المطابقة مع الموازنة المعتمدة.',
    });
    return t;
  };
  T(-10);
  ft('مطابقة البنود مع الموازنة المعتمدة', 'u_fin_s1', 100);
  T(-8);
  ft('إعداد كتاب الاعتماد المالي', 'u_fin_s2', 100);
  T(-6);
  post('u_fin_sup', `/interagency-requests/${r2}/evidence`, {
    title: 'كتاب الاعتماد المالي',
    file_id: up('u_fin_sup', A, 'financial-approval.pdf', 'كتاب الاعتماد المالي'),
    shared: true,
  });
  act('u_fin_sup', r2, 'submit-deliverable');

  // R3: services asks for missing documents — police must complete
  T(-7);
  const r3 = mkReq('u_pol_exe', A, {
    title: 'تجهيز مواقع التخزين المؤقتة',
    description: 'نحتاج تجهيز موقعي تخزين مؤقتين لحين اكتمال المنشأة.',
    required_by: D(10),
    items: [{ title: 'تجهيز موقعي التخزين', spec: 'مساحة تقريبية 120 م²', service_type: 'facility_services' }],
  });
  act('u_pol_exe', r3, 'send-for-approval');
  act('u_pol_auth', r3, 'submit');
  T(-6);
  act('u_sec', r3, 'route-to-chair');
  act('u_chair', r3, 'refer', { target_org_id: 'services', reason: 'تجهيز مرافق ضمن اختصاص الخدمات العامة.' });
  T(-5);
  act('u_svc_auth', r3, 'acknowledge');
  act('u_svc_auth', r3, 'decide', {
    decision: 'NEED_INFO',
    missing_items: ['مخطط الموقعين المقترحين', 'المساحة المطلوبة تحديدًا لكل موقع', 'تاريخ الاستلام المستهدف'],
  });

  // R4: composite — awaiting chair (can be split)
  T(-4);
  const r4 = mkReq('u_pol_sup', A, {
    title: 'تجهيز الموقع واستخراج تصريح التشغيل',
    description: 'نحتاج تجهيز الموقع وأيضًا استخراج تصريح التشغيل من الجهة المختصة.',
    required_by: D(25),
    items: [
      { title: 'تجهيز الموقع للتشغيل', spec: 'أعمال تهيئة وصيانة', service_type: 'facility_services' },
      { title: 'استخراج تصريح التشغيل', spec: 'وفق اشتراطات البلدية', service_type: 'municipal_permits' },
    ],
  });
  submitFlow(r4, 'u_pol_sup', 'u_pol_auth');
  T(-3);
  act('u_sec', r4, 'route-to-chair', {});
  // R5: draft
  T(-2);
  mkReq('u_pol_sup', A, {
    title: 'صيانة دورية للأنظمة المؤقتة',
    description: 'مسودة — بانتظار استكمال المواصفات.',
    required_by: D(30),
    items: [{ title: 'صيانة دورية', spec: '', service_type: 'facility_services' }],
  });
  // R6: just landed at committee
  T(-1, 8);
  const r6 = mkReq('u_pol_sup', A, {
    title: 'تخصيص موازنة للمرحلة الثانية',
    description: 'نطلب تخصيص موازنة المرحلة الثانية من المشروع.',
    required_by: D(21),
    items: [{ title: 'تخصيص موازنة المرحلة الثانية', spec: '', service_type: 'budget_allocation' }],
  });
  E.req(r6).estimated_value = 750000; // above the Finance authority's limit (500,000) -> OVER_LIMIT demo
  submitFlow(r6, 'u_pol_sup', 'u_pol_auth');
  // R7: referred, never answered -> overdue, reminder + escalation only
  T(-9);
  const r7 = mkReq('u_pol_sup', A, {
    title: 'تأمين موقع إيواء للمعدات',
    description: 'نطلب تأمين موقع إيواء للمعدات إلى حين التركيب.',
    required_by: D(7),
    items: [{ title: 'موقع إيواء للمعدات', spec: '', service_type: 'facility_services' }],
  });
  submitFlow(r7, 'u_pol_sup', 'u_pol_auth');
  T(-8);
  act('u_sec', r7, 'route-to-chair');
  T(-8, 13);
  act('u_chair', r7, 'refer', { target_org_id: 'services', reason: 'ضمن اختصاص الخدمات العامة.' });
  // R8: municipality counter-proposes
  T(-12);
  const r8 = mkReq('u_pol_sup', A, {
    title: 'تصريح التشغيل النهائي للمنشأة',
    description: 'نطلب إصدار تصريح التشغيل النهائي بعد اكتمال التجهيز.',
    required_by: D(30),
    items: [{ title: 'تصريح التشغيل النهائي', spec: '', service_type: 'municipal_permits' }],
  });
  submitFlow(r8, 'u_pol_sup', 'u_pol_auth');
  act('u_sec', r8, 'route-to-chair');
  T(-11);
  act('u_chair', r8, 'refer', { target_org_id: 'muni', reason: 'التصاريح من اختصاص البلدية.' });
  T(-10);
  act('u_mun_auth', r8, 'acknowledge');
  act('u_mun_auth', r8, 'decide', {
    decision: 'COUNTER',
    new_scope: 'إصدار تصريح تشغيل مبدئي الآن مقابل إصدار التصريح النهائي بعد معاينة ميدانية بعد التركيب.',
    reason_text: 'التصريح النهائي يشترط معاينة بعد اكتمال التركيب.',
  });

  // internal tasks of other teams (project work, not commitments)
  T(-6);
  const ptsk = (u, title, a, o) => task(u, { project_id: A, title, assignee_id: a, ...o });
  ptsk('u_pol_sup', 'مراجعة جدول الاحتياجات النهائي', 'u_pol_exe', {
    planned_start: D(-6),
    planned_end: D(-1),
    est_hours: 6,
    wp_id: a1,
  });
  ptsk('u_pol_sup', 'تجهيز ملف استلام المنشأة', 'u_pol_exe2', {
    planned_start: D(2),
    planned_end: D(14),
    est_hours: 14,
    priority: 'high',
    wp_id: a6,
  });
  ptsk('u_pol_sup', 'التنسيق مع الخدمات العامة لموعد المعاينة', 'u_pol_exe', {
    planned_start: D(0),
    planned_end: D(5),
    est_hours: 5,
  });
  go('u_pol_exe', 'POST', '/tasks', {
    project_id: A,
    title: 'تحديث سجل المتابعة الأسبوعي',
    planned_end: D(1),
    est_hours: 3,
  });
  ptsk('u_svc_sup', 'إعداد خطة تجهيز الموقع', 'u_svc_s1', {
    planned_start: D(-3),
    planned_end: D(6),
    est_hours: 16,
    wp_id: a4,
  });
  ptsk('u_mun_sup', 'جدولة المعاينة الميدانية', 'u_mun_s1', {
    planned_start: D(-2),
    planned_end: D(8),
    est_hours: 10,
    wp_id: a5,
  });

  // pending change request on A-04 and a proposed external blocker on A-05
  T(-2, 15);
  post('u_svc_sup', `/projects/${A}/change-requests`, {
    reason: 'تأخر توريد المستلزمات يتطلب إزاحة بدء تجهيز الموقع عشرة أيام.',
    changes: [{ wp_id: a4, planned_start: D(15), planned_end: D(60) }],
  });
  T(-1, 15);
  post('u_mun_sup', `/work-packages/${a5}/issues`, {
    title: 'تأخر كتاب إتاحة الموقع من جهة خارجية',
    kind: 'external',
    days: 4,
    proof: 'مخاطبة رقم TEST-0457 (بيانات تجريبية)',
    blocking: false,
  });

  // ================================================================== Project B — infrastructure
  T(-32);
  const B = post('u_coord', '/projects', {
    name: 'البنية التحتية والخدمات المشتركة',
    objective: 'تحديث البنية التحتية للاتصالات والطرق الفرعية وربطها بنظام مراقبة مروري مشترك.',
    start: D(-30),
    end: D(150),
    org_ids: ['police', 'muni', 'services', 'digital'],
    chair_id: 'u_chair',
    deputy_id: 'u_deputy',
    secretary_id: 'u_sec',
  }).project.id;
  T(-31);
  for (const u of ['u_pol_auth', 'u_mun_auth', 'u_svc_auth', 'u_dig_auth'])
    post(u, `/projects/${B}/participation`, { decision: 'accept' });
  T(-30);
  const b1 = wp('u_coord', B, {
    title: 'دراسة المسارات والتقاطعات',
    owner_org_id: 'muni',
    owner_user_id: 'u_mun_sup',
    weight: 20,
    planned_start: D(-30),
    planned_end: D(-16),
    criteria: ['تقرير الدراسة المعتمد'],
  });
  const b2 = wp('u_coord', B, {
    title: 'تحديث البنية التحتية للاتصالات',
    owner_org_id: 'digital',
    owner_user_id: 'u_dig_sup',
    weight: 25,
    planned_start: D(-15),
    planned_end: D(-6),
    depends_on: [b1],
    criteria: ['تقرير اختبار الشبكة'],
  });
  const b3 = wp('u_coord', B, {
    title: 'إعادة تأهيل الطرق الفرعية',
    owner_org_id: 'services',
    owner_user_id: 'u_svc_sup',
    weight: 30,
    planned_start: D(-14),
    planned_end: D(40),
    depends_on: [b1],
    criteria: ['محضر استلام الأعمال'],
  });
  const b4 = wp('u_coord', B, {
    title: 'نظام مراقبة المرور',
    owner_org_id: 'police',
    owner_user_id: 'u_pol_sup',
    weight: 15,
    planned_start: D(41),
    planned_end: D(90),
    depends_on: [b2],
    criteria: ['نتائج تشغيل تجريبي'],
  });
  wp('u_coord', B, {
    title: 'الاختبار والتسليم',
    owner_org_id: 'muni',
    owner_user_id: 'u_mun_sup',
    weight: 10,
    planned_start: D(91),
    planned_end: D(120),
    depends_on: [b3, b4],
    criteria: ['محضر التسليم'],
  });
  T(-29);
  post('u_coord', `/projects/${B}/freeze-baseline`);
  T(-28);
  toAwait('u_mun_sup', b1);
  release(b1, 'جاهزة');
  start('u_mun_sup', b1);
  T(-17);
  evid('u_mun_sup', b1, 'تقرير دراسة المسارات', 'routes-study.pdf');
  submitWp('u_mun_sup', b1);
  T(-16);
  post('u_coord', `/work-packages/${b1}/review`, { decision: 'accept', note: 'الدراسة معتمدة.' });
  T(-15);
  toAwait('u_dig_sup', b2);
  release(b2, 'جاهزة');
  start('u_dig_sup', b2);
  toAwait('u_svc_sup', b3);
  release(b3, 'جاهزة بعد قبول الدراسة');
  T(-8);
  const iss = post('u_dig_sup', `/work-packages/${b2}/issues`, {
    title: 'تأخر تصريح مسار الكابلات من جهة خارجية',
    kind: 'external',
    days: 6,
    proof: 'مخاطبة رقم TEST-0221 بتاريخ الأسبوع الماضي (بيانات تجريبية)',
  }).issue;
  T(-7);
  post('u_coord', `/issues/${iss.id}/decide`, { decision: 'approve', note: 'الدليل موثّق ومرتبط مباشرة بالحزمة.' });
  T(-5);
  go('u_dig_sup', 'PATCH', `/work-packages/${b2}`, { self_pct: 80 });
  T(-4);
  const cr = post('u_svc_sup', `/projects/${B}/change-requests`, {
    reason: 'إعادة جدولة الأعمال الميدانية بسبب ظروف الطقس ومواعيد المقاول.',
    changes: [{ wp_id: b3, planned_end: D(54) }],
  }).change_request;
  T(-3);
  post('u_coord', `/change-requests/${cr.id}/decide`, { decision: 'approve', note: 'مقبول.' });
  post('u_svc_auth', `/change-requests/${cr.id}/decide`, { decision: 'approve', note: 'نوافق على الجدول المعدّل.' });
  T(-12);
  const br1 = mkReq('u_mun_sup', B, {
    title: 'ربط بيانات الطرق بالنظام الرقمي',
    description: 'نطلب ربط بيانات الدراسة بنظام الإدارة الرقمية.',
    required_by: D(12),
    items: [{ title: 'ربط البيانات', spec: '', service_type: 'it_integration' }],
  });
  act('u_mun_sup', br1, 'send-for-approval');
  act('u_mun_auth', br1, 'submit');
  act('u_sec', br1, 'route-to-chair');
  T(-11);
  act('u_chair', br1, 'refer', { target_org_id: 'digital', reason: 'تكامل تقني ضمن اختصاص الإدارة الرقمية.' });
  T(-10);
  act('u_dig_auth', br1, 'acknowledge');
  act('u_dig_auth', br1, 'decide', {
    decision: 'ACCEPT',
    scope_text: 'ربط بيانات الطرق عبر واجهة تبادل آمنة واختبارها.',
    due_on: D(10),
  });
  act('u_dig_sup', br1, 'start-execution');
  const cmb = E.state.commitments.find((c) => c.request_id === br1).id;
  const bt = post('u_dig_sup', `/commitments/${cmb}/internal-tasks`, {
    title: 'تصميم واجهة تبادل البيانات',
    assignee_id: 'u_dig_s1',
    planned_start: D(-9),
    planned_end: D(3),
    est_hours: 22,
  }).task;
  T(-4);
  go('u_dig_s1', 'PATCH', `/tasks/${bt.id}`, { status: 'IN_PROGRESS', completion_pct: 55 });
  T(-2);
  const br2 = mkReq('u_pol_sup', B, {
    title: 'تأمين مسار بديل مؤقت أثناء الأعمال',
    description: 'نحتاج مسارًا بديلًا مؤقتًا لتحويل الحركة.',
    required_by: D(9),
    items: [{ title: 'مسار بديل مؤقت', spec: '', service_type: 'facility_services' }],
  });
  submitFlow(br2, 'u_pol_sup', 'u_pol_auth');
  T(-1);
  act('u_sec', br2, 'route-to-chair');
  act('u_chair', br2, 'refer', { target_org_id: 'services', reason: 'أعمال ميدانية ضمن اختصاص الخدمات العامة.' });

  // ================================================================== Project C — planning (baseline not yet approved)
  T(-21);
  const C = post('u_coord', '/projects', {
    name: 'تطوير خدمات الموارد البشرية',
    objective: 'إعادة تصميم خدمات الموارد البشرية وإطلاقها إلكترونيًا مع الربط المالي.',
    start: D(-20),
    end: D(200),
    org_ids: ['police', 'hr', 'finance', 'digital', 'services'],
    chair_id: 'u_chair',
    deputy_id: 'u_deputy',
    secretary_id: 'u_sec',
  }).project.id;
  T(-20);
  for (const u of ['u_pol_auth', 'u_hr_auth', 'u_fin_auth', 'u_dig_auth'])
    post(u, `/projects/${C}/participation`, { decision: 'accept' });
  T(-19);
  wp('u_coord', C, {
    title: 'تحليل الإجراءات الحالية',
    owner_org_id: 'hr',
    owner_user_id: 'u_hr_sup',
    weight: 20,
    planned_start: D(-19),
    planned_end: D(10),
    criteria: ['تقرير تحليل الإجراءات'],
  });
  wp('u_coord', C, {
    title: 'تصميم الخدمة الإلكترونية الجديدة',
    owner_org_id: 'digital',
    owner_user_id: 'u_dig_sup',
    weight: 30,
    planned_start: D(11),
    planned_end: D(70),
    criteria: ['نموذج الخدمة المعتمد'],
  });
  wp('u_coord', C, {
    title: 'تقدير التكاليف والموازنة',
    owner_org_id: 'finance',
    owner_user_id: 'u_fin_sup',
    weight: 15,
    planned_start: D(11),
    planned_end: D(40),
    criteria: ['تقدير التكاليف المعتمد'],
  });
  wp('u_coord', C, {
    title: 'التجربة والتدريب',
    owner_org_id: 'hr',
    owner_user_id: 'u_hr_sup',
    weight: 20,
    planned_start: D(71),
    planned_end: D(120),
    criteria: ['تقرير التجربة'],
  });
  wp('u_coord', C, {
    title: 'الإطلاق والتسليم',
    owner_org_id: 'police',
    owner_user_id: 'u_pol_sup',
    weight: 15,
    planned_start: D(121),
    planned_end: D(150),
    criteria: ['محضر الإطلاق'],
  });
  T(0, 7);
  const cr1 = mkReq('u_hr_sup', C, {
    title: 'اعتماد تقدير تكاليف الخدمة الإلكترونية',
    description: 'نطلب مراجعة تقدير التكاليف واعتماده مبدئيًا.',
    required_by: D(18),
    items: [{ title: 'مراجعة واعتماد التقدير', spec: '', service_type: 'financial_approval' }],
  });
  act('u_hr_sup', cr1, 'send-for-approval');
  act('u_hr_auth', cr1, 'submit');

  // R9: services accepted but the linked work package has no start order yet -> READY_FOR_RELEASE
  T(-3, 10);
  const r9 = mkReq('u_pol_sup', A, {
    title: 'تجهيز موقع إضافي للمعدات',
    description: 'نحتاج تجهيز موقع إضافي مرتبط بحزمة تجهيز الموقع.',
    required_by: D(40),
    wp_id: a4,
    items: [{ title: 'تجهيز الموقع الإضافي', service_type: 'facility_services', spec: 'وفق مخطط الموقع المرفق.' }],
  });
  submitFlow(r9, 'u_pol_sup', 'u_pol_auth');
  T(-2, 9);
  act('u_sec', r9, 'route-to-chair');
  act('u_chair', r9, 'refer', { target_org_id: 'services', reason: 'تجهيز مواقع ضمن اختصاص الخدمات العامة.' });
  T(-2, 12);
  act('u_svc_auth', r9, 'acknowledge');
  act('u_svc_auth', r9, 'decide', {
    decision: 'ACCEPT',
    scope_text: 'تجهيز الموقع الإضافي وفق المخطط المعتمد دون الأعمال الكهربائية الكبرى.',
  });
  act('u_svc_sup', r9, 'await-release');
  // decisions register & minutes (committee)
  T(-20);
  post('u_sec', `/projects/${A}/decisions`, {
    kind: 'minutes',
    title: 'محضر الاجتماع التنسيقي الأول',
    body: 'اعتماد آلية الطلبات عبر اللجنة، وتأكيد أن الإحالة تنسيقية ولا تُلزم الجهات. حضر ممثلو الجهات المشاركة.',
    meeting_no: 'اجتماع 1/2026',
    meeting_date: D(-20),
  });
  T(-19);
  post('u_chair', `/projects/${A}/decisions`, {
    kind: 'decision',
    title: 'اعتماد مدة الرد المرجعية للطلبات',
    body: 'تُعتمد مدة الرد المرجعية لكل خدمة كما في دليل الاختصاصات، ويكون التجاوز تذكيرًا وتصعيدًا فقط.',
    basis: 'محضر اجتماع 1/2026 — البند 3',
    meeting_no: 'اجتماع 1/2026',
    meeting_date: D(-20),
  });

  // BR3: accepted by digital, blocked, then escalated to the committee -> ESCALATED
  T(-6);
  const br3 = mkReq('u_pol_sup', B, {
    title: 'ربط كاميرات المراقبة بنظام المرور',
    description: 'نطلب ربط كاميرات المراقبة الجديدة بالنظام الرقمي.',
    required_by: D(25),
    items: [{ title: 'ربط الكاميرات', service_type: 'it_integration', spec: 'وفق مواصفات الربط المعتمدة.' }],
  });
  submitFlow(br3, 'u_pol_sup', 'u_pol_auth');
  act('u_sec', br3, 'route-to-chair');
  T(-5);
  act('u_chair', br3, 'refer', { target_org_id: 'digital', reason: 'تكامل تقني ضمن اختصاص الإدارة الرقمية.' });
  act('u_dig_auth', br3, 'acknowledge');
  act('u_dig_auth', br3, 'decide', { decision: 'ACCEPT', scope_text: 'ربط الكاميرات بالنظام دون توريد أجهزة جديدة.' });
  act('u_dig_sup', br3, 'start-execution');
  T(-3);
  act('u_dig_sup', br3, 'block', { reason: 'تأخر وصول بيانات الاعتماد من جهة خارجية (بيانات تجريبية).' });
  T(-2);
  act('u_dig_sup', br3, 'escalate', { reason: 'المعالجة تحتاج تدخل اللجنة مع الجهة الخارجية.' });
  // BR4: returned by the chair to the requester before routing -> RETURNED_TO_REQUESTER
  T(-1, 9);
  const br4 = mkReq('u_pol_sup', B, {
    title: 'تحويلات مرورية مؤقتة',
    description: 'نحتاج تحويلات مرورية مؤقتة.',
    required_by: D(20),
    items: [{ title: 'تحويلات مؤقتة', service_type: 'facility_services', spec: '' }],
  });
  submitFlow(br4, 'u_pol_sup', 'u_pol_auth');
  act('u_sec', br4, 'route-to-chair');
  act('u_chair', br4, 'return-to-requester', { reason: 'حدّدوا المواقع والمدة قبل التوجيه.' });

  // org-internal & direct chats
  T(-5);
  const ot = post('u_fin_sup', '/threads', {
    title: 'فريق المالية — متابعة الالتزامات',
    kind: 'org',
    project_id: A,
    member_ids: ['u_fin_s1', 'u_fin_s2'],
  }).thread;
  post('u_fin_sup', `/threads/${ot.id}/messages`, { text: 'نرجو تحديث نسب الإنجاز قبل نهاية اليوم.' });
  T(-5, 11);
  post('u_fin_s1', `/threads/${ot.id}/messages`, { text: 'تم التحديث، وبقيت مطابقة بند واحد.' });
  T(-3);
  const gt = E.state.threads.find((t) => t.project_id === A && t.kind === 'project' && !t.request_id).id;
  post('u_coord', `/threads/${gt}/messages`, {
    text: 'اعتمدنا خطة المشروع. تذكير: أي تعديل في المواعيد يمر عبر طلب تغيير.',
  });
  T(-3, 12);
  post('u_chair', `/threads/${gt}/messages`, { text: 'أرجو من الجهات متابعة صناديقها الواردة يوميًا.' });

  // connect requests to the work packages they serve (same project), so the demo shows the whole chain: request → package → commitment → tasks → evidence → decisions
  for (const [reqTitle, wpTitle] of [
    ['اعتماد بند الصرف لتجهيز المنشأة', 'الاعتماد المالي وتخصيص الموازنة'],
    ['تجهيز مواقع التخزين المؤقتة', 'تجهيز الموقع وتركيب الأنظمة'],
    ['تأمين موقع إيواء للمعدات', 'تجهيز الموقع وتركيب الأنظمة'],
    ['تصريح التشغيل النهائي للمنشأة', 'الاشتراطات والتصاريح البلدية'],
    ['ربط بيانات الطرق بالنظام الرقمي', 'تحديث البنية التحتية للاتصالات'],
    ['تأمين مسار بديل مؤقت أثناء الأعمال', 'إعادة تأهيل الطرق الفرعية'],
    ['ربط كاميرات المراقبة بنظام المرور', 'تحديث البنية التحتية للاتصالات'],
  ]) {
    const r = S.requests.find((x) => x.title === reqTitle);
    const w = S.workPackages.find((x) => x.title === wpTitle && x.project_id === r?.project_id);
    if (r && w && !r.wp_id) r.wp_id = w.id;
  }

  // finish: real clock, no seed sessions, fresh sla markers preserved
  cur = nowMs;
  E.lastTick = 0;
  E.handle({ method: 'GET', path: '/me', headers: { 'x-session': 'seed' } });
  delete S.sessions.seed;
  S.idem = {};
  S.meta.seeded = true;
  return S;
}
