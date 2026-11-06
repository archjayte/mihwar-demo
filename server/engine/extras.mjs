// MIHWAR engine extras: scoped evidence files + grants, committee decisions & minutes, committee workspace,
// request templates, history/deliverable aliases (spec §10), break-glass, sessions, restricted exports, outbox.
import { fail, clean, isDay, uniq, sha256, sha256Bytes, b64decode, diffDays } from './util.mjs';
import * as M from './model.mjs';

export const MAX_FILE_BYTES = 3 * 1024 * 1024;
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const TYPES = {
  pdf: { mime: 'application/pdf', magic: [[0x25, 0x50, 0x44, 0x46]] },
  png: { mime: 'image/png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: 'image/jpeg', magic: [[0xff, 0xd8, 0xff]] },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  txt: { mime: 'text/plain; charset=utf-8', text: true },
  csv: { mime: 'text/csv; charset=utf-8', text: true },
};
const DANGEROUS = /\.(exe|dll|bat|cmd|com|scr|msi|ps1|vbs|js|mjs|jar|sh|php|py|html?|svg|xml|hta|lnk)(\.|$)/i;

export function memoryBlobs() {
  const m = new Map();
  return {
    put: (k, d) => {
      m.set(k, d);
    },
    get: (k) => m.get(k) || null,
    del: (k) => {
      m.delete(k);
    },
  };
}

export function registerExtras(E) {
  const S = E.state;
  for (const k of ['files', 'fileGrants', 'decisions', 'breakGlass', 'outbox', 'orgUnits']) if (!S[k]) S[k] = [];

  // ------------------------------------------------------------------ files
  E.file = (id) => S.files.find((f) => f.id === id);
  const projectOf = (f) => (f.project_id ? E.project(f.project_id) : null);
  const grantMatches = (u, g) => {
    if (g.revoked) return false;
    if (g.grantee_type === 'user') return g.grantee_id === u.id;
    if (g.grantee_type === 'org') return g.grantee_id === u.org_id;
    const p = E.project(g.project_id);
    if (g.grantee_type === 'committee') return !!p && !!E.committeeRole(u, p);
    if (g.grantee_type === 'role') return E.hasRole(u, g.grantee_id) && !!p && E.access(u, p) !== 'none';
    return false;
  };
  E.canReadFile = (u, f) => {
    if (!f || f.deleted) return false;
    if (E.hasRole(u, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN')) return false;
    if (u.org_id === f.owner_org_id) return true;
    return S.fileGrants.some((g) => g.file_id === f.id && grantMatches(u, g));
  };
  const addGrant = (f, type, id, by, reason) => {
    if (S.fileGrants.some((g) => g.file_id === f.id && g.grantee_type === type && g.grantee_id === id && !g.revoked))
      return null;
    const g = {
      id: E.id('grt'),
      file_id: f.id,
      project_id: f.project_id,
      grantee_type: type,
      grantee_id: id,
      granted_by: by?.id || null,
      at: E.iso(),
      reason: reason || '',
      revoked: false,
    };
    S.fileGrants.push(g);
    return g;
  };
  E.addGrant = addGrant;
  E.fileView = (u, f) => ({
    id: f.id,
    name: f.name,
    size: f.size,
    mime: f.mime,
    sha256: f.sha256,
    version: f.version,
    supersedes: f.supersedes || null,
    superseded: !!f.superseded_by,
    owner_org_id: f.owner_org_id,
    owner_org_name: E.oname(f.owner_org_id),
    uploaded_by_name: E.uname(f.uploaded_by),
    uploaded_at: f.at,
    project_id: f.project_id,
    mine_org: u.org_id === f.owner_org_id,
    can_manage_grants: u.org_id === f.owner_org_id && E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN'),
  });
  const sanitizeName = (n) => clean(String(n || '').replace(/[\\/\u0000-\u001f<>:"|?*]+/g, '_'), 120);
  // Built-in heuristic scanner (NOT a substitute for a real antivirus engine; an external scanner can be injected via E.scanner).
  const latin = (bytes) => new TextDecoder('latin1').decode(bytes);
  const zipEntries = (bytes) => {
    let e = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 5 && bytes[i + 3] === 6) {
        e = i;
        break;
      }
    if (e < 0) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let n = dv.getUint16(e + 10, true);
    let off = dv.getUint32(e + 16, true);
    const out = [];
    while (n-- > 0 && off + 46 <= bytes.length && dv.getUint32(off, true) === 0x02014b50) {
      const csize = dv.getUint32(off + 20, true);
      const usize = dv.getUint32(off + 24, true);
      const nl = dv.getUint16(off + 28, true);
      const xl = dv.getUint16(off + 30, true);
      const cl = dv.getUint16(off + 32, true);
      out.push({ name: new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nl)), csize, usize });
      off += 46 + nl + xl + cl;
    }
    return out;
  };
  const SCRIPT_EXT = /\.(exe|dll|scr|com|bat|cmd|ps1|vbs|vbe|js|jse|wsf|msi|jar|lnk|hta|sh)$/i;
  E.heuristicScan = (ext, bytes) => {
    const hits = [];
    const head = latin(bytes.subarray(0, Math.min(bytes.length, 1 << 20)));
    if (ext === 'pdf') {
      const m = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/.exec(head);
      if (m) hits.push(`PDF active content /${m[1]}`);
    }
    if (ext === 'docx' || ext === 'xlsx') {
      const z = zipEntries(bytes);
      if (!z) hits.push('OOXML container is not a valid ZIP');
      else {
        let total = 0;
        for (const f of z) {
          total += f.usize;
          if (/vbaProject\.bin$/i.test(f.name) || /(^|\/)macros?\//i.test(f.name)) hits.push(`macro: ${f.name}`);
          if (/activeX/i.test(f.name)) hits.push(`ActiveX: ${f.name}`);
          if (SCRIPT_EXT.test(f.name)) hits.push(`embedded executable/script: ${f.name}`);
          if (f.csize > 0 && f.usize / f.csize > 300 && f.usize > 5e6)
            hits.push(`suspicious compression ratio: ${f.name}`);
        }
        if (total > 150e6) hits.push('declared uncompressed size is too large (zip bomb)');
      }
    }
    if (['png', 'jpg', 'jpeg'].includes(ext)) {
      const tail = latin(bytes.subarray(Math.max(0, bytes.length - 4096)));
      if (/<script|<\?php|<svg[ >]/i.test(head + tail)) hits.push('script or markup hidden inside an image');
    }
    if (/MZ[\s\S]{0,120}This program cannot be run in DOS mode/.test(head) && ext !== 'exe')
      hits.push('Windows executable inside the file');
    if (bytes.length > 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46)
      hits.push('ELF executable');
    if ((ext === 'csv' || ext === 'txt') && /(^|\n)\s*[=+@-]\s*(cmd|powershell|mshta|DDE)\b/i.test(head))
      hits.push('spreadsheet command-injection (DDE) pattern');
    return hits;
  };
  const checkContent = (name, bytes) => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!name.includes('.') || !TYPES[ext])
      fail(422, 'FILE_TYPE_NOT_ALLOWED', `نوع الملف غير مسموح. المسموح: ${Object.keys(TYPES).join('، ')}`);
    if (DANGEROUS.test(name)) fail(422, 'FILE_TYPE_NOT_ALLOWED', 'اسم الملف يحتوي امتدادًا تنفيذيًا غير مسموح');
    if (!bytes.length) fail(422, 'EMPTY_FILE', 'الملف فارغ');
    if (bytes.length > MAX_FILE_BYTES)
      fail(413, 'FILE_TOO_LARGE', `الحد الأقصى لحجم الملف ${Math.round(MAX_FILE_BYTES / 1048576)} م.ب`);
    const t = TYPES[ext];
    if (t.magic && !t.magic.some((m) => m.every((b, i) => bytes[i] === b)))
      fail(422, 'FILE_CONTENT_MISMATCH', 'محتوى الملف لا يطابق امتداده');
    if (t.text) {
      if (bytes.subarray(0, 4096).includes(0)) fail(422, 'FILE_CONTENT_MISMATCH', 'الملف النصي يحتوي بيانات ثنائية');
    }
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
    if (head.includes(EICAR)) fail(422, 'MALWARE_SIGNATURE', 'رُفض الملف: توقيع اختبار برمجية خبيثة (EICAR)');
    const hits = E.heuristicScan(ext, bytes);
    if (hits.length)
      fail(422, 'MALWARE_HEURISTIC', `رُفض الملف: محتوى نشط أو مشبوه (${hits[0]})`, { findings: hits.slice(0, 5) });
    if (E.scanner) {
      let r;
      try {
        r = E.scanner(name, bytes);
      } catch {
        fail(503, 'SCANNER_UNAVAILABLE', 'تعذّر فحص الملف الآن؛ لم يُقبل');
      }
      if (r?.infected) fail(422, 'MALWARE_SIGNATURE', `رُفض الملف: كشف الماسح توقيعًا (${r.signature || 'غير مسمّى'})`);
    }
    return { ext, mime: t.mime };
  };

  E.route('POST', '/files', (ctx) => {
    const u = ctx.user;
    const b = ctx.body;
    if (E.hasRole(u, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN', 'SCOPED_VIEWER', 'FINAL_AUDITOR'))
      fail(403, 'NO_PERMISSION', 'رفع الملفات لأعضاء الجهات المشاركة');
    const p = E.project(clean(b.project_id, 40));
    if (!p || E.access(u, p) !== 'member') fail(404, 'NOT_FOUND', 'المشروع غير موجود أو لا تملك صلاحية الاطلاع عليه');
    const name = sanitizeName(b.name);
    if (!name) fail(422, 'MISSING_TITLE', 'اسم الملف مطلوب');
    let bytes;
    try {
      bytes = b64decode(b.content_base64);
    } catch {
      fail(422, 'BAD_CONTENT', 'محتوى الملف غير صالح');
    }
    const { mime } = checkContent(name, bytes);
    let prev = null;
    if (b.supersedes_file_id) {
      prev = E.file(clean(b.supersedes_file_id, 40));
      if (!prev || prev.owner_org_id !== u.org_id) fail(404, 'NOT_FOUND', 'الملف السابق غير موجود');
    }
    const key = E.token();
    E.blobs.put(key, bytes);
    const f = {
      id: E.id('fil'),
      name,
      mime,
      size: bytes.length,
      sha256: sha256Bytes(bytes),
      storage_key: key,
      owner_org_id: u.org_id,
      project_id: p.id,
      uploaded_by: u.id,
      at: E.iso(),
      version: prev ? prev.version + 1 : 1,
      supersedes: prev?.id || null,
      deleted: false,
      attached: false,
    };
    S.files.push(f);
    if (prev) prev.superseded_by = f.id;
    E.audit({
      actor_id: u.id,
      action: 'file.upload',
      object_type: 'file',
      object_id: f.id,
      project_id: p.id,
      detail: `${f.name} (${f.size}B)`,
      reason: f.sha256.slice(0, 16),
    });
    ctx.status = 201;
    return { file: E.fileView(u, f) };
  });

  const needFile = (ctx) => {
    const f = E.file(ctx.params.id);
    if (!f || !E.canReadFile(ctx.user, f)) {
      if (f)
        E.audit({
          actor_id: ctx.user.id,
          action: 'denied:file.access',
          object_type: 'file',
          object_id: f.id,
          project_id: f.project_id,
          outcome: 'denied',
          reason: 'NO_GRANT',
        });
      fail(404, 'NOT_FOUND', 'الملف غير موجود أو لا تملك منحة الاطلاع عليه');
    }
    return f;
  };
  E.route('GET', '/files/:id', (ctx) => ({ file: E.fileView(ctx.user, needFile(ctx)) }));
  E.route('GET', '/files/:id/download', (ctx) => {
    const f = needFile(ctx);
    const data = E.blobs.get(f.storage_key);
    if (!data) fail(410, 'FILE_MISSING', 'محتوى الملف غير متوفر في هذه البيئة');
    E.audit({
      actor_id: ctx.user.id,
      action: 'file.download',
      object_type: 'file',
      object_id: f.id,
      project_id: f.project_id,
      detail: f.name,
    });
    return { __binary: { data, mime: f.mime, filename: f.name } };
  });
  E.route('GET', '/files/:id/grants', (ctx) => {
    const f = needFile(ctx);
    if (f.owner_org_id !== ctx.user.org_id) fail(403, 'NO_PERMISSION', 'سجل المنح لجهة مالكة الملف');
    return {
      items: S.fileGrants
        .filter((g) => g.file_id === f.id)
        .map((g) => ({
          ...g,
          grantee_label:
            g.grantee_type === 'org'
              ? E.oname(g.grantee_id)
              : g.grantee_type === 'user'
                ? E.uname(g.grantee_id)
                : g.grantee_type === 'committee'
                  ? 'لجنة المشروع'
                  : 'مدققو المشروع',
          by_name: E.uname(g.granted_by),
        })),
    };
  });
  E.route('POST', '/files/:id/grants', (ctx) => {
    const u = ctx.user;
    const f = needFile(ctx);
    const b = ctx.body;
    if (f.owner_org_id !== u.org_id || !E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN'))
      fail(403, 'WRONG_ORGANIZATION', 'منح الاطلاع لمشرف الجهة المالكة للملف', { project_id: f.project_id });
    const type = clean(b.grantee_type, 12);
    const id = clean(b.grantee_id, 40);
    const reason = clean(b.reason, 300);
    if (!['org', 'user', 'committee'].includes(type)) fail(422, 'BAD_GRANTEE', 'نوع المستفيد غير صالح');
    if (!reason) fail(422, 'MISSING_REASON', 'اكتب سبب منح الاطلاع');
    const p = projectOf(f);
    if (type === 'org' && !(E.org(id) && p?.org_ids.includes(id)))
      fail(422, 'BAD_GRANTEE', 'جهة غير مشاركة في المشروع');
    if (type === 'user' && !(E.user(id) && E.projectMembers(p).includes(id)))
      fail(422, 'BAD_GRANTEE', 'مستخدم من خارج المشروع');
    const g = addGrant(f, type, type === 'committee' ? p.id : id, u, reason);
    if (g)
      E.audit({
        actor_id: u.id,
        action: 'file.grant',
        object_type: 'file',
        object_id: f.id,
        project_id: f.project_id,
        detail: `${type}:${g.grantee_id}`,
        reason,
      });
    ctx.status = 201;
    return { granted: !!g };
  });
  E.route('POST', '/files/:id/grants/:gid/revoke', (ctx) => {
    const u = ctx.user;
    const f = needFile(ctx);
    const g = S.fileGrants.find((x) => x.id === ctx.params.gid && x.file_id === f.id);
    if (f.owner_org_id !== u.org_id || !E.hasRole(u, 'ORG_SUPERVISOR', 'ORG_ADMIN'))
      fail(403, 'WRONG_ORGANIZATION', 'سحب المنح لمشرف الجهة المالكة للملف', { project_id: f.project_id });
    if (!g) fail(404, 'NOT_FOUND', 'المنحة غير موجودة');
    g.revoked = true;
    E.audit({
      actor_id: u.id,
      action: 'file.revoke',
      object_type: 'file',
      object_id: f.id,
      project_id: f.project_id,
      detail: `${g.grantee_type}:${g.grantee_id}`,
    });
    return { ok: true };
  });

  /** Called by the evidence endpoints: validates the uploaded file belongs to the actor's org and applies explicit grants. */
  E.useFileAsEvidence = (u, fileId, { project, shared, extraUserIds = [], grantOrgIds = [] }) => {
    const f = E.file(clean(fileId, 40));
    if (!f || f.owner_org_id !== u.org_id || f.project_id !== project.id)
      fail(404, 'NOT_FOUND', 'الملف غير موجود — ارفعه أولًا من جهتك');
    f.attached = true;
    if (shared) {
      for (const o of uniq(grantOrgIds).filter((x) => x !== u.org_id && project.org_ids.includes(x)))
        addGrant(f, 'org', o, u, 'دليل مشترك');
      addGrant(f, 'committee', project.id, u, 'دليل مشترك مع لجنة المشروع');
      addGrant(f, 'role', 'FINAL_AUDITOR', u, 'دليل مشترك للتدقيق');
      for (const id of uniq(extraUserIds)) addGrant(f, 'user', id, u, 'دليل مشترك مع مفوّض القبول');
    }
    return f;
  };

  // ------------------------------------------------------------------ decisions & minutes (committee register)
  const decRef = (p) => E.refNo('DEC', p.ref);
  E.recordDecision = (p, o) => {
    const d = {
      id: E.id('dcs'),
      ref: decRef(p),
      project_id: p.id,
      kind: o.kind,
      title: clean(o.title, 200),
      body: clean(o.body, 3000),
      basis: clean(o.basis, 300),
      meeting_no: clean(o.meeting_no, 40),
      meeting_date: isDay(o.meeting_date) ? o.meeting_date : E.today(),
      request_id: o.request_id || null,
      status: o.kind === 'minutes' ? 'RECORDED' : o.status || 'OPEN',
      by: o.by,
      at: E.iso(),
      closed_at: null,
      close_note: '',
    };
    // Digital seal over the canonical text of the record (spec FR-REQ-004: the referral decision is signed by the chair/delegate)
    if (E.sealer) {
      const chain_head = S.audit.length ? S.audit[S.audit.length - 1].hash : 'GENESIS';
      d.seal = {
        alg: E.sealer.algorithm,
        key_id: E.sealer.keyId,
        signer_id: d.by,
        signer_name: E.uname(d.by),
        signed_at: d.at,
        chain_head,
        sig: E.sealer.sign(sealText(d, chain_head)),
      };
    }
    S.decisions.push(d);
    return d;
  };
  /** Canonical text that is sealed: only immutable fields (status/closure are workflow state and are excluded). */
  const sealText = (d, chain_head) =>
    JSON.stringify([
      'MIHWAR-DECISION-1',
      d.id,
      d.ref,
      d.project_id,
      d.kind,
      d.title,
      d.body,
      d.basis,
      d.meeting_no,
      d.meeting_date,
      d.request_id,
      d.by,
      d.at,
      chain_head,
    ]);
  E.verifyDecisionSeal = (d) => {
    if (!d.seal) return { ok: false, reason: 'NOT_SEALED' };
    if (!E.sealer) return { ok: null, reason: 'NO_KEY_ON_THIS_ENGINE' };
    const okSig = E.sealer.verify(sealText(d, d.seal.chain_head), d.seal.sig, d.seal.key_id);
    return { ok: !!okSig, reason: okSig ? 'VALID' : 'MISMATCH' };
  };
  const decView = (d) => ({
    ...d,
    seal: d.seal
      ? {
          alg: d.seal.alg,
          key_id: d.seal.key_id,
          signer_name: d.seal.signer_name,
          signed_at: d.seal.signed_at,
          sig_short: String(d.seal.sig).slice(0, 12),
        }
      : null,
    by_name: E.uname(d.by),
    request_ref: d.request_id ? E.req(d.request_id)?.ref : null,
    kind_ar: { decision: 'قرار', minutes: 'محضر اجتماع', referral: 'قرار إحالة تنسيقي' }[d.kind] || d.kind,
  });
  const needCommittee = (ctx, id) => {
    const p = E.project(id);
    if (!p) fail(404, 'NOT_FOUND', 'المشروع غير موجود أو لا تملك صلاحية الاطلاع عليه');
    const role = E.committeeRole(ctx.user, p);
    if (!role && !(E.hasRole(ctx.user, 'FINAL_AUDITOR') && E.access(ctx.user, p) !== 'none'))
      fail(404, 'NOT_FOUND', 'المشروع غير موجود أو لا تملك صلاحية الاطلاع عليه');
    return { p, role };
  };
  E.route('POST', '/projects/:id/decisions', (ctx) => {
    const u = ctx.user;
    const b = ctx.body;
    const { p, role } = needCommittee(ctx, ctx.params.id);
    const kind = clean(b.kind, 12);
    if (!['decision', 'minutes'].includes(kind)) fail(422, 'BAD_KIND', 'اختر قرارًا أو محضر اجتماع');
    if (kind === 'decision' && role !== 'chair') fail(403, 'NO_PERMISSION', 'القرارات يسجّلها رئيس اللجنة');
    if (kind === 'minutes' && !['chair', 'secretary'].includes(role))
      fail(403, 'NO_PERMISSION', 'المحاضر يسجّلها رئيس اللجنة أو أمينها');
    if (!clean(b.title, 200)) fail(422, 'MISSING_TITLE', 'اكتب عنوانًا');
    if (!clean(b.body, 3000)) fail(422, 'MISSING_REASON', 'اكتب نص القرار أو المحضر');
    if (kind === 'decision' && !clean(b.basis, 300))
      fail(422, 'MISSING_BASIS', 'اذكر سند القرار (رقم المحضر أو الميثاق)');
    const rid = clean(b.request_id, 40);
    if (rid && E.req(rid)?.project_id !== p.id) fail(422, 'BAD_REQUEST_REF', 'الطلب المرتبط ليس من هذا المشروع');
    const d = E.recordDecision(p, { ...b, kind, by: u.id, request_id: rid || null });
    E.audit({
      actor_id: u.id,
      action: `committee.${kind}`,
      object_type: 'decision',
      object_id: d.id,
      project_id: p.id,
      detail: d.ref,
      reason: d.basis,
    });
    ctx.status = 201;
    return { decision: decView(d) };
  });
  E.route('GET', '/decisions/:id/verify', (ctx) => {
    const d = S.decisions.find((x) => x.id === ctx.params.id);
    const p = d && E.project(d.project_id);
    if (!d || !p || E.access(ctx.user, p) === 'none')
      fail(404, 'NOT_FOUND', 'القرار غير موجود أو لا تملك صلاحية الاطلاع عليه');
    const v = E.verifyDecisionSeal(d);
    return {
      id: d.id,
      ref: d.ref,
      sealed: !!d.seal,
      valid: v.ok,
      reason: v.reason,
      alg: d.seal?.alg || null,
      key_id: d.seal?.key_id || null,
      signer_name: d.seal?.signer_name || null,
      signed_at: d.seal?.signed_at || null,
      note: 'الختم الرقمي صادر عن المنصة (Ed25519) ويثبت عدم تعديل نص السجل بعد ختمه. ليس توقيعًا إلكترونيًا مؤهلًا صادرًا عن جهة تصديق حكومية.',
    };
  });
  E.route('GET', '/system/seal-key', (ctx) => ({
    alg: E.sealer?.algorithm || null,
    key_id: E.sealer?.keyId || null,
    public_key_pem: E.sealer?.publicKeyPem || null,
    created: E.sealer?.created || null,
    note: 'المفتاح العام للتحقق من أختام القرارات وسجل التدقيق الخارجي. المفتاح الخاص لا يغادر الخادم.',
  }));
  E.route('POST', '/decisions/:id/close', (ctx) => {
    const u = ctx.user;
    const d = S.decisions.find((x) => x.id === ctx.params.id);
    if (!d) fail(404, 'NOT_FOUND', 'القرار غير موجود');
    const { role } = needCommittee(ctx, d.project_id);
    if (role !== 'chair') fail(403, 'NO_PERMISSION', 'إقفال القرار لرئيس اللجنة');
    if (d.kind === 'minutes') fail(409, 'INVALID_TRANSITION', 'المحضر لا يُقفل');
    if (d.status !== 'OPEN') fail(409, 'INVALID_TRANSITION', 'القرار ليس مفتوحًا');
    const note = clean(ctx.body.note, 400);
    if (!note) fail(422, 'MISSING_REASON', 'اكتب ما تمّ تنفيذه');
    d.status = 'IMPLEMENTED';
    d.closed_at = E.iso();
    d.close_note = note;
    E.audit({
      actor_id: u.id,
      action: 'committee.decision.close',
      object_type: 'decision',
      object_id: d.id,
      project_id: d.project_id,
      reason: note,
    });
    return { decision: decView(d) };
  });

  const TABS = [
    ['inbox', 'وارد جديد', (r) => r.status === 'SUBMITTED_TO_COMMITTEE'],
    ['routing', 'بانتظار توجيه', (r) => ['PENDING_CHAIR_ROUTING'].includes(r.status)],
    ['referred', 'محال إلى الجهات', (r) => r.status === 'REFERRED_TO_ORG'],
    [
      'awaiting',
      'بانتظار الرد',
      (r) =>
        [
          'UNDER_ORG_REVIEW',
          'REOPEN_REQUESTED',
          'COUNTERPROPOSAL',
          'NEEDS_INFORMATION',
          'RETURNED_TO_REQUESTER',
        ].includes(r.status) && !(r.status === 'NEEDS_INFORMATION' && !r.target_org_id),
    ],
    ['declined', 'رفض / اختلاف اختصاص', (r) => r.status === 'DECLINED_WITH_REASON' || r.dispute?.status === 'OPEN'],
    [
      'commitments',
      'التزامات جارية',
      (r) =>
        [
          'ACCEPTED_BY_ORG',
          'READY_FOR_RELEASE',
          'IN_EXECUTION',
          'BLOCKED',
          'ESCALATED',
          'CHANGE_REQUESTED',
          'ORG_SUBMITTED',
          'RETURNED_FOR_CORRECTION',
          'ACCEPTED_DELIVERABLE',
        ].includes(r.status),
    ],
    [
      'closed',
      'منجز ومغلق',
      (r) => ['CLOSED_COMPLETED', 'CLOSED_DECLINED', 'WITHDRAWN', 'CANCELLED', 'SPLIT'].includes(r.status),
    ],
  ];
  const hoursSince = (iso) => (iso ? Math.max(0, Math.round((E.now() - Date.parse(iso)) / 3600000)) : 0);
  E.route('GET', '/projects/:id/committee', (ctx) => {
    const u = ctx.user;
    const { p, role } = needCommittee(ctx, ctx.params.id);
    const all = S.requests.filter(
      (r) => r.project_id === p.id && E.reqVisible(u, r) && !['DRAFT', 'PENDING_REQUESTER_APPROVAL'].includes(r.status),
    );
    const tab = clean(ctx.query.tab, 20) || 'inbox';
    const tabs = TABS.map(([key, label, fn]) => ({ key, label, count: all.filter(fn).length })).concat([
      {
        key: 'decisions',
        label: 'القرارات',
        count: S.decisions.filter((d) => d.project_id === p.id && d.kind !== 'minutes' && d.status === 'OPEN').length,
      },
    ]);
    let items = [];
    const def = TABS.find((t) => t[0] === tab);
    if (def) {
      items = all
        .filter(def[2])
        .sort((a, b) => (a.submitted_at || a.created_at).localeCompare(b.submitted_at || b.created_at))
        .map((r) => {
          const v = E.reqCard(u, r);
          const cur = [...r.referrals].reverse().find((x) => !x.superseded_by);
          const late = r.required_by ? diffDays(r.required_by, E.today()) : 0;
          return {
            ...v,
            waiting_hours: hoursSince(v.ball?.since),
            referral_at: cur?.at || null,
            referral_to: cur ? E.oname(cur.target_org_id) : null,
            impact_days: late > 0 ? late : 0,
            days_to_need: r.required_by ? -late : null,
            decline_reason: r.decisions.filter((d) => d.type === 'DECLINE').at(-1)?.reason_code
              ? M.REASON_CODES[r.decisions.filter((d) => d.type === 'DECLINE').at(-1).reason_code]
              : null,
          };
        });
    }
    const decisions =
      tab === 'decisions'
        ? S.decisions
            .filter((d) => d.project_id === p.id)
            .sort((a, b) => b.at.localeCompare(a.at))
            .map(decView)
        : [];
    return {
      project: { id: p.id, ref: p.ref, name: p.name },
      role,
      role_label: M.COMMITTEE_ROLE_LABEL[role] || 'مدقق',
      tab,
      tabs,
      items,
      decisions,
      can_record_decision: role === 'chair',
      can_record_minutes: ['chair', 'secretary'].includes(role),
      committee: {
        chair: E.uname(p.committee.chair_id),
        deputy: p.committee.deputy_id ? E.uname(p.committee.deputy_id) : null,
        secretary: E.uname(p.committee.secretary_id),
        members: p.committee.member_ids.map(E.uname),
      },
    };
  });

  E.route('GET', '/request-templates', () => ({
    items: M.REQUEST_TEMPLATES,
    service_types: M.SERVICE_TYPES,
    catalog: M.SERVICE_CATALOG,
  }));

  // ------------------------------------------------------------------ spec §10 aliases
  const sub = (ctx, method, path, body) => {
    const r = E.handle({ method, path, body, query: {}, headers: ctx.headers });
    ctx.status = r.status;
    if (r.status >= 400) fail(r.status, r.body.error.code, r.body.error.message, r.body.error.details);
    return r.body;
  };
  const history = (ctx) => {
    const v = sub(ctx, 'GET', `/interagency-requests/${ctx.params.id}`, {}).request;
    return {
      history: { ref: v.ref, status: v.status, events: v.events, referrals: v.referrals, decisions: v.decisions },
    };
  };
  E.route('GET', '/requests/:id/history', history);
  E.route('GET', '/interagency-requests/:id/history', history);
  E.route('POST', '/deliverables/:id/submit', (ctx) =>
    ctx.params.id.startsWith('wp_')
      ? sub(ctx, 'POST', `/work-packages/${ctx.params.id}/transition`, { to: 'ORG_SUBMITTED' })
      : sub(ctx, 'POST', `/interagency-requests/${ctx.params.id}/submit-deliverable`, ctx.body),
  );
  E.route('POST', '/deliverables/:id/review', (ctx) =>
    ctx.params.id.startsWith('wp_')
      ? sub(ctx, 'POST', `/work-packages/${ctx.params.id}/review`, ctx.body)
      : sub(ctx, 'POST', `/interagency-requests/${ctx.params.id}/review-deliverable`, ctx.body),
  );
  E.route('POST', '/interagency-requests/:id/reroute-request', (ctx) =>
    sub(ctx, 'POST', `/interagency-requests/${ctx.params.id}/reroute`, ctx.body),
  );

  // ------------------------------------------------------------------ break-glass (two approvals, time-boxed, read-only, audited)
  const BG_MAX_H = 4;
  E.breakGlassOk = (u, projectId) =>
    S.breakGlass.some(
      (g) => g.requested_by === u.id && g.project_id === projectId && g.status === 'ACTIVE' && g.active_until > E.iso(),
    );
  const bgView = (g) => ({
    ...g,
    requested_by_name: E.uname(g.requested_by),
    project_name: E.project(g.project_id)?.name,
    approvals: g.approvals.map((a) => ({ ...a, by_name: E.uname(a.by) })),
    need: ['owner', 'project_authority'].filter((k) => !g.approvals.some((a) => a.as === k)),
  });
  const bgExpire = () => {
    for (const g of S.breakGlass)
      if (g.status === 'ACTIVE' && g.active_until <= E.iso()) {
        g.status = 'EXPIRED';
        E.audit({
          actor_name: 'النظام',
          action: 'break_glass.expire',
          object_type: 'break_glass',
          object_id: g.id,
          project_id: g.project_id,
        });
      }
  };
  E.route('GET', '/admin/break-glass', (ctx) => {
    const u = ctx.user;
    bgExpire();
    const eligible =
      E.hasRole(u, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN') ||
      S.projects.some((p) => E.hasRole(u, 'COORDINATING_ADMIN') && u.org_id === p.lead_org_id);
    if (!eligible) fail(403, 'NO_PERMISSION', 'لمشغّل المنصة ومالكها ومنسّق المشروع');
    const list = S.breakGlass.filter((g) =>
      E.hasRole(u, 'SUPER_ADMIN')
        ? g.requested_by === u.id
        : E.hasRole(u, 'PLATFORM_OWNER_ADMIN') || E.project(g.project_id)?.lead_org_id === u.org_id,
    );
    return { items: list.slice().reverse().map(bgView), max_hours: BG_MAX_H };
  });
  E.route('POST', '/admin/break-glass', (ctx) => {
    const u = ctx.user;
    const b = ctx.body;
    if (!E.hasRole(u, 'SUPER_ADMIN')) fail(403, 'NO_PERMISSION', 'طلب الوصول الاستثنائي لمشغّل المنصة');
    const p = E.project(clean(b.project_id, 40));
    if (!p) fail(422, 'UNKNOWN_PROJECT', 'اختر المشروع');
    const reason = clean(b.reason, 600);
    if (reason.length < 15) fail(422, 'MISSING_REASON', 'اذكر السبب التشغيلي بوضوح (١٥ حرفًا على الأقل)');
    const hours = Math.min(BG_MAX_H, Math.max(1, Math.round(Number(b.duration_hours) || 1)));
    bgExpire();
    if (
      S.breakGlass.some(
        (g) => g.requested_by === u.id && g.project_id === p.id && ['PENDING', 'ACTIVE'].includes(g.status),
      )
    )
      fail(409, 'ALREADY_OPEN', 'لديك طلب قائم لهذا المشروع');
    const g = {
      id: E.id('bg'),
      requested_by: u.id,
      project_id: p.id,
      reason,
      duration_hours: hours,
      status: 'PENDING',
      approvals: [],
      requested_at: E.iso(),
      active_until: null,
      scope: 'read-only',
    };
    S.breakGlass.push(g);
    E.audit({
      actor_id: u.id,
      action: 'break_glass.request',
      object_type: 'break_glass',
      object_id: g.id,
      project_id: p.id,
      reason,
    });
    const owners = S.users
      .filter(
        (x) =>
          E.hasRole(x, 'PLATFORM_OWNER_ADMIN') || (E.hasRole(x, 'COORDINATING_ADMIN') && x.org_id === p.lead_org_id),
      )
      .map((x) => x.id);
    E.notify(
      owners,
      {
        kind: 'security',
        title: 'طلب وصول استثنائي (كسر الزجاج) بانتظار اعتمادك',
        body: `${p.name} — ${reason.slice(0, 80)}`,
        link: '#/governance?tab=breakglass',
        project_id: p.id,
      },
      u.id,
    );
    ctx.status = 201;
    return { break_glass: bgView(g) };
  });
  E.route('POST', '/admin/break-glass/:id/approve', (ctx) => {
    const u = ctx.user;
    bgExpire();
    const g = S.breakGlass.find((x) => x.id === ctx.params.id);
    if (!g) fail(404, 'NOT_FOUND', 'الطلب غير موجود');
    const p = E.project(g.project_id);
    const as = E.hasRole(u, 'PLATFORM_OWNER_ADMIN')
      ? 'owner'
      : E.hasRole(u, 'COORDINATING_ADMIN') && u.org_id === p.lead_org_id
        ? 'project_authority'
        : null;
    if (!as) fail(403, 'NO_PERMISSION', 'الاعتماد لمالك المنصة ولمنسّق المشروع');
    if (g.requested_by === u.id) fail(403, 'CONFLICT_OF_INTEREST', 'لا يعتمد الطالب طلبه');
    if (g.status !== 'PENDING') fail(409, 'INVALID_TRANSITION', 'الطلب ليس بانتظار الاعتماد');
    if (g.approvals.some((a) => a.as === as || a.by === u.id)) fail(409, 'ALREADY_APPROVED', 'سبق اعتماد هذه الصفة');
    g.approvals.push({ by: u.id, as, at: E.iso(), note: clean(ctx.body.note, 300) });
    if (g.approvals.length >= 2) {
      g.status = 'ACTIVE';
      g.active_until = new Date(E.now() + g.duration_hours * 3600000).toISOString();
    }
    E.audit({
      actor_id: u.id,
      action: g.status === 'ACTIVE' ? 'break_glass.activate' : 'break_glass.approve',
      object_type: 'break_glass',
      object_id: g.id,
      project_id: g.project_id,
      reason: as,
    });
    if (g.status === 'ACTIVE')
      E.notify([g.requested_by], {
        kind: 'security',
        title: 'فُعّل الوصول الاستثنائي (قراءة فقط)',
        body: `حتى ${g.active_until}`,
        link: '#/governance',
        project_id: g.project_id,
      });
    return { break_glass: bgView(g) };
  });
  E.route('POST', '/admin/break-glass/:id/revoke', (ctx) => {
    const u = ctx.user;
    const g = S.breakGlass.find((x) => x.id === ctx.params.id);
    if (!g) fail(404, 'NOT_FOUND', 'الطلب غير موجود');
    const p = E.project(g.project_id);
    if (!(
      g.requested_by === u.id ||
      E.hasRole(u, 'PLATFORM_OWNER_ADMIN') ||
      (E.hasRole(u, 'COORDINATING_ADMIN') && u.org_id === p.lead_org_id)
    ))
      fail(403, 'NO_PERMISSION', 'لا تملك صلاحية الإلغاء');
    if (!['PENDING', 'ACTIVE'].includes(g.status)) fail(409, 'INVALID_TRANSITION', 'الطلب منتهٍ');
    g.status = g.status === 'PENDING' ? 'REJECTED' : 'REVOKED';
    E.audit({
      actor_id: u.id,
      action: 'break_glass.revoke',
      object_type: 'break_glass',
      object_id: g.id,
      project_id: g.project_id,
      reason: clean(ctx.body.reason, 300),
    });
    return { break_glass: bgView(g) };
  });

  // ------------------------------------------------------------------ sessions
  const sid = (tok) => sha256(tok).slice(0, 12);
  E.route('GET', '/me/sessions', (ctx) => ({
    items: Object.entries(S.sessions)
      .filter(([, s]) => s.user_id === ctx.user.id)
      .map(([tok, s]) => ({ id: sid(tok), created: s.created, last: s.last, current: tok === ctx.token })),
  }));
  E.route('POST', '/me/sessions/:id/revoke', (ctx) => {
    const hit = Object.entries(S.sessions).find(([tok, s]) => s.user_id === ctx.user.id && sid(tok) === ctx.params.id);
    if (!hit) fail(404, 'NOT_FOUND', 'الجلسة غير موجودة');
    delete S.sessions[hit[0]];
    E.audit({ actor_id: ctx.user.id, action: 'session.revoke', object_type: 'session', object_id: ctx.params.id });
    return { ok: true, current: hit[0] === ctx.token };
  });

  // ------------------------------------------------------------------ restricted, logged exports (CSV)
  const csvCell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  E.route('GET', '/export/:what', (ctx) => {
    const u = ctx.user;
    const what = ctx.params.what;
    const pid = clean(ctx.query.project_id, 40);
    if (E.hasRole(u, 'SCOPED_VIEWER', 'SUPER_ADMIN')) fail(403, 'NO_PERMISSION', 'التصدير غير متاح لدورك');
    let rows;
    if (what === 'requests') {
      const list = S.requests
        .filter(
          (r) =>
            E.reqVisible(u, r) &&
            (!pid || r.project_id === pid) &&
            !(['DRAFT', 'PENDING_REQUESTER_APPROVAL'].includes(r.status) && u.org_id !== r.requester_org_id),
        )
        .slice(0, 500);
      rows = [
        ['الرقم', 'العنوان', 'المشروع', 'الجهة الطالبة', 'الجهة المختصة', 'الحالة', 'موعد الحاجة', 'آخر تحديث'],
        ...list.map((r) => [
          r.ref,
          r.title,
          E.project(r.project_id)?.name,
          E.oname(r.requester_org_id),
          r.target_org_id ? E.oname(r.target_org_id) : '',
          M.REQUEST_STATUS[r.status].ar,
          r.required_by,
          r.updated_at.slice(0, 10),
        ]),
      ];
    } else if (what === 'work-packages') {
      const p = E.needProject(u, pid, 'viewer');
      rows = [
        ['الرمز', 'العنوان', 'الجهة', 'الحالة', 'البداية', 'النهاية', 'الوزن'],
        ...S.workPackages
          .filter((w) => w.project_id === p.id)
          .map((w) => [
            w.ref,
            w.title,
            E.oname(w.owner_org_id),
            M.WP_STATUS[w.status].ar,
            w.planned_start,
            w.planned_end,
            w.weight,
          ]),
      ];
    } else if (what === 'audit') {
      if (!E.hasRole(u, 'FINAL_AUDITOR', 'PLATFORM_OWNER_ADMIN'))
        fail(403, 'NO_PERMISSION', 'تصدير التدقيق للمدقق ولمالك المنصة');
      rows = [
        ['#', 'الوقت', 'الفاعل', 'الإجراء', 'الكائن', 'النتيجة'],
        ...S.audit
          .slice(-1000)
          .map((a) => [a.seq, a.at, a.actor_name, a.action, `${a.object_type}:${a.object_id}`, a.outcome]),
      ];
    } else fail(404, 'NOT_FOUND', 'نوع التصدير غير معروف');
    E.audit({
      actor_id: u.id,
      action: `export.${what}`,
      object_type: 'export',
      object_id: what,
      project_id: pid || null,
      detail: `${rows.length - 1} rows`,
    });
    return {
      __binary: {
        data: new TextEncoder().encode(csv(rows)),
        mime: 'text/csv; charset=utf-8',
        filename: `mihwar-${what}.csv`,
      },
    };
  });

  // ------------------------------------------------------------------ transactional-outbox style event log (local relay only)
  const OUTBOX_ACTIONS = /^(request\.|cr\.|wp\.|commitment|file\.(upload|grant)|committee\.|break_glass\.|export\.)/;
  E.afterAudit = (rec) => {
    if (rec.outcome !== 'ok' || !OUTBOX_ACTIONS.test(rec.action)) return;
    S.outbox.push({
      id: E.id('obx'),
      at: rec.at,
      type: rec.action,
      object_type: rec.object_type,
      object_id: rec.object_id,
      project_id: rec.project_id || null,
      audit_seq: rec.seq,
      correlation_id: rec.correlation_id || null,
      status: 'PENDING',
    });
    if (S.outbox.length > 3000) S.outbox.splice(0, S.outbox.length - 2500);
  };
  // ------------------------------------------------------------------ outbound e-mail / SMS queue (delivered by server/relay.mjs when configured)
  // Content policy: messages carry only a generic line and the kind of notification, never request titles or bodies, so nothing sensitive leaves the platform.
  S.contacts ||= {};
  S.outbound ||= [];
  const KIND_AR = {
    request: 'طلب',
    task: 'مهمة',
    change: 'طلب تغيير',
    delegation: 'تفويض',
    message: 'رسالة',
    mention: 'إشارة إليك',
    security: 'أمان الحساب',
    info: 'إشعار',
  };
  E.enqueueOutbound = (uid, ntf) => {
    const c = S.contacts[uid];
    if (!c) return;
    const base = { notification_id: ntf.id, user_id: uid, at: E.iso(), status: 'PENDING', attempts: 0, next_at: 0 };
    const text = `لديك إشعار جديد في منصة محور (${KIND_AR[ntf.kind] || 'إشعار'}). افتح المنصة لعرض التفاصيل.`;
    if (c.notify_email && c.email)
      S.outbound.push({ id: E.id('out'), channel: 'email', to: c.email, subject: 'إشعار جديد في محور', text, ...base });
    if (c.notify_sms && c.phone) S.outbound.push({ id: E.id('out'), channel: 'sms', to: c.phone, text, ...base });
    if (S.outbound.length > 2000) S.outbound.splice(0, S.outbound.length - 1500);
  };
  E.route('GET', '/me/contact', (ctx) => ({
    contact: S.contacts[ctx.user.id] || { email: '', phone: '', notify_email: false, notify_sms: false },
  }));
  E.route('PUT', '/me/contact', (ctx) => {
    const b = ctx.body;
    const email = clean(b.email, 120);
    const phone = clean(b.phone, 20).replace(/[\s-]/g, '');
    if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email)) fail(422, 'BAD_EMAIL', 'بريد إلكتروني غير صحيح');
    if (phone && !/^\+?[0-9]{8,15}$/.test(phone)) fail(422, 'BAD_PHONE', 'رقم الجوال بصيغة دولية، مثل +9715XXXXXXXX');
    const c = { email, phone, notify_email: !!b.notify_email && !!email, notify_sms: !!b.notify_sms && !!phone };
    S.contacts[ctx.user.id] = c;
    E.audit({ actor_id: ctx.user.id, action: 'contact.update', object_type: 'user', object_id: ctx.user.id });
    return { contact: c };
  });
  E.integrations = { email: null, sms: null, scanner: null }; // set by the server from environment configuration (never secrets)
  E.route('GET', '/system/integrations', (ctx) => {
    if (!E.hasRole(ctx.user, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN'))
      fail(403, 'NO_PERMISSION', 'لمشغّل المنصة ومالكها');
    const by = {};
    for (const o of S.outbound) {
      const k = `${o.channel}:${o.status}`;
      by[k] = (by[k] || 0) + 1;
    }
    return {
      integrations: E.integrations,
      queue: by,
      contacts_registered: Object.keys(S.contacts).length,
      auth_mode: E.demo ? 'demo (+ password if issued)' : 'password',
      note: 'تُضبط التكاملات بمتغيرات البيئة على الخادم ولا تُخزَّن أسرارها في قاعدة البيانات. الرسائل الصادرة عامة المحتوى ولا تحمل عناوين الطلبات.',
    };
  });
  // INT-010: outage fallback and reconciliation. Items that could not be delivered stay in the queue with their reason; an operator sees the gap and can re-queue the failed ones.
  E.route('GET', '/system/outbound', (ctx) => {
    if (!E.hasRole(ctx.user, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN'))
      fail(403, 'NO_PERMISSION', 'لمشغّل المنصة ومالكها');
    const by = {};
    for (const o of S.outbound) {
      const k = `${o.channel}:${o.status}`;
      by[k] = (by[k] || 0) + 1;
    }
    const pend = S.outbound.filter((o) => o.status === 'PENDING');
    const oldest = pend.length
      ? Math.max(0, Math.round((E.now() - Date.parse(pend[0].at || pend[0].created_at || E.iso())) / 60000))
      : 0;
    return {
      by_status: by,
      pending: pend.length,
      failed: S.outbound.filter((o) => o.status === 'FAILED').length,
      oldest_pending_minutes: oldest,
      recent_failures: (S.integrationFailures || []).slice(-20).reverse(),
      note: 'سجل الإخفاقات بلا نصوص الرسائل وبلا أسرار، والمستلم مقنّع. أعد وضع الفاشل في الطابور بعد معالجة السبب.',
    };
  });
  E.route('POST', '/system/outbound/retry-failed', (ctx) => {
    if (!E.hasRole(ctx.user, 'SUPER_ADMIN')) fail(403, 'NO_PERMISSION', 'لمشغّل المنصة فقط');
    let n = 0;
    for (const o of S.outbound)
      if (o.status === 'FAILED') {
        o.status = 'PENDING';
        o.attempts = 0;
        o.next_at = 0;
        n++;
      }
    E.audit({
      actor_id: ctx.user.id,
      action: 'outbound.retry_failed',
      object_type: 'system',
      object_id: 'outbound',
      note: `${n}`,
    });
    return { requeued: n };
  });
  E.relayOutbox = () => {
    let n = 0;
    for (const o of S.outbox)
      if (o.status === 'PENDING') {
        o.status = 'DELIVERED_LOCAL';
        n++;
      }
    return n;
  };
  E.route('GET', '/system/outbox', (ctx) => {
    if (!E.hasRole(ctx.user, 'SUPER_ADMIN', 'PLATFORM_OWNER_ADMIN'))
      fail(403, 'NO_PERMISSION', 'لمشغّل المنصة ومالكها');
    const by = {};
    for (const o of S.outbox) by[o.status] = (by[o.status] || 0) + 1;
    return {
      total: S.outbox.length,
      by_status: by,
      note: 'سجل أحداث محلي؛ لا يوجد مستهلك خارجي في هذه النسخة، والتفاصيل الداخلية للجهات غير معروضة.',
    };
  });
}
