// Request schemas validated at the API boundary (ARCH-002/005). Single source of truth: the same table feeds scripts/gen-openapi.mjs.
// Scope: structural checks only — type, maximum length, enum, array size, date shape. Business rules (who may do what, state machines, uniqueness)
// stay in the handlers, which keep their specific error codes. Unknown properties are tolerated (forward compatibility) but never read.
// Limits mirror the clean(...) limits used by each handler, so an over-long value is rejected instead of being silently truncated.
const str = (max, o = {}) => ({ type: 'string', max, ...o });
const id = (o = {}) => str(80, o);
const day = { type: 'date' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const arr = (items, max = 50) => ({ type: 'array', items, max });
const obj = (props, o = {}) => ({ type: 'object', props, ...o });

const ITEM = obj({ title: str(160), spec: str(1000), service_type: str(40), quantity: num });

export const SCHEMAS = {
  // --- project-template library (v0.6): structural limits only; plan contents are validated by the template engine ---
  'POST /templates/:id/favorite': obj({ on: bool }),
  'POST /templates/:id/fork': obj({ name: str(140), rev: num }),
  'PATCH /templates/:id': obj({
    name_ar: str(140),
    short_description_ar: str(400),
    plan: obj({ phases: arr(obj({}), 60), tasks: arr(obj({}), 600), org_proposals: arr(obj({}), 60) }),
    rev: num,
  }),
  'POST /templates/:id/publish': obj({ visibility: str(12) }),
  'POST /templates/:id/archive': obj({ archived: bool }),
  'POST /template-drafts': obj({ template_id: str(20), name: str(140), objective: str(1000), start: day }),
  'PATCH /template-drafts/:id': obj({
    version: num,
    name: str(140),
    objective: str(1000),
    start: day,
    calendar: obj({}),
    plan: obj({ phases: arr(obj({}), 60), tasks: arr(obj({}), 600), org_proposals: arr(obj({}), 60) }),
    committee: obj({}),
  }),
  'POST /template-drafts/:id/reset': obj({ version: num, task_id: id(), confirm: bool }),
  'POST /template-drafts/:id/save-as-template': obj({ name: str(140) }),
  'POST /template-drafts/:id/instantiate': obj({ version: num }),
  'POST /auth/login': obj({ user_id: id() }),
  'POST /interagency-requests': obj({
    project_id: id(),
    wp_id: id(),
    title: str(160),
    description: str(3000),
    required_by: day,
    impact_text: str(600),
    service_type: str(40),
    items: arr(ITEM, 8),
  }),
  'PATCH /interagency-requests/:id': obj({
    title: str(160),
    description: str(3000),
    impact_text: str(600),
    required_by: day,
    items: arr(ITEM, 8),
    request_version: num,
  }),
  'POST /interagency-requests/:id/notes': obj({ text: str(3000) }),
  'POST /threads': obj({ kind: str(20), project_id: id(), wp_id: id(), title: str(120), member_ids: arr(id(), 40) }),
  'POST /threads/:id/messages': obj({ text: str(3000), file_ids: arr(id(), 5), mentions: arr(id(), 20) }),
  'POST /projects': obj({
    name: str(140),
    start: day,
    end: day,
    org_ids: arr(id(), 40),
    chair_id: id(),
    deputy_id: id(),
    secretary_id: id(),
  }),
  'POST /projects/:id/work-packages': obj({
    title: str(140),
    owner_org_id: id(),
    owner_user_id: id(),
    planned_start: day,
    planned_end: day,
    weight: num,
  }),
  'POST /projects/:id/decisions': obj({
    kind: str(12),
    title: str(200),
    body: str(3000),
    basis: str(300),
    meeting_no: str(40),
    meeting_date: day,
    request_id: id(),
  }),
  'POST /decisions/:id/close': obj({ note: str(1000) }),
  'POST /tasks': obj({ project_id: id(), commitment_id: id(), title: str(160), assignee_id: id(), due: day }),
  'PUT /me/contact': obj({ email: str(120), phone: str(24), notify_email: bool, notify_sms: bool }),
  'PUT /system/notice': obj({ text: str(280), level: str(12) }),
  'POST /admin/delegations': obj({
    user_id: id(),
    basis: str(300),
    valid_to: day,
    max_amount: num,
    projects: arr(id(), 50),
  }),
  // --- workflow and administration actions (second batch) ---
  'PUT /me/prefs': obj({
    last_project: id(),
    pinned: arr(id(), 12),
    widgets: obj({ order: arr(id(), 30), hidden: arr(id(), 30) }),
    dismissed_guide: bool,
  }),
  'POST /notifications/read': obj({ ids: arr(id(), 500) }),
  'POST /system/outbound/retry-failed': obj({}),
  'POST /admin/delegations/:id/revoke': obj({ reason: str(300) }),
  'PATCH /admin/competencies/:id': obj({
    acceptance_authority: str(160),
    reason: str(300),
    sla_hours: num,
    valid_from: day,
    valid_to: day,
    substitute_org_id: id(),
  }),
  'POST /projects/:id/participation': obj({ reason: str(500), decision: str(20) }),
  'PATCH /work-packages/:id': obj({
    owner_user_id: id(),
    owner_org_id: id(),
    title: str(140),
    description: str(1000),
    self_pct: num,
    weight: num,
    planned_start: day,
    planned_end: day,
    depends_on: arr(id(), 30),
    criteria: arr(str(200), 10),
    required_evidence: num,
  }),
  'POST /work-packages/:id/transition': obj({ to: str(30) }),
  'POST /work-packages/:id/release': obj({ note: str(500) }),
  'POST /work-packages/:id/evidence': obj({
    title: str(140),
    kind: str(12),
    file_id: id(),
    file_name: str(160),
    note: str(500),
    size: num,
  }),
  'POST /work-packages/:id/review': obj({ decision: str(20), note: str(800) }),
  'POST /work-packages/:id/issues': obj({ title: str(160), kind: str(12), proof: str(600), days: num, blocking: bool }),
  'POST /issues/:id/decide': obj({ decision: str(20), note: str(500) }),
  'POST /projects/:id/change-requests': obj({ reason: str(800), changes: arr(obj({}), 50) }),
  'POST /change-requests/:id/decide': obj({ decision: str(20), note: str(500) }),
  'PATCH /tasks/:id': obj({
    title: str(160),
    description: str(1200),
    assignee_id: id(),
    status: str(30),
    priority: str(20),
    completion_pct: num,
    planned_end: day,
    version: num,
    shared_progress_note: str(400),
    private_notes: str(1200),
  }),
  'POST /commitments/:id/updates': obj({ note: str(500) }),
  'POST /interagency-requests/:id/evidence': obj({
    title: str(160),
    file_id: id(),
    file_name: str(160),
    note: str(500),
    shared: bool,
    size: num,
  }),
  'POST /interagency-requests/:id/dispute': obj({ reason: str(1000) }),
  'POST /interagency-requests/:id/opinion': obj({ opinion: str(2000) }),
  'POST /files': obj({ project_id: id(), name: str(255), content_base64: str(6000000), supersedes_file_id: id() }),
  'POST /files/:id/grants': obj({ grantee_type: str(12), grantee_id: id(), reason: str(300) }),
  'POST /admin/break-glass': obj({ project_id: id(), reason: str(600), duration_hours: num }),
  'POST /admin/break-glass/:id/approve': obj({ note: str(300) }),
  'POST /admin/break-glass/:id/revoke': obj({ reason: str(300) }),
  'POST /auth/password': obj({ username: str(80), password: str(200), otp: str(12) }),
  'POST /auth/reauth': obj({ password: str(200), otp: str(12) }),
  'POST /me/password': obj({ current: str(200), next: str(200) }),
  'POST /me/mfa/enable': obj({ code: str(12) }),
  'POST /me/mfa/disable': obj({ password: str(200), code: str(12) }),
  'POST /org/members': obj({
    name: str(80),
    title: str(80),
    roles: arr(str(40), 10),
    capacity_week: num,
    issue_password: bool,
  }),
  // generic workflow action endpoint: one schema for the union of fields the request actions read (each action reads only its own subset)
  'POST /interagency-requests/:id/:action': obj({
    request_version: num,
    reason: str(1500),
    reason_text: str(1500),
    reason_code: str(40),
    response_text: str(2000),
    review_note: str(1000),
    note: str(800),
    missing_text: str(800),
    missing_items: arr(undefined, 20),
    scope_text: str(2000),
    new_scope: str(2000),
    reference_document: str(200),
    conditions: str(1000),
    title: str(160),
    description: str(3000),
    impact_text: str(600),
    decision: str(20),
    required_by: day,
    due_on: day,
    target_org_id: id(),
    candidate_org_id: id(),
    change_request_id: id(),
    contact_user_id: id(),
    wp_id: id(),
    project_id: id(),
    file_id: id(),
    file_name: str(160),
    estimated_value: num,
    items: arr(ITEM, 8),
    attachments: arr(undefined, 20),
  }),
  'POST /commitments/:id/internal-tasks': obj({
    title: str(160),
    description: str(1200),
    assignee_id: id(),
    due: day,
    planned_end: day,
    priority: str(20),
    est_hours: num,
  }),
  'PATCH /org/members/:id': obj({
    title: str(80),
    reason: str(300),
    roles: arr(str(40), 10),
    capacity_week: num,
    active: bool,
  }),
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const label = (t) =>
  ({ string: 'نص', number: 'رقم', boolean: 'نعم/لا', array: 'قائمة', object: 'كائن', date: 'تاريخ بصيغة YYYY-MM-DD' })[
    t
  ] || t;

function check(s, v, path, out) {
  if (v === undefined || v === null || v === '') return; // presence is a business rule (handlers return MISSING_* with their own message)
  switch (s.type) {
    case 'string':
      if (typeof v !== 'string') return void (out[path] = `القيمة يجب أن تكون ${label('string')}`);
      if (s.max && v.length > s.max) out[path] = `الحد الأقصى ${s.max} حرفًا`;
      break;
    case 'number':
      if (typeof v !== 'number' && !(typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))))
        out[path] = `القيمة يجب أن تكون ${label('number')}`;
      break;
    case 'boolean':
      if (typeof v !== 'boolean') out[path] = `القيمة يجب أن تكون ${label('boolean')}`;
      break;
    case 'date':
      if (typeof v !== 'string' || !DAY.test(v)) out[path] = `القيمة يجب أن تكون ${label('date')}`;
      break;
    case 'array':
      if (!Array.isArray(v)) return void (out[path] = `القيمة يجب أن تكون ${label('array')}`);
      if (s.max && v.length > s.max) return void (out[path] = `الحد الأقصى ${s.max} عنصرًا`);
      if (s.items) v.forEach((x, i) => check(s.items, x, `${path}[${i}]`, out));
      break;
    case 'object':
      if (typeof v !== 'object' || Array.isArray(v)) return void (out[path] = `القيمة يجب أن تكون ${label('object')}`);
      for (const [k, sub] of Object.entries(s.props || {})) check(sub, v[k], path ? `${path}.${k}` : k, out);
      break;
  }
}

/** Returns {} when valid, otherwise { field: message }. */
export function validateBody(key, body) {
  const s = SCHEMAS[key];
  if (!s) return {};
  const out = {};
  check(s, body, '', out);
  return out;
}
