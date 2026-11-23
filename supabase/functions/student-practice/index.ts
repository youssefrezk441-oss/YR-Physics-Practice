import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
function text(v: unknown, max = 20000) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function numericInput(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function normalizeUnit(v: unknown) {
  return text(v, 80).toLowerCase().replace(/\s+/g, "");
}
function shuffled<T>(items: T[]) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function gradeNumber(v: unknown) {
  const s = text(v, 120);
  if (!s) return null;
  if (/^2(?:\D|$)/.test(s) || s.includes("الثاني")) return 2;
  if (/^3(?:\D|$)/.test(s) || s.includes("الثالث")) return 3;
  return null;
}
function courseAllowed(scope: unknown, profile: any, role: unknown) {
  if (role === "admin") return true;
  const grade = gradeNumber(profile?.grade_level);
  const allowed = Array.isArray(scope)
    ? scope.map(Number).filter(Number.isFinite)
    : [];
  return grade != null && allowed.includes(grade);
}

const url = Deno.env.get("SUPABASE_URL") ?? "";
const pubKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const pubKey = pubKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";
const authClient = createClient(url, pubKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
const sql = postgres(dbUrl, { prepare: false, max: 1, idle_timeout: 20 });

async function requireUser(req: Request) {
  const h = req.headers.get("Authorization") ?? "";
  if (!h.startsWith("Bearer ")) return null;
  const { data, error } = await authClient.auth.getUser(h.slice(7));
  if (error || !data.user) return null;
  const role = data.user.app_metadata?.role;
  if (role !== "student" && role !== "admin") return null;
  if (role === "student") {
    const [profile] =
      await sql`select student_code,full_name,grade_level,is_active from public.student_profiles where user_id=${data.user.id}::uuid`;
    if (!profile || !profile.is_active) return null;
    return { user: data.user, profile };
  }
  const [admin] =
    await sql`select is_active from public.admin_profiles where user_id = ${data.user.id}::uuid`;
  if (!admin?.is_active) return null;
  return {
    user: data.user,
    profile: {
      student_code: "ADMIN-PREVIEW",
      full_name: data.user.user_metadata?.display_name ?? "معاينة الإدارة",
      grade_level: null,
      is_active: true,
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const auth = await requireUser(req);
    if (!auth)
      return json(
        {
          error: "unauthorized",
          message: "الحساب غير مسموح له بالدخول أو تم إيقافه.",
        },
        401,
      );
    const user = auth.user;
    const role = user.app_metadata?.role;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const action = text(body?.action, 50);
    if (action === "ping")
      return json({
        ok: true,
        user: { id: user.id, role },
        profile: auth.profile,
      });
    if (action === "list_sets") {
      const rows: any[] = await sql`
    select ts.id,ts.slug,ts.title,ts.description,ts.time_limit_minutes,ts.attempts_allowed,ts.shuffle_questions,ts.shuffle_choices,ts.sequence_order,ts.created_at,
      c.id as course_id,c.slug as course_slug,c.title as course_title,c.training_icon,c.created_at as course_created_at,c.sequential_unlock_enabled,c.unlock_threshold,c.grade_scope,
      (select count(*)::int from public.training_set_questions x join public.questions q on q.id=x.question_id where x.training_set_id=ts.id and q.status='active') as question_count,
      (select coalesce(sum(q.points),0)::numeric from public.training_set_questions x join public.questions q on q.id=x.question_id where x.training_set_id=ts.id and q.status='active') as max_score,
      (select count(*)::int from public.attempts a where a.training_set_id=ts.id and a.user_id=${user.id}::uuid) as attempt_count,
      (select max(a.percentage) from public.attempts a where a.training_set_id=ts.id and a.user_id=${user.id}::uuid and a.status='graded' and a.percentage is not null) as best_percentage,
      (select max(a.started_at) from public.attempts a where a.training_set_id=ts.id and a.user_id=${user.id}::uuid) as last_attempt_at
    from public.training_sets ts
    join public.courses c on c.id=ts.course_id
    where ts.status='active' and c.status='active'
    order by c.created_at desc,coalesce(ts.sequence_order,0) desc,ts.created_at desc,ts.title desc`;
      const allowedRows =
        role === "admin"
          ? rows
          : rows.filter((s: any) =>
              courseAllowed(s.grade_scope, auth.profile, role),
            );
      const byCourseSeq = new Map<string, any>();
      for (const s of allowedRows) {
        if (s.sequence_order != null)
          byCourseSeq.set(
            String(s.course_id) + ":" + String(s.sequence_order),
            s,
          );
      }
      const sets = allowedRows.map((s: any) => {
        const seq = s.sequence_order == null ? null : Number(s.sequence_order),
          threshold = Number(s.unlock_threshold ?? 80);
        let locked = false,
          prerequisite: any = null,
          prereqBest: number | null = null;
        if (
          role === "student" &&
          s.sequential_unlock_enabled &&
          seq != null &&
          seq > 1
        ) {
          prerequisite =
            byCourseSeq.get(String(s.course_id) + ":" + String(seq - 1)) ??
            null;
          prereqBest =
            prerequisite?.best_percentage == null
              ? null
              : Number(prerequisite.best_percentage);
          locked =
            !prerequisite ||
            !Number.isFinite(prereqBest as number) ||
            (prereqBest as number) < threshold;
        }
        const remaining =
          s.attempts_allowed == null
            ? null
            : Math.max(0, Number(s.attempts_allowed) - Number(s.attempt_count));
        return {
          ...s,
          remaining_attempts: remaining,
          is_locked: locked,
          unlock_threshold: threshold,
          prerequisite_slug: prerequisite?.slug ?? null,
          prerequisite_title: prerequisite?.title ?? null,
          prerequisite_best_percentage: prereqBest,
          lock_reason: locked
            ? `يُفتح بعد الحصول على ${threshold}% على الأقل في ${prerequisite?.title ?? "التدريب السابق"}.`
            : null,
        };
      });
      return json({ sets });
    }
    if (action === "history") {
      const rows =
        await sql`select a.id,a.started_at,a.submitted_at,a.status,a.score,a.max_score,a.percentage,ts.slug,ts.title,c.slug as course_slug,c.title as course_title,c.training_icon from public.attempts a join public.training_sets ts on ts.id=a.training_set_id join public.courses c on c.id=ts.course_id where a.user_id=${user.id}::uuid order by a.started_at desc limit 100`;
      return json({ attempts: rows });
    }
    if (action === "attempt_review") {
      const attemptId = text(body?.attempt_id, 80);
      if (!attemptId) return json({ error: "missing_attempt_id" }, 400);
      const [attempt] =
        await sql`select a.id,a.training_set_id,a.started_at,a.submitted_at,a.status,a.score,a.max_score,a.percentage,ts.slug,ts.title from public.attempts a join public.training_sets ts on ts.id=a.training_set_id where a.id=${attemptId}::uuid and a.user_id=${user.id}::uuid and a.status in ('submitted','graded') limit 1`;
      if (!attempt)
        return json(
          {
            error: "attempt_not_found",
            message: "المحاولة غير متاحة للمراجعة.",
          },
          404,
        );
      const rows = await sql`
    select q.id as question_id,q.question_code,q.type,q.difficulty,q.stem,q.points,q.explanation,tsq.sort_order,
      r.selected_choice_id,r.numeric_value,r.unit_text,r.text_answer,r.awarded_points,r.grading_status,r.feedback,
      sc.choice_text as selected_choice_text,sc.label as selected_choice_label,
      cc.choice_text as correct_choice_text,cc.label as correct_choice_label,
      k.numeric_answer as correct_numeric_answer,k.accepted_units,k.model_answer,
      coalesce((select json_agg(json_build_object('asset_type',qa.asset_type,'storage_path',qa.storage_path,'caption',qa.caption,'alt_text',qa.alt_text,'sort_order',qa.sort_order) order by qa.sort_order) from public.question_assets qa where qa.question_id=q.id),'[]'::json) as assets
    from public.training_set_questions tsq
    join public.questions q on q.id=tsq.question_id
    left join public.responses r on r.attempt_id=${attemptId}::uuid and r.question_id=q.id
    left join public.question_choices sc on sc.id=r.selected_choice_id
    left join private.question_keys k on k.question_id=q.id
    left join public.question_choices cc on cc.id=k.correct_choice_id
    where tsq.training_set_id=${attempt.training_set_id}::uuid and q.status='active'
    order by tsq.sort_order,q.question_code`;
      const questions = rows.map((r: any) => ({
        ...r,
        points: Number(r.points),
        awarded_points:
          r.awarded_points == null ? null : Number(r.awarded_points),
        model_answer:
          r.type === "short_text" && r.grading_status === "review"
            ? null
            : r.model_answer,
      }));
      return json({ attempt, questions });
    }
    if (action === "start") {
      const slug = text(body?.slug, 150);
      if (!slug) return json({ error: "missing_slug" }, 400);
      const [set] =
        await sql`select ts.id,ts.slug,ts.title,ts.description,ts.time_limit_minutes,ts.attempts_allowed,ts.shuffle_questions,ts.shuffle_choices,ts.sequence_order,ts.course_id,c.sequential_unlock_enabled,c.unlock_threshold,c.grade_scope from public.training_sets ts join public.courses c on c.id=ts.course_id where ts.slug=${slug} and ts.status='active' and c.status='active' limit 1`;
      if (!set) return json({ error: "set_not_found" }, 404);
      if (
        role === "student" &&
        !courseAllowed(set.grade_scope, auth.profile, role)
      )
        return json(
          {
            error: "grade_not_allowed",
            message: "هذا التدريب مخصص لصف دراسي آخر وغير متاح لحسابك.",
          },
          403,
        );
      if (
        role === "student" &&
        set.sequential_unlock_enabled &&
        Number(set.sequence_order ?? 1) > 1
      ) {
        const [prev] =
          await sql`select id,title,slug from public.training_sets where course_id=${set.course_id}::uuid and sequence_order=${Number(set.sequence_order) - 1} limit 1`;
        if (!prev)
          return json(
            {
              error: "training_locked",
              message:
                "هذا التدريب مقفول مؤقتًا لأن التدريب السابق غير مضبوط في تسلسل الكورس.",
            },
            403,
          );
        const [best] =
          await sql`select max(percentage) as pct from public.attempts where training_set_id=${prev.id}::uuid and user_id=${user.id}::uuid and status='graded' and percentage is not null`;
        const threshold = Number(set.unlock_threshold ?? 80),
          pct = best?.pct == null ? null : Number(best.pct);
        if (pct == null || pct < threshold)
          return json(
            {
              error: "training_locked",
              message: `هذا التدريب يُفتح بعد الحصول على ${threshold}% على الأقل في ${prev.title}.`,
              prerequisite: {
                slug: prev.slug,
                title: prev.title,
                best_percentage: pct,
                threshold,
              },
            },
            403,
          );
      }
      let questions: any[] =
        await sql`select q.id,q.question_code,q.type,q.difficulty,q.stem,q.points,q.tags,tsq.sort_order from public.training_set_questions tsq join public.questions q on q.id=tsq.question_id where tsq.training_set_id=${set.id}::uuid and q.status='active' order by tsq.sort_order,q.question_code`;
      if (!questions.length) return json({ error: "empty_set" }, 400);
      if (set.shuffle_questions) questions = shuffled(questions);
      const maxScore = questions.reduce((s, q) => s + Number(q.points), 0);
      const output = [];
      for (const q of questions) {
        let choices: any[] =
          q.type === "mcq"
            ? await sql`select id,label,choice_text,sort_order from public.question_choices where question_id=${q.id}::uuid order by sort_order,label`
            : [];
        if (set.shuffle_choices && choices.length) choices = shuffled(choices);
        output.push({
          id: q.id,
          question_code: q.question_code,
          type: q.type,
          difficulty: q.difficulty,
          stem: q.stem,
          points: Number(q.points),
          tags: q.tags ?? [],
          choices,
        });
      }
      const attempt = await sql.begin(async (tx) => {
        if (set.attempts_allowed != null) {
          await tx`select pg_advisory_xact_lock(hashtextextended(${"practice-start:" + user.id + ":" + set.id}, 0))`;
          const [count] = await tx`
       select count(*)::int as n from public.attempts
       where training_set_id = ${set.id}::uuid and user_id = ${user.id}::uuid`;
          if (Number(count.n) >= Number(set.attempts_allowed)) return null;
        }
        const [created] = await tx`
      insert into public.attempts (training_set_id, user_id, status, max_score)
      values (${set.id}::uuid, ${user.id}::uuid, 'in_progress', ${maxScore})
      returning id, started_at, status, max_score`;
        return created;
      });
      if (!attempt)
        return json(
          {
            error: "attempt_limit_reached",
            message: "تم استنفاد عدد المحاولات المسموح بها.",
          },
          403,
        );
      return json({ attempt, training_set: set, questions: output });
    }
    if (action === "submit_attempt") {
      const attemptId = text(body?.attempt_id, 80);
      const answers = Array.isArray(body?.answers) ? body.answers : [];
      if (!attemptId) return json({ error: "missing_attempt_id" }, 400);
      const result = await sql.begin(async (tx) => {
        const [attempt] =
          await tx`select a.*,ts.title as training_title from public.attempts a join public.training_sets ts on ts.id=a.training_set_id where a.id=${attemptId}::uuid and a.user_id=${user.id}::uuid for update of a`;
        if (!attempt) throw new Error("attempt_not_found");
        if (attempt.status !== "in_progress") {
          const previous =
            await tx`select r.question_id,r.grading_status,r.awarded_points,r.feedback,q.points,q.explanation,k.correct_choice_id,k.numeric_answer,k.accepted_units from public.responses r join public.questions q on q.id=r.question_id left join private.question_keys k on k.question_id=q.id where r.attempt_id=${attemptId}::uuid order by r.answered_at`;
          return { attempt, results: previous, already_submitted: true };
        }
        const qs =
          await tx`select q.id,q.type,q.points,q.explanation,k.correct_choice_id,k.numeric_answer,k.numeric_tolerance,k.accepted_units,k.grading_mode from public.training_set_questions tsq join public.questions q on q.id=tsq.question_id join private.question_keys k on k.question_id=q.id where tsq.training_set_id=${attempt.training_set_id}::uuid and q.status='active' order by tsq.sort_order,q.question_code`;
        if (!qs.length) throw new Error("empty_set");
        const map = new Map<string, any>();
        for (const a of answers) {
          const qid = text(a?.question_id, 80);
          if (qid && !map.has(qid)) map.set(qid, a);
        }
        const results = [];
        let score = 0,
          maxScore = 0,
          needsReview = false;
        for (const q of qs) {
          maxScore += Number(q.points);
          const a = map.get(String(q.id)) ?? {};
          let selectedChoiceId: string | null = null,
            numericValue: number | null = null,
            unitText: string | null = null,
            textAnswer: string | null = null,
            awarded = 0,
            status = "incorrect",
            feedback = "";
          if (q.type === "mcq") {
            selectedChoiceId = text(a?.selected_choice_id, 80) || null;
            if (selectedChoiceId) {
              const [valid] =
                await tx`select id from public.question_choices where id=${selectedChoiceId}::uuid and question_id=${q.id}::uuid`;
              if (!valid) selectedChoiceId = null;
            }
            if (
              selectedChoiceId &&
              String(selectedChoiceId) === String(q.correct_choice_id)
            ) {
              awarded = Number(q.points);
              status = "correct";
              feedback = "إجابة صحيحة.";
            } else
              feedback = selectedChoiceId
                ? "الإجابة غير صحيحة."
                : "لم تتم الإجابة.";
          } else if (q.type === "numeric") {
            numericValue = numericInput(a?.numeric_value);
            unitText = text(a?.unit_text, 80) || null;
            const target = numericInput(q.numeric_answer),
              tol = Math.max(0, Number(q.numeric_tolerance ?? 0));
            const valueOk =
              numericValue !== null &&
              target !== null &&
              Math.abs(numericValue - target) <= tol;
            const accepted = (q.accepted_units ?? [])
              .map((u: any) => normalizeUnit(u))
              .filter(Boolean);
            const unitOk =
              accepted.length === 0 ||
              accepted.includes(normalizeUnit(unitText));
            if (valueOk && unitOk) {
              awarded = Number(q.points);
              status = "correct";
              feedback = "إجابة صحيحة.";
            } else
              feedback =
                numericValue === null
                  ? "لم تتم الإجابة."
                  : "الإجابة الرقمية أو الوحدة غير صحيحة.";
          } else {
            textAnswer = text(a?.text_answer, 20000) || null;
            status = "review";
            feedback = textAnswer
              ? "تم استلام الإجابة وتحتاج إلى مراجعة."
              : "لم تتم الإجابة.";
            needsReview = true;
          }
          score += awarded;
          await tx`insert into public.responses(attempt_id,question_id,selected_choice_id,numeric_value,unit_text,text_answer,awarded_points,grading_status,feedback,answered_at) values(${attemptId}::uuid,${q.id}::uuid,${selectedChoiceId}::uuid,${numericValue},${unitText},${textAnswer},${awarded},${status},${feedback},now()) on conflict(attempt_id,question_id) do update set selected_choice_id=excluded.selected_choice_id,numeric_value=excluded.numeric_value,unit_text=excluded.unit_text,text_answer=excluded.text_answer,awarded_points=excluded.awarded_points,grading_status=excluded.grading_status,feedback=excluded.feedback,answered_at=now()`;
          results.push({
            question_id: q.id,
            grading_status: status,
            awarded_points: awarded,
            max_points: Number(q.points),
            correct_choice_id: q.type === "mcq" ? q.correct_choice_id : null,
            correct_numeric_answer:
              q.type === "numeric" ? q.numeric_answer : null,
            accepted_units: q.type === "numeric" ? q.accepted_units : [],
            explanation: q.explanation ?? null,
            feedback,
          });
        }
        const pct =
          maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0;
        const finalStatus = needsReview ? "submitted" : "graded";
        const [updated] =
          await tx`update public.attempts set submitted_at=now(),status=${finalStatus},score=${score},max_score=${maxScore},percentage=${pct} where id=${attemptId}::uuid returning id,training_set_id,user_id,started_at,submitted_at,status,score,max_score,percentage`;
        return { attempt: updated, results, already_submitted: false };
      });
      return json({ ok: true, ...result });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error(e);
    const m = e instanceof Error ? e.message : "server_error";
    if (m === "attempt_not_found") return json({ error: m }, 404);
    if (m === "empty_set") return json({ error: m }, 400);
    if (m.startsWith("training_locked:"))
      return json(
        {
          error: "training_locked",
          message: "هذا التدريب مقفول حتى تحقق شرط التدريب السابق.",
        },
        403,
      );
    return json(
      {
        error: "server_error",
        message: "تعذر إتمام طلب التدريب. حاول مرة أخرى.",
      },
      500,
    );
  }
});
