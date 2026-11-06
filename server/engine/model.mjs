// Constants and Arabic labels shared by the engine and the UI.

export const REQUEST_STATUS = {
  DRAFT: { ar: 'مسودة', tone: 'neutral' },
  PENDING_REQUESTER_APPROVAL: { ar: 'بانتظار اعتماد الجهة الطالبة', tone: 'attention' },
  SUBMITTED_TO_COMMITTEE: { ar: 'لدى اللجنة — بانتظار الفرز', tone: 'info' },
  NEEDS_INFORMATION: { ar: 'مطلوب استكمال', tone: 'attention' },
  PENDING_CHAIR_ROUTING: { ar: 'بانتظار توجيه الرئيس', tone: 'info' },
  REFERRED_TO_ORG: { ar: 'محال إلى الجهة المختصة', tone: 'info' },
  UNDER_ORG_REVIEW: { ar: 'قيد دراسة الجهة', tone: 'info' },
  COUNTERPROPOSAL: { ar: 'مقترح بديل', tone: 'attention' },
  DECLINED_WITH_REASON: { ar: 'اعتذار مسبَّب', tone: 'danger' },
  REOPEN_REQUESTED: { ar: 'طلب إعادة نظر', tone: 'attention' },
  ACCEPTED_BY_ORG: { ar: 'التزام مقبول من الجهة', tone: 'success' },
  READY_FOR_RELEASE: { ar: 'بانتظار تصريح البدء', tone: 'attention' },
  IN_EXECUTION: { ar: 'قيد التنفيذ', tone: 'progress' },
  BLOCKED: { ar: 'متوقف بعائق', tone: 'danger' },
  ESCALATED: { ar: 'مُصعَّد إلى اللجنة', tone: 'danger' },
  CHANGE_REQUESTED: { ar: 'بانتظار قرار تغيير', tone: 'attention' },
  RETURNED_TO_REQUESTER: { ar: 'أُعيد للجهة الطالبة', tone: 'attention' },
  ORG_SUBMITTED: { ar: 'مسلَّم للمراجعة', tone: 'attention' },
  RETURNED_FOR_CORRECTION: { ar: 'أُعيد للتصحيح', tone: 'attention' },
  ACCEPTED_DELIVERABLE: { ar: 'مخرج مقبول', tone: 'success' },
  CLOSED_COMPLETED: { ar: 'مغلق — منجز', tone: 'done' },
  CLOSED_DECLINED: { ar: 'مغلق — بعد اعتذار', tone: 'done' },
  WITHDRAWN: { ar: 'مسحوب', tone: 'done' },
  CANCELLED: { ar: 'ملغى', tone: 'done' },
  SPLIT: { ar: 'مفكَّك إلى طلبات فرعية', tone: 'done' },
};

export const TERMINAL = ['CLOSED_COMPLETED', 'CLOSED_DECLINED', 'WITHDRAWN', 'CANCELLED', 'SPLIT'];

export const WP_STATUS = {
  DRAFT: { ar: 'مسودة', tone: 'neutral' },
  AWAITING_RELEASE: { ar: 'بانتظار تصريح البدء', tone: 'attention' },
  RELEASED: { ar: 'جاهز للبدء', tone: 'info' },
  IN_EXECUTION: { ar: 'قيد التنفيذ', tone: 'progress' },
  ORG_SUBMITTED: { ar: 'قيد المراجعة', tone: 'attention' },
  ACCEPTED: { ar: 'مقبول', tone: 'success' },
  CLOSED: { ar: 'مغلق', tone: 'done' },
};
export const WP_ORDER = [
  'DRAFT',
  'AWAITING_RELEASE',
  'RELEASED',
  'IN_EXECUTION',
  'ORG_SUBMITTED',
  'ACCEPTED',
  'CLOSED',
];

export const TASK_STATUS = {
  TODO: { ar: 'للتنفيذ', tone: 'neutral' },
  READY: { ar: 'جاهزة للبدء', tone: 'info' },
  IN_PROGRESS: { ar: 'قيد العمل', tone: 'progress' },
  WAITING_EXTERNAL: { ar: 'بانتظار طرف آخر', tone: 'attention' },
  UNDER_INTERNAL_REVIEW: { ar: 'مراجعة داخلية', tone: 'info' },
  DONE_INTERNAL: { ar: 'مكتمل داخليًا', tone: 'success' },
  CANCELLED: { ar: 'ملغى', tone: 'done' },
};
export const TASK_ORDER = [
  'TODO',
  'READY',
  'IN_PROGRESS',
  'WAITING_EXTERNAL',
  'UNDER_INTERNAL_REVIEW',
  'DONE_INTERNAL',
];

export const REASON_CODES = {
  OUT_OF_SCOPE: 'خارج الاختصاص',
  MISSING_DOCS: 'نقص مستندات جوهري',
  LEGAL_CONFLICT: 'تضارب مع سند نظامي',
  NO_BUDGET: 'عدم توفر اعتماد أو موارد',
  SCHEDULE_CONFLICT: 'تعارض مع جدول معتمد',
  LEGAL_RISK: 'مخاطر قانونية',
  TECHNICAL_INFEASIBLE: 'تعذر فني',
  DUPLICATE: 'طلب مكرر',
  OTHER: 'سبب آخر (يُشرح في النص)',
};

// CNT-006: the published service descriptions (service types and request templates) are versioned and dated. Editorial/legal approval is the owner's act (handover/APPROVALS.md).
export const SERVICE_CATALOG = {
  version: '1.0',
  updated: '2026-11-05',
  status: 'draft_pending_owner_approval',
  status_ar: 'مسودة بانتظار اعتماد المالك',
};
export const SERVICE_TYPES = {
  supplier_provisioning: 'توفير مورد',
  contract_execution: 'إبرام وتوقيع عقد',
  financial_approval: 'اعتماد مالي',
  budget_allocation: 'تخصيص موازنة',
  facility_services: 'خدمات منشآت وصيانة',
  hr_services: 'خدمات موارد بشرية',
  it_integration: 'تكامل وحلول تقنية',
  municipal_permits: 'تصاريح واشتراطات بلدية',
  legal_review: 'مراجعة قانونية',
  other: 'خدمة أخرى',
};

export const ROLE_LABEL = {
  SUPER_ADMIN: 'مشغّل المنصة (تقني)',
  PLATFORM_OWNER_ADMIN: 'مالك المنصة',
  COORDINATING_ADMIN: 'منسّق المشروع',
  ORG_ADMIN: 'مدير الجهة',
  ORG_SUPERVISOR: 'مشرف',
  ORG_EXECUTIVE: 'منفّذ',
  INDEPENDENT_REVIEWER: 'مرجع مستقل',
  FINAL_AUDITOR: 'مدقق',
  SCOPED_VIEWER: 'اطلاع',
  TEMPLATE_CATALOG_EDITOR: 'محرّر نماذج الجهة',
  TEMPLATE_REVIEWER: 'مراجع نماذج الجهة',
};

export const DELEGATION_LABEL = {
  submit_request: 'اعتماد وإرسال طلبات الجهة',
  commit: 'قبول أو رفض التزامات الجهة',
  route: 'إحالة الطلبات إلى الجهات المختصة',
  close_request: 'إغلاق الطلبات إداريًا',
  release: 'إصدار تصريح بدء حزم العمل',
  accept_deliverable: 'قبول المخرجات',
  approve_change: 'اعتماد طلبات التغيير',
};

export const COMMITTEE_ROLE_LABEL = {
  chair: 'رئيس اللجنة',
  deputy: 'نائب الرئيس',
  secretary: 'أمين اللجنة',
  member: 'عضو لجنة',
};

// Where the request currently "sits" — drives the journey track in the UI.
export const STAGES = ['requester', 'committee', 'org', 'execution', 'closing'];
export const STAGE_LABEL = {
  requester: 'الجهة الطالبة',
  committee: 'اللجنة',
  org: 'الجهة المختصة',
  execution: 'التنفيذ',
  closing: 'الاستلام والإغلاق',
};

export const STATUS_STAGE = {
  DRAFT: 'requester',
  PENDING_REQUESTER_APPROVAL: 'requester',
  NEEDS_INFORMATION: 'requester',
  SUBMITTED_TO_COMMITTEE: 'committee',
  PENDING_CHAIR_ROUTING: 'committee',
  REFERRED_TO_ORG: 'org',
  UNDER_ORG_REVIEW: 'org',
  COUNTERPROPOSAL: 'org',
  DECLINED_WITH_REASON: 'org',
  REOPEN_REQUESTED: 'org',
  ACCEPTED_BY_ORG: 'execution',
  READY_FOR_RELEASE: 'execution',
  IN_EXECUTION: 'execution',
  BLOCKED: 'execution',
  ESCALATED: 'execution',
  CHANGE_REQUESTED: 'execution',
  RETURNED_FOR_CORRECTION: 'execution',
  RETURNED_TO_REQUESTER: 'requester',
  ORG_SUBMITTED: 'closing',
  ACCEPTED_DELIVERABLE: 'closing',
  CLOSED_COMPLETED: 'closing',
  CLOSED_DECLINED: 'org',
  WITHDRAWN: 'requester',
  CANCELLED: 'requester',
  SPLIT: 'committee',
};

// FR-REQ-017 — request templates. Pre-fill items and service types only; nothing here is binding on any organisation.
export const REQUEST_TEMPLATES = [
  {
    key: 'supplier',
    label: 'توفير مورد',
    title: 'توفير مورد للمستلزمات المحددة',
    items: [
      {
        title: 'اختيار/اعتماد المورد',
        service_type: 'supplier_provisioning',
        spec: 'المواصفات والكميات المطلوبة وفق المرفق.',
      },
    ],
  },
  {
    key: 'contract',
    label: 'عقد',
    title: 'استكمال إجراءات التعاقد',
    items: [
      { title: 'إبرام العقد', service_type: 'contract_execution', spec: 'نطاق العقد ومدته وفق المواصفات المعتمدة.' },
    ],
  },
  {
    key: 'supplier_contract',
    label: 'مورد + عقد (طلب مركّب)',
    title: 'توفير مورد واستكمال إجراءات التعاقد',
    items: [
      { title: 'اختيار/اعتماد المورد', service_type: 'supplier_provisioning', spec: '' },
      { title: 'استكمال التعاقد', service_type: 'contract_execution', spec: '' },
    ],
  },
  {
    key: 'approval',
    label: 'اعتماد مالي',
    title: 'اعتماد بند صرف / تخصيص موازنة',
    items: [{ title: 'الاعتماد المالي', service_type: 'financial_approval', spec: '' }],
  },
  {
    key: 'engineering',
    label: 'هندسة وتكامل تقني',
    title: 'دعم هندسي / تكامل تقني',
    items: [{ title: 'التكامل التقني', service_type: 'it_integration', spec: '' }],
  },
  {
    key: 'maintenance',
    label: 'صيانة وخدمات منشآت',
    title: 'خدمات صيانة وتجهيز موقع',
    items: [{ title: 'تجهيز/صيانة الموقع', service_type: 'facility_services', spec: '' }],
  },
  {
    key: 'hr',
    label: 'موارد بشرية',
    title: 'خدمة موارد بشرية',
    items: [{ title: 'الخدمة المطلوبة', service_type: 'hr_services', spec: '' }],
  },
];

/** Chat channel kinds (blueprint: 1:1, team, organisation, project, request, work package, platform support). */
export const THREAD_KINDS = {
  direct: 'محادثة فردية',
  team: 'فريق داخل الجهة',
  org: 'قناة الجهة كاملة',
  project: 'قناة المشروع',
  request: 'محادثة طلب',
  wp: 'حزمة عمل',
  support: 'دعم المنصة',
};
