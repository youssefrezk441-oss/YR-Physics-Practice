import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";

const EXAM = "azhar-physics-g2-ch1-ch2-2026-10";
const DB_URL = Deno.env.get("SUPABASE_DB_URL")!;
const sql = postgres(DB_URL, { max: 3, idle_timeout: 20, prepare: false });
const originAllowed = new Set([
  "https://youssefrezk441-oss.github.io",
  "http://localhost:8000", "http://127.0.0.1:8000"
]);
const enc = new TextEncoder();
const letters = new Set(["أ", "ب", "ج", "د"]);
const nameNorm = (v: string) => v.normalize("NFKC").trim().replace(/\s+/g, " ").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
async function sha(v: string) {
  const b = await crypto.subtle.digest("SHA-256", enc.encode(v));
  return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join("");
}
const fail = (code: number, message: string) => ({ code, data: { error: message } });
function cleanAnswers(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw fail(400, "صيغة الإجابات غير صحيحة.");
  const out: Record<string,string> = {};
  const rows = Object.entries(raw as Record<string,unknown>);
  if (rows.length > 40) throw fail(400, "عدد الإجابات غير صحيح.");
  for (const [key, value] of rows) {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 1 || n > 40 || String(n) !== key || typeof value !== "string") throw fail(400, "صيغة إجابة غير صحيحة.");
    if (n <= 20) { if (!letters.has(value)) throw fail(400, "اختر بديلًا صحيحًا."); }
    else if (value.length > 2000) throw fail(400, "الإجابة المقالية طويلة جدًا.");
    if (value) out[key] = value;
  }
  return out;
}
function state(row: any) {
  const now = Date.now(), due = new Date(row.deadline_at).getTime();
  return { name: row.student_name, group: row.group_code, started_at: row.started_at,
    deadline_at: row.deadline_at, submitted_at: row.submitted_at,
    status: row.submitted_at ? "submitted" : now >= due ? "expired" : "active",
    answers: row.answers || {}, server_time: new Date().toISOString() };
}
async function rateLimit(req: Request) {
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const key = await sha(`${DB_URL}|${ip}`);
  const r = await sql`insert into private.azhar_exam_rate (ip_hash, minute_bucket, hits)
    values (${key}, date_trunc('minute', now()), 1)
    on conflict (ip_hash, minute_bucket) do update set hits=private.azhar_exam_rate.hits+1 returning hits`;
  if (r[0].hits > 12) throw fail(429, "محاولات كثيرة. أعد المحاولة بعد دقيقة.");
}
async function admin(token: string, action: string, body: any) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_ANON_KEY")!;
  const auth = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) throw fail(403, "صلاحية الإدارة مطلوبة.");
  const a = await sql`select public.admin_access_level('students', ${data.user.id}::uuid) as level`;
  if (!['view','edit'].includes(a[0]?.level)) throw fail(403, "صلاحية الإدارة مطلوبة.");
  if (action === "admin_list") {
    const rows = await sql`select student_code, student_name, group_code, started_at, deadline_at,
      submitted_at, updated_at, (select count(*) from jsonb_object_keys(answers)) as answered
      from private.azhar_exam_attempts where exam_id=${EXAM} order by student_code`;
    return { attempts: rows.map((r: any) => ({...r, status: r.submitted_at ? 'submitted' : Date.now() >= new Date(r.deadline_at).getTime() ? 'expired' : 'active' })) };
  }
  if (action === "admin_detail") {
    const code = String(body.student_code || '').trim();
    const rows = await sql`select student_code, student_name, group_code, started_at, deadline_at,
      submitted_at, answers from private.azhar_exam_attempts
      where exam_id=${EXAM} and student_code=${code} limit 1`;
    if (!rows.length) throw fail(404, "لا توجد محاولة لهذا الكود.");
    return { attempt: rows[0] };
  }
  throw fail(400, "طلب غير معروف.");
}

Deno.serve(async req => {
  const origin = req.headers.get("origin") || "";
  const headers = { "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": originAllowed.has(origin) ? origin : "https://youssefrezk441-oss.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Cache-Control": "no-store", "Vary": "Origin" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({error:"طلب غير مسموح."}), {status:405,headers});
  try {
    if (Number(req.headers.get('content-length') || 0) > 90000) throw fail(413, "الطلب كبير جدًا.");
    const body = await req.json();
    const action = String(body?.action || '');
    let result: any;
    if (action.startsWith('admin_')) {
      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      result = await admin(token, action, body);
    } else if (action === "start") {
      await rateLimit(req);
      const code = String(body.student_code || '').trim().toUpperCase();
      const name = nameNorm(String(body.student_name || ''));
      if (!/^[A-Z0-9-]{3,30}$/.test(code) || name.length < 5 || name.length > 100)
        throw fail(400, "تحقق من كود الطالب والاسم كما هما في المنصة.");
      const profiles = await sql`select user_id, student_code, full_name, group_code
        from public.student_profiles where upper(student_code)=${code}
          and is_active=true and group_code in ('K2-B','N2-B') limit 1`;
      if (!profiles.length || nameNorm(profiles[0].full_name) !== name)
        throw fail(403, "تعذر التحقق من بيانات الطالب. راجع الكود والاسم.");
      const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
      const resumeToken = Array.from(tokenBytes, x => x.toString(16).padStart(2,'0')).join('');
      const hash = await sha(resumeToken);
      const p = profiles[0];
      const inserted = await sql`insert into private.azhar_exam_attempts
        (exam_id,student_user_id,student_code,student_name,group_code,token_hash,deadline_at)
        values (${EXAM},${p.user_id},${p.student_code},${p.full_name},${p.group_code},${hash},now()+interval '150 minutes')
        on conflict do nothing returning *`;
      if (!inserted.length) throw fail(409, "بدأت لهذا الطالب محاولة بالفعل. افتح الامتحان من نفس المتصفح على الهاتف الذي بدأت منه.");
      result = { ...state(inserted[0]), token: resumeToken };
    } else if (["resume","save","submit"].includes(action)) {
      const token = String(body.token || '');
      if (!/^[0-9a-f]{64}$/.test(token)) throw fail(403, "تعذر استعادة المحاولة من هذا الجهاز.");
      const hash = await sha(token);
      const rows = await sql`select * from private.azhar_exam_attempts where exam_id=${EXAM} and token_hash=${hash} limit 1`;
      if (!rows.length) throw fail(403, "تعذر استعادة المحاولة من هذا الجهاز.");
      let row = rows[0];
      if (Date.now() >= new Date(row.deadline_at).getTime() && !row.submitted_at) {
        const done = await sql`update private.azhar_exam_attempts set submitted_at=deadline_at,updated_at=now()
          where exam_id=${EXAM} and student_user_id=${row.student_user_id} and submitted_at is null returning *`;
        if (done.length) row = done[0];
      }
      if (action === 'resume') result = state(row);
      else {
        if (row.submitted_at) throw fail(409, "انتهت المحاولة أو تم التسليم بالفعل.");
        const answers = cleanAnswers(body.answers);
        const updated = await sql`update private.azhar_exam_attempts
          set answers=${sql.json(answers)}::jsonb, updated_at=now(),
              submitted_at=case when ${action}='submit' then now() else null end
          where exam_id=${EXAM} and student_user_id=${row.student_user_id}
            and token_hash=${hash} and submitted_at is null and deadline_at>now()
          returning *`;
        if (!updated.length) throw fail(409, "انتهى وقت المحاولة أو تم التسليم بالفعل.");
        result = state(updated[0]);
      }
    } else if (action === 'ping') result = { ok:true, exam:EXAM, duration_minutes:150 };
    else throw fail(400, "طلب غير معروف.");
    return new Response(JSON.stringify(result), {status:200,headers});
  } catch (e: any) {
    const code = Number(e?.code) >= 400 && Number(e?.code) < 500 ? Number(e.code) : 500;
    if (code === 500) console.error('azhar exam error', e);
    return new Response(JSON.stringify({error:code===500?'حدث عطل مؤقت في حفظ البيانات. حاول مجددًا.':e.data?.error}), {status:code,headers});
  }
});
