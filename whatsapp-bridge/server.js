'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3210);
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ltjdhconuiqblxfjzpzj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_-7SIdrqTmUibqpA7mXXrgg_SHz9EJRr';

const state = {
  status: 'starting',
  qr: null,
  error: null,
  connectedNumber: null,
  platformToken: null,
  platformStudents: [],
};

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'yr-physics-whatsapp' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', async (qr) => {
  state.status = 'qr';
  state.error = null;
  state.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
});
client.on('authenticated', () => {
  state.status = 'authenticated';
  state.qr = null;
});
client.on('ready', () => {
  state.status = 'ready';
  state.qr = null;
  state.error = null;
  state.connectedNumber = client.info?.wid?.user || null;
  console.log(`WhatsApp ready: ${state.connectedNumber || 'connected'}`);
});
client.on('auth_failure', (message) => {
  state.status = 'auth_failure';
  state.error = String(message || 'Authentication failed');
});
client.on('disconnected', (reason) => {
  state.status = 'disconnected';
  state.error = String(reason || 'Disconnected');
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhone(value) {
  let d = digits(value);
  if (!d) return null;
  if (d.startsWith('0020')) d = d.slice(2);
  if (d.startsWith('20') && d.length === 12) return d;
  if (d.startsWith('01') && d.length === 11) return `20${d.slice(1)}`;
  if (d.startsWith('1') && d.length === 10) return `20${d}`;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

function displayEgypt(number) {
  const d = normalizePhone(number);
  if (d && d.startsWith('20') && d.length === 12) return `0${d.slice(2)}`;
  return d || '';
}

function normalizeArabic(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactName(value) {
  return normalizeArabic(value).replace(/\s+/g, '');
}

function scoreName(input, candidate) {
  const a = normalizeArabic(input);
  const b = normalizeArabic(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ac = compactName(a);
  const bc = compactName(b);
  if (ac === bc) return 1;
  if (ac.length >= 5 && (bc.startsWith(ac) || ac.startsWith(bc))) return 0.96;

  const at = a.split(' ').filter(Boolean);
  const bt = b.split(' ').filter(Boolean);
  const bcFull = bt.join('');
  let covered = 0;
  for (const token of at) {
    if (bt.includes(token) || (token.length >= 3 && bcFull.includes(token))) covered += 1;
  }
  const coverage = at.length ? covered / at.length : 0;
  if (coverage === 1) return 0.93;

  const common = at.filter((t) => bt.includes(t)).length;
  const union = new Set([...at, ...bt]).size || 1;
  return Math.max(coverage * 0.85, common / union);
}

function extractPhoneFromLine(line) {
  const matches = String(line || '').match(/(?:\+?20|0)?1[0125]\d{8}/g);
  if (!matches || !matches.length) return null;
  return normalizePhone(matches[matches.length - 1]);
}

function lineWithoutPhone(line) {
  return String(line || '')
    .replace(/(?:\+?20|0)?1[0125]\d{8}/g, ' ')
    .replace(/[.،,:;|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rosterByPhone(students) {
  const map = new Map();
  for (const s of students || []) {
    const p = normalizePhone(s.student_phone);
    if (p) map.set(p, s);
  }
  return map;
}

function matchAttendance(text, students) {
  const active = (students || []).filter((s) => s.is_active === true);
  const phoneMap = rosterByPhone(active);
  const desired = new Map();
  const matched = [];
  const unresolved = [];
  const ambiguous = [];

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const phone = extractPhoneFromLine(line);
    const typedName = lineWithoutPhone(line);

    if (phone) {
      const student = phoneMap.get(phone) || null;
      desired.set(phone, student || { full_name: typedName || phone, student_phone: displayEgypt(phone), direct: true });
      matched.push({ input: line, phone: displayEgypt(phone), name: student?.full_name || typedName || 'رقم مباشر', source: student ? 'phone+platform' : 'phone' });
      continue;
    }

    if (!typedName) continue;
    const ranked = active
      .map((s) => ({ student: s, score: scoreName(typedName, s.full_name) }))
      .filter((x) => x.score >= 0.78)
      .sort((x, y) => y.score - x.score);

    if (!ranked.length) {
      unresolved.push({ input: line, reason: 'لم أجد اسمًا مطابقًا على المنصة' });
      continue;
    }
    if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.08) {
      ambiguous.push({
        input: line,
        candidates: ranked.slice(0, 3).map((x) => ({ name: x.student.full_name, code: x.student.student_code, score: x.score })),
      });
      continue;
    }

    const s = ranked[0].student;
    const p = normalizePhone(s.student_phone);
    if (!p) {
      unresolved.push({ input: line, reason: `الطالب ${s.full_name} موجود لكن رقم تليفونه غير مسجل على المنصة`, student_code: s.student_code });
      continue;
    }
    desired.set(p, s);
    matched.push({ input: line, phone: displayEgypt(p), name: s.full_name, code: s.student_code, source: 'name+platform' });
  }

  return { desired, matched, unresolved, ambiguous };
}

async function resolveGroupMembers(group) {
  const rows = [];
  for (const participant of group.participants || []) {
    let number = null;
    let contactName = null;
    try {
      const contact = await client.getContactById(participant.id._serialized);
      number = normalizePhone(contact?.number || participant.id?.user);
      contactName = contact?.name || contact?.pushname || contact?.shortName || null;
    } catch {
      number = normalizePhone(participant.id?.user);
    }
    rows.push({
      id: participant.id._serialized,
      phone: number,
      displayPhone: displayEgypt(number),
      name: contactName,
      isAdmin: Boolean(participant.isAdmin || participant.isSuperAdmin),
      isSuperAdmin: Boolean(participant.isSuperAdmin),
    });
  }
  return rows;
}

function parseProtected(text) {
  const out = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const p = extractPhoneFromLine(line) || normalizePhone(line);
    if (p) out.add(p);
  }
  return out;
}

async function getGroup(groupId) {
  if (state.status !== 'ready') throw new Error('واتساب غير متصل بعد.');
  const chat = await client.getChatById(String(groupId || ''));
  if (!chat || !chat.isGroup) throw new Error('الجروب غير موجود أو الاختيار غير صحيح.');
  return chat;
}

async function buildPreview({ groupId, attendanceText, protectedText }) {
  const group = await getGroup(groupId);
  const roster = state.platformStudents || [];
  const match = matchAttendance(attendanceText, roster);
  const current = await resolveGroupMembers(group);
  const desired = match.desired;
  const protectedSet = parseProtected(protectedText);
  const self = normalizePhone(state.connectedNumber);
  if (self) protectedSet.add(self);
  for (const m of current) if (m.isAdmin && m.phone) protectedSet.add(m.phone);

  const currentByPhone = new Map(current.filter((m) => m.phone).map((m) => [m.phone, m]));
  const toAdd = [];
  const toRemove = [];
  const keep = [];

  for (const [phone, student] of desired.entries()) {
    if (currentByPhone.has(phone)) {
      const member = currentByPhone.get(phone);
      keep.push({ ...member, desiredName: student.full_name || member.name });
    } else {
      toAdd.push({ phone, displayPhone: displayEgypt(phone), name: student.full_name || null, code: student.student_code || null });
    }
  }

  for (const member of current) {
    if (!member.phone) {
      keep.push({ ...member, protectedReason: 'رقم العضو غير قابل للقراءة؛ لن يتم حذفه تلقائيًا' });
      continue;
    }
    if (desired.has(member.phone)) continue;
    if (protectedSet.has(member.phone)) {
      keep.push({ ...member, protectedReason: member.isAdmin ? 'Admin محمي' : 'رقم محمي' });
      continue;
    }
    toRemove.push(member);
  }

  return {
    group: { id: group.id._serialized, name: group.name, participantCount: current.length },
    platformLoaded: roster.length,
    matchedAttendance: match.matched,
    unresolved: match.unresolved,
    ambiguous: match.ambiguous,
    desiredCount: desired.size,
    keep,
    toAdd,
    toRemove,
  };
}

async function addOne(group, phone) {
  const p = normalizePhone(phone);
  if (!p) return { phone, ok: false, message: 'رقم غير صالح' };
  const wid = await client.getNumberId(p);
  if (!wid) return { phone: displayEgypt(p), ok: false, message: 'الرقم غير مسجل على واتساب' };
  try {
    const result = await group.addParticipants([wid._serialized], {
      sleep: 1500,
      autoSendInviteV4: true,
      comment: 'إضافة إلى مجموعة الصف',
    });
    return { phone: displayEgypt(p), ok: true, result };
  } catch (e) {
    return { phone: displayEgypt(p), ok: false, message: e?.message || String(e) };
  }
}

async function removeOne(group, member) {
  if (!member || member.isAdmin || member.isSuperAdmin) return { phone: member?.displayPhone || '', ok: false, message: 'Admin محمي من الحذف' };
  try {
    await group.removeParticipants([member.id]);
    return { phone: member.displayPhone, name: member.name, ok: true };
  } catch (e) {
    return { phone: member.displayPhone, name: member.name, ok: false, message: e?.message || String(e) };
  }
}

async function platformLogin(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.msg || data.message || 'فشل تسجيل الدخول للمنصة.');
  state.platformToken = data.access_token;
  return { user: data.user || null };
}

async function loadPlatformStudents(groupCode) {
  if (!state.platformToken) throw new Error('سجّل دخول الإدارة أولًا.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-student`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${state.platformToken}`,
    },
    body: JSON.stringify({ action: 'list_students' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || 'تعذر تحميل الطلاب من المنصة.');
  const code = String(groupCode || '').trim();
  state.platformStudents = (data.students || []).filter((s) => !code || s.group_code === code);
  return state.platformStudents;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`;
}

const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (!isAllowedOrigin(req)) return sendJson(res, 403, { error: 'origin_not_allowed' });

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(indexHtml);
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return sendJson(res, 200, {
        status: state.status,
        qr: state.qr,
        error: state.error,
        connectedNumber: displayEgypt(state.connectedNumber),
        platformLoggedIn: Boolean(state.platformToken),
        platformStudents: state.platformStudents.length,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/groups') {
      if (state.status !== 'ready') return sendJson(res, 409, { error: 'whatsapp_not_ready' });
      const chats = await client.getChats();
      const groups = chats
        .filter((c) => c.isGroup)
        .map((g) => ({ id: g.id._serialized, name: g.name, participants: g.participants?.length || 0 }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      return sendJson(res, 200, { groups });
    }
    if (req.method === 'POST' && url.pathname === '/api/platform/login') {
      const body = await readBody(req);
      const result = await platformLogin(String(body.email || '').trim(), String(body.password || ''));
      return sendJson(res, 200, { ok: true, user: result.user ? { email: result.user.email } : null });
    }
    if (req.method === 'POST' && url.pathname === '/api/platform/students') {
      const body = await readBody(req);
      const students = await loadPlatformStudents(body.groupCode || 'N3-A');
      return sendJson(res, 200, {
        ok: true,
        count: students.length,
        activeCount: students.filter((s) => s.is_active === true).length,
        groupCode: body.groupCode || 'N3-A',
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/preview') {
      const body = await readBody(req);
      const preview = await buildPreview(body);
      return sendJson(res, 200, { ok: true, preview });
    }
    if (req.method === 'POST' && url.pathname === '/api/apply') {
      const body = await readBody(req);
      if (body.confirm !== 'EXECUTE') return sendJson(res, 400, { error: 'confirmation_required' });
      const preview = await buildPreview(body);
      if (preview.unresolved.length || preview.ambiguous.length) {
        return sendJson(res, 409, { error: 'resolve_attendance_first', preview });
      }
      const group = await getGroup(body.groupId);
      const mode = ['add', 'remove', 'both'].includes(body.mode) ? body.mode : 'both';
      const added = [];
      const removed = [];

      if (mode === 'add' || mode === 'both') {
        for (const item of preview.toAdd) {
          added.push(await addOne(group, item.phone));
          await sleep(1800);
        }
      }
      if (mode === 'remove' || mode === 'both') {
        for (const item of preview.toRemove) {
          removed.push(await removeOne(group, item));
          await sleep(1800);
        }
      }
      const after = await buildPreview(body);
      return sendJson(res, 200, { ok: true, added, removed, after });
    }

    sendJson(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: 'server_error', message: e?.message || String(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`YR WhatsApp Bridge: http://${HOST}:${PORT}`);
  client.initialize().catch((e) => {
    state.status = 'error';
    state.error = e?.message || String(e);
    console.error(e);
  });
});
