import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";

const C = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const url = Deno.env.get("SUPABASE_URL") ?? "";
const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const key = keys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const db = Deno.env.get("SUPABASE_DB_URL") ?? "";
const authClient = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const sql = postgres(db, { prepare: false, max: 3, idle_timeout: 20 });
const MCQ_OPTIONS = ["أ", "ب", "ج", "د"];

const j = (x: unknown, status = 200) =>
  new Response(JSON.stringify(x), {
    status,
    headers: {
      ...C,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
const txt = (v: unknown, n = 200) => typeof v === "string" ? v.trim().slice(0, n) : "";
function canonGrade(v: unknown) {
  const s = String(v ?? "").trim();
  if (s === "3 ثانوي" || s === "الصف الثالث الثانوي" || /^3(?:\D|$)/.test(s) || s.includes("الثالث")) {
    return "الصف الثالث الثانوي";
  }
  return s;
}
function normLetter(v: unknown) {
  return txt(v, 10).replace(/[\s.،,:;\-]/g, "");
}
function normNumeric(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function safeArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
function uniqueLetters(v: unknown) {
  return [...new Set(safeArray(v).map(normLetter).filter(Boolean))];
}
function cleanProgress(p: Record<string, unknown> | undefined) {
  if (!p) return null;
  return { ...p, tried_answers: safeArray(p.tried_answers).map(String) };
}
function displayFor(k: Record<string, any>, answer: Record<string, any>, pidx: number) {
  if (answer.kind === "mcq") {
    const correct = uniqueLetters(answer.correct);
    if (Array.isArray(k.answer_key?.parts)) {
      const label = k.answer_key.parts[pidx - 1]?.label ?? `المطلوب (${pidx})`;
      return `${label}: ${correct.join(" أو ")}`;
    }
    return k.display_answer || correct.join(" أو ");
  }
  return k.display_answer || String(answer.value);
}
function partAnswer(key: Record<string, any> | undefined, partIndex: number) {
  if (Array.isArray(key?.parts)) {
    const idx = Math.max(1, partIndex) - 1;
    const p = key.parts[idx];
    return p ? { kind: "mcq", correct: safeArray(p.correct), label: p.label ?? `المطلوب (${idx + 1})` } : null;
  }
  if (Array.isArray(key?.correct)) return { kind: "mcq", correct: key.correct, label: null };
  if (key && Number.isFinite(Number(key.value))) return { kind: "numeric", value: Number(key.value), label: null };
  return null;
}

async function requireAllowed(req: Request) {
  const h = req.headers.get("Authorization") ?? "";
  if (!h.startsWith("Bearer ")) return null;
  const { data, error } = await authClient.auth.getUser(h.slice(7));
  if (error || !data.user) return null;
  const u = data.user;
  const role = u.app_metadata?.role;
  if (role === "admin") {
    return {
      user: u,
      role,
      profile: {
        full_name: u.user_metadata?.display_name ?? "معاينة الإدارة",
        grade_level: "الصف الثالث الثانوي",
        is_active: true,
      },
    };
  }
  if (role !== "student") return null;
  const [p] = await sql`
    select sp.student_code, sp.full_name, sp.grade_level, sp.group_code,
           sp.center_name, sp.is_active, sg.grade_level as group_grade
    from public.student_profiles sp
    left join public.student_groups sg on sg.group_code = sp.group_code
    where sp.user_id = ${u.id}::uuid
    limit 1
  `;
  if (!p?.is_active) return null;
  const grade = canonGrade(p.group_grade ?? p.grade_level);
  if (grade !== "الصف الثالث الثانوي") {
    return { denied: true, user: u, role, profile: { ...p, grade_level: grade } };
  }
  return { user: u, role, profile: { ...p, grade_level: grade } };
}

async function readProgress(dbx: any, uid: string, bankNo: number, pidx: number) {
  const [p] = await dbx`
    select bank_no, part_index, attempts_count, tried_answers, first_attempt_correct,
           mastered, revealed, last_answer
    from public.l3_workshop_progress
    where user_id = ${uid}::uuid and bank_no = ${bankNo} and part_index = ${pidx}
    limit 1
  `;
  return cleanProgress(p);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: C });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);
  const a = await requireAllowed(req);
  if (!a) return j({ error: "unauthorized", message: "يجب تسجيل الدخول بحساب طالب نشط." }, 401);
  if (a.denied) return j({ error: "grade_not_allowed", message: "هذه الورشة متاحة لطلاب الصف الثالث الثانوي فقط." }, 403);

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return j({ error: "invalid_json" }, 400);
  }
  const action = txt(body?.action, 40);
  const uid = a.user.id;

  try {
    if (action === "ping") {
      return j({
        ok: true,
        profile: {
          student_code: a.profile.student_code ?? null,
          full_name: a.profile.full_name ?? null,
          grade_level: a.profile.grade_level,
        },
        role: a.role,
      });
    }

    if (action === "list") {
      const track = body?.track === "class" ? "class" : "home";
      const qs = await sql`
        select bank_no, skill, skill_name, difficulty, track, sort_order,
               question_type, unit_text, numeric_tolerance
        from public.l3_workshop_questions
        where active = true and track = ${track}
        order by sort_order, bank_no
      `;
      const rows = a.role === "admin" ? [] : await sql`
        select bank_no, part_index, attempts_count, tried_answers, first_attempt_correct,
               mastered, revealed, last_answer
        from public.l3_workshop_progress
        where user_id = ${uid}::uuid
          and bank_no in (
            select bank_no from public.l3_workshop_questions
            where active = true and track = ${track}
          )
        order by bank_no, part_index
      `;
      return j({ ok: true, track, questions: qs, progress: rows.map(cleanProgress) });
    }

    if (action === "attempt") {
      if (a.role === "admin") {
        return j({ error: "admin_read_only", message: "معاينة الإدارة لا تسجل محاولات." }, 403);
      }
      const bankNo = Number(body?.bank_no);
      const partIndex = Math.max(0, Number(body?.part_index ?? 0));
      if (!Number.isInteger(bankNo) || !Number.isInteger(partIndex)) return j({ error: "invalid_question" }, 400);

      const [q] = await sql`
        select bank_no, question_type, numeric_tolerance, source_note
        from public.l3_workshop_questions
        where bank_no = ${bankNo} and active = true
        limit 1
      `;
      if (!q) return j({ error: "question_not_found" }, 404);
      const [k] = await sql`
        select answer_key, display_answer
        from private.l3_workshop_keys
        where bank_no = ${bankNo} and verified = true
        limit 1
      `;
      if (!k) return j({ error: "key_not_found" }, 500);
      const answer = partAnswer(k.answer_key, partIndex);
      if (!answer) return j({ error: "invalid_part" }, 400);
      const pidx = Array.isArray(k.answer_key?.parts) ? Math.max(1, partIndex) : 0;

      let normalized: string;
      let correct = false;
      if (answer.kind === "mcq") {
        normalized = normLetter(body?.answer);
        if (!normalized || !MCQ_OPTIONS.includes(normalized)) return j({ error: "missing_answer" }, 400);
        correct = uniqueLetters(answer.correct).includes(normalized);
      } else {
        const n = normNumeric(body?.answer);
        if (n === null) return j({ error: "invalid_numeric", message: "اكتب قيمة رقمية صحيحة." }, 400);
        normalized = String(n);
        const tol = Math.max(0, Number(q.numeric_tolerance ?? 0));
        correct = Math.abs(n - Number(answer.value)) <= tol;
      }

      const result = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`${uid}:${bankNo}:${pidx}`}, 0))`;
        const old = await readProgress(tx, uid, bankNo, pidx);
        const attempts = Number(old?.attempts_count ?? 0);
        const tried = safeArray(old?.tried_answers).map(String);

        if (old?.mastered) {
          return { already_mastered: true, correct: true, can_reveal: false, progress: old };
        }
        if (old?.revealed) {
          return {
            already_revealed: true,
            correct: false,
            assisted: true,
            can_reveal: false,
            display_answer: displayFor(k, answer, pidx),
            progress: old,
          };
        }
        if (answer.kind === "numeric" && attempts >= 3) {
          return {
            locked: true,
            correct: false,
            can_reveal: true,
            message: "تم استنفاد 3 محاولات. يمكنك إظهار الإجابة.",
            progress: old,
          };
        }
        if (tried.includes(normalized)) {
          return {
            duplicate: true,
            correct: false,
            can_reveal: answer.kind === "numeric" && attempts >= 3,
            message: "هذه الإجابة جربتها من قبل ولن تُحسب محاولة جديدة.",
            progress: old,
          };
        }

        const nextAttempts = attempts + 1;
        const newTried = [...tried, normalized];
        let autoAssisted = false;
        let autoDisplay: string | null = null;
        if (!correct && answer.kind === "mcq") {
          const correctSet = uniqueLetters(answer.correct);
          const wrongOptions = MCQ_OPTIONS.filter((x) => !correctSet.includes(x));
          const distinctWrong = new Set(newTried.map(normLetter).filter((x) => wrongOptions.includes(x)));
          if (wrongOptions.length > 0 && distinctWrong.size >= wrongOptions.length) {
            autoAssisted = true;
            autoDisplay = displayFor(k, answer, pidx);
          }
        }

        const [saved] = await tx`
          insert into public.l3_workshop_progress
            (user_id, bank_no, part_index, attempts_count, tried_answers,
             first_attempt_correct, mastered, revealed, last_answer, updated_at)
          values (
            ${uid}::uuid, ${bankNo}, ${pidx}, ${nextAttempts}, ${tx.json(newTried)},
            ${nextAttempts === 1 ? correct : old?.first_attempt_correct ?? false},
            ${correct}, ${autoAssisted}, ${normalized}, now()
          )
          on conflict (user_id, bank_no, part_index) do update set
            attempts_count = excluded.attempts_count,
            tried_answers = excluded.tried_answers,
            first_attempt_correct = coalesce(
              public.l3_workshop_progress.first_attempt_correct,
              excluded.first_attempt_correct
            ),
            mastered = excluded.mastered,
            revealed = excluded.revealed,
            last_answer = excluded.last_answer,
            updated_at = now()
          returning bank_no, part_index, attempts_count, tried_answers,
                    first_attempt_correct, mastered, revealed, last_answer
        `;
        await tx`
          insert into public.l3_workshop_events
            (user_id, bank_no, part_index, event_type, attempt_no, answer_text, is_correct)
          values (${uid}::uuid, ${bankNo}, ${pidx}, 'attempt', ${nextAttempts}, ${normalized}, ${correct})
        `;
        if (autoAssisted) {
          await tx`
            insert into public.l3_workshop_events
              (user_id, bank_no, part_index, event_type, attempt_no, answer_text, is_correct)
            values (${uid}::uuid, ${bankNo}, ${pidx}, 'reveal', null, null, null)
            on conflict do nothing
          `;
        }

        const progress = cleanProgress(saved);
        if (correct) {
          return {
            correct: true,
            assisted: false,
            can_reveal: false,
            source_note: q.source_note ?? null,
            message: "إجابة صحيحة.",
            progress,
          };
        }
        if (autoAssisted) {
          return {
            correct: false,
            assisted: true,
            can_reveal: false,
            display_answer: autoDisplay,
            message: `بعد استبعاد جميع البدائل الخاطئة، الإجابة الصحيحة هي: ${autoDisplay}. سُجل السؤال كتعلّم بمساعدة، وليس إتقانًا مستقلًا.`,
            progress,
          };
        }
        return {
          correct: false,
          assisted: false,
          can_reveal: answer.kind === "numeric" && nextAttempts >= 3,
          message: answer.kind === "numeric" && nextAttempts >= 3
            ? "ليست صحيحة. يمكنك الآن إظهار الإجابة."
            : "ليست صحيحة. راجع فكرتك وحاول مرة أخرى.",
          progress,
        };
      });
      return j({ ok: true, ...result });
    }

    if (action === "reveal") {
      if (a.role === "admin") return j({ error: "admin_read_only" }, 403);
      const bankNo = Number(body?.bank_no);
      const partIndex = Math.max(0, Number(body?.part_index ?? 0));
      if (!Number.isInteger(bankNo) || !Number.isInteger(partIndex)) return j({ error: "invalid_question" }, 400);
      const [k] = await sql`
        select answer_key, display_answer
        from private.l3_workshop_keys
        where bank_no = ${bankNo} and verified = true
        limit 1
      `;
      if (!k) return j({ error: "question_not_found" }, 404);
      const pidx = Array.isArray(k.answer_key?.parts) ? Math.max(1, partIndex) : 0;
      const answer = partAnswer(k.answer_key, partIndex);
      if (!answer) return j({ error: "invalid_part" }, 400);
      if (answer.kind === "mcq") {
        return j({
          error: "reveal_not_applicable",
          message: "في الأسئلة الاختيارية تظهر الإجابة تلقائيًا بعد استبعاد جميع البدائل الخاطئة.",
        }, 403);
      }

      const result = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`${uid}:${bankNo}:${pidx}`}, 0))`;
        const p = await readProgress(tx, uid, bankNo, pidx);
        if (p?.mastered) return { mastered: true, message: "تم إتقان السؤال بالفعل.", progress: p };
        if (p?.revealed) {
          return {
            mastered: false,
            assisted: true,
            display_answer: displayFor(k, answer, pidx),
            progress: p,
          };
        }
        if (Number(p?.attempts_count ?? 0) < 3) {
          return { error: "reveal_not_allowed", message: "يتاح إظهار الإجابة بعد 3 محاولات مختلفة." };
        }
        const [saved] = await tx`
          update public.l3_workshop_progress
          set revealed = true, updated_at = now()
          where user_id = ${uid}::uuid and bank_no = ${bankNo} and part_index = ${pidx}
          returning bank_no, part_index, attempts_count, tried_answers,
                    first_attempt_correct, mastered, revealed, last_answer
        `;
        await tx`
          insert into public.l3_workshop_events
            (user_id, bank_no, part_index, event_type, attempt_no, answer_text, is_correct)
          values (${uid}::uuid, ${bankNo}, ${pidx}, 'reveal', null, null, null)
          on conflict do nothing
        `;
        return {
          mastered: false,
          assisted: true,
          display_answer: displayFor(k, answer, pidx),
          progress: cleanProgress(saved),
        };
      });
      if (result.error) return j(result, 403);
      return j({ ok: true, ...result });
    }

    if (action === "summary") {
      const [s] = await sql`
        select count(*)::int question_parts,
               count(*) filter (where mastered)::int mastered_parts,
               count(*) filter (where revealed)::int revealed_parts,
               count(*) filter (where first_attempt_correct = true)::int first_correct_parts,
               coalesce(sum(attempts_count), 0)::int attempts
        from public.l3_workshop_progress
        where user_id = ${uid}::uuid
      `;
      return j({ ok: true, summary: s ?? {} });
    }
    return j({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("lecture3-workshop", e);
    return j({ error: "server_error", message: "تعذر تنفيذ العملية الآن." }, 500);
  }
});
