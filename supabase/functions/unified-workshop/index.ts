import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";
import { readWorkshopJson, WorkshopRequestError } from "../_shared/workshop-security.ts";
import {
  decideInteractiveAttempt,
  gradeWorkshopAnswer,
  normalizeWorkshopAnswer,
  validateExpectedRevision,
  validateRequestId,
  WorkshopContractError,
  type WorkshopInputType,
  type WorkshopProgressState,
} from "../_shared/unified-workshop-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const SUPABASE_KEY = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const DATABASE_URL = Deno.env.get("SUPABASE_DB_URL") ?? "";
const authClient = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const sql = postgres(DATABASE_URL, { prepare: false, max: 4, idle_timeout: 20 });
const allowedOrigins = new Set([
  "https://youssefrezk441-oss.github.io",
  "http://127.0.0.1:8000",
  "http://localhost:8000",
]);

const text = (value: unknown, max = 300) => String(value ?? "").normalize("NFKC").trim().slice(0, max);
const safeArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const jsonObject = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const canonicalGrade = (value: unknown) => {
  const grade = text(value, 100);
  if (grade === "3 ثانوي" || grade === "الصف الثالث الثانوي" || /^3(?:\D|$)/.test(grade) || grade.includes("الثالث")) return "الصف الثالث الثانوي";
  return grade;
};
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
async function sha256(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, "0")).join("");
}
function headers(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://youssefrezk441-oss.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}
const response = (req: Request, value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: headers(req) });

async function requireAccount(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const { data, error } = await authClient.auth.getUser(authorization.slice(7));
  if (error || !data.user) return null;
  const role = String(data.user.app_metadata?.role ?? "");
  if (role === "admin") return { user: data.user, role, profile: { student_code: null, full_name: data.user.user_metadata?.display_name ?? "معاينة الإدارة", grade_level: "الصف الثالث الثانوي", group_code: null, is_active: true } };
  if (role !== "student") return null;
  const [profile] = await sql`
    select sp.student_code, sp.full_name, sp.grade_level, sp.group_code, sp.center_name,
           sp.is_active, sg.grade_level as group_grade
    from public.student_profiles sp
    left join public.student_groups sg on sg.group_code = sp.group_code
    where sp.user_id = ${data.user.id}::uuid
    limit 1`;
  if (!profile?.is_active) return null;
  return { user: data.user, role, profile: { ...profile, grade_level: canonicalGrade(profile.group_grade ?? profile.grade_level) } };
}

function eligible(profile: Record<string, unknown>, workshop: Record<string, unknown>) {
  if (canonicalGrade(profile.grade_level) !== canonicalGrade(workshop.grade_level)) return false;
  const groups = safeArray(workshop.eligible_group_codes).map(String);
  return groups.length === 0 || groups.includes(String(profile.group_code ?? ""));
}

async function getWorkshop(slug: string, publishedOnly = true) {
  const [workshop] = await sql`
    select definition.id, definition.slug, definition.title, definition.grade_level,
           definition.academic_term, definition.lecture_no, definition.status,
           definition.eligible_group_codes, definition.active_version_id,
           version.version_no, version.content_sha256
    from private.workshop_definitions definition
    join private.workshop_versions version on version.id = definition.active_version_id
    where definition.slug = ${slug}
      ${publishedOnly ? sql`and definition.status = 'published' and version.status = 'published'` : sql``}
    limit 1`;
  return workshop ?? null;
}

async function ensureCycle(tx: postgres.TransactionSql, workshopId: string, userId: string) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`workshop-cycle:${workshopId}:${userId}`}, 0))`;
  const [existing] = await tx`
    select * from private.workshop_cycles
    where workshop_id = ${workshopId}::uuid and user_id = ${userId}::uuid and status = 'open'
    order by cycle_no desc limit 1 for update`;
  if (existing) return existing;
  const [created] = await tx`
    insert into private.workshop_cycles
      (workshop_id, user_id, cycle_no, source, scope_kind, scope_ref, opened_reason)
    select ${workshopId}::uuid, ${userId}::uuid,
           coalesce(max(cycle_no), 0) + 1, 'initial', 'workshop', null,
           'Initial workshop cycle created by authenticated student access'
    from private.workshop_cycles
    where workshop_id = ${workshopId}::uuid and user_id = ${userId}::uuid
    returning *`;
  return created;
}

function cycleAllows(cycle: Record<string, unknown>, trackKey: string, questionRef?: string) {
  if (cycle.scope_kind === "workshop") return true;
  if (cycle.scope_kind === "track") return cycle.scope_ref === trackKey;
  return cycle.scope_kind === "question" && cycle.scope_ref === questionRef;
}

async function getTrackContext(slug: string, trackKey: string, questionRef?: string, partKey?: string) {
  const [row] = await sql`
    select definition.id as workshop_id, definition.slug, definition.title, definition.grade_level,
           definition.eligible_group_codes, definition.active_version_id as version_id,
           track.id as track_id, track.track_key, track.mode, track.policy,
           question.id as question_id, question.question_ref,
           part.id as part_id, part.part_key, part.input_type, part.options_public,
           part.max_points
    from private.workshop_definitions definition
    join private.workshop_versions version on version.id = definition.active_version_id and version.status = 'published'
    join private.workshop_tracks track on track.version_id = version.id and track.track_key = ${trackKey}
    left join private.workshop_track_questions placement on placement.track_id = track.id
    left join private.workshop_questions question on question.id = placement.question_id and question.active = true
      and (${questionRef ?? ""} = '' or question.question_ref = ${questionRef ?? ""})
    left join private.workshop_question_parts part on part.question_id = question.id
      and (${partKey ?? ""} = '' or part.part_key = ${partKey ?? ""})
    where definition.slug = ${slug} and definition.status = 'published'
      and (${questionRef ?? ""} = '' or question.id is not null)
      and (${partKey ?? ""} = '' or part.id is not null)
    order by placement.sort_order, part.sort_order
    limit 1`;
  return row ?? null;
}

async function loadWorkshop(account: NonNullable<Awaited<ReturnType<typeof requireAccount>>>, slug: string, trackKey: string) {
  const workshop = await getWorkshop(slug);
  if (!workshop) throw new WorkshopContractError(404, "workshop_not_found", "هذه الورشة غير متاحة حاليًا.");
  if (account.role !== "admin" && !eligible(account.profile, workshop)) throw new WorkshopContractError(403, "workshop_not_allowed", "هذه الورشة غير متاحة لصفك أو مجموعتك.");
  const [track] = await sql`
    select id, track_key, title, mode, policy
    from private.workshop_tracks
    where version_id = ${workshop.active_version_id}::uuid and track_key = ${trackKey}
    limit 1`;
  if (!track) throw new WorkshopContractError(404, "track_not_found", "هذا القسم غير متاح حاليًا.");

  const questions = await sql`
    select question.id, question.question_ref, question.source_ref, question.source_kind,
           question.question_kind, question.title, question.prompt_text, question.image_path,
           question.image_sha256, question.skill_ref, skill.name as skill_name,
           question.difficulty, placement.sort_order
    from private.workshop_track_questions placement
    join private.workshop_questions question on question.id = placement.question_id and question.active = true
    join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
    where placement.track_id = ${track.id}::uuid
    order by placement.sort_order, question.question_ref`;
  const parts = await sql`
    select part.id, part.question_id, part.part_key, part.label, part.input_type,
           part.options_public, part.unit_text, part.max_points, part.public_config, part.sort_order
    from private.workshop_question_parts part
    where part.question_id in (
      select placement.question_id from private.workshop_track_questions placement
      where placement.track_id = ${track.id}::uuid
    )
    order by part.question_id, part.sort_order`;
  const partsByQuestion = new Map<string, unknown[]>();
  for (const part of parts) partsByQuestion.set(String(part.question_id), [...(partsByQuestion.get(String(part.question_id)) ?? []), part]);
  const publicQuestions = questions.map((question) => ({ ...question, parts: partsByQuestion.get(String(question.id)) ?? [] }));

  if (account.role === "admin") return { workshop, track, questions: publicQuestions, cycle: null, progress: [], drafts: [], submission: null };
  const cycle = await sql.begin((tx) => ensureCycle(tx, String(workshop.id), account.user.id));
  if (!cycleAllows(cycle, trackKey)) {
    if (cycle.scope_kind !== "question") throw new WorkshopContractError(403, "reopen_scope_mismatch", "دورة الإعادة الحالية لا تشمل هذا القسم.");
    const [scopedQuestion] = await sql`
      select 1
      from private.workshop_track_questions placement
      join private.workshop_questions question on question.id = placement.question_id
      where placement.track_id = ${track.id}::uuid and question.question_ref = ${String(cycle.scope_ref)}
      limit 1`;
    if (!scopedQuestion) throw new WorkshopContractError(403, "reopen_scope_mismatch", "دورة الإعادة الحالية لا تشمل هذا القسم.");
  }
  const progress = await sql`
    select progress.track_id, progress.part_id, progress.revision, progress.attempts_count,
           progress.tried_answers, progress.first_attempt_correct, progress.independently_mastered,
           progress.assisted, progress.revealed, progress.last_answer,
           case when progress.independently_mastered then active_key.display_answer when progress.revealed or progress.assisted then revealed_key.display_answer else null end as display_answer,
           case when progress.independently_mastered then active_key.explanation when progress.revealed or progress.assisted then revealed_key.explanation else null end as explanation
    from private.workshop_progress progress
    left join private.workshop_reveal_events reveal on reveal.cycle_id = progress.cycle_id
      and reveal.track_id = progress.track_id and reveal.part_id = progress.part_id
    left join private.workshop_part_key_versions revealed_key on revealed_key.id = reveal.key_version_id
    left join private.current_workshop_part_keys active_key on active_key.part_id = progress.part_id
    where progress.cycle_id = ${cycle.id}::uuid and progress.track_id = ${track.id}::uuid`;
  const drafts = track.mode === "final_submit" ? await sql`
    select part_id, answer_json, revision, updated_at from private.workshop_drafts
    where cycle_id = ${cycle.id}::uuid and track_id = ${track.id}::uuid` : [];
  const [submission] = await sql`
    select id, score as original_score, max_score, submitted_at from private.workshop_submissions
    where cycle_id = ${cycle.id}::uuid and track_id = ${track.id}::uuid limit 1`;
  let submissionAnswers: Record<string, any>[] = [];
  if (submission) submissionAnswers = await sql`
    select answer.part_id, answer.answer_json, answer.is_correct as original_is_correct,
           answer.awarded_points as original_awarded_points, answer.max_points,
           decision.is_correct, decision.awarded_points, key.display_answer, key.explanation
    from private.workshop_submission_answers answer
    join private.workshop_submissions stored_submission on stored_submission.id = answer.submission_id
    join private.current_workshop_grading_decisions decision
      on decision.part_id = answer.part_id
     and decision.response_ref = 'submission:' || stored_submission.id::text || ':' || answer.part_id::text
    join private.workshop_part_key_versions key on key.id = decision.key_version_id
    where answer.submission_id = ${submission.id}::uuid` as unknown as Record<string, any>[];
  const currentScore = submissionAnswers.reduce<number>((sum, item) => sum + Number(item.awarded_points ?? 0), 0);
  return {
    workshop, track, questions: publicQuestions, cycle, progress, drafts,
    submission: submission ? { ...submission, score: currentScore, answers: submissionAnswers } : null,
  };
}

function emptyProgress(): WorkshopProgressState {
  return { revision: 0, attempts_count: 0, tried_answers: [], first_attempt_correct: null, independently_mastered: false, assisted: false, revealed: false };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return response(req, { error: "method_not_allowed" }, 405);
  const account = await requireAccount(req);
  if (!account) return response(req, { error: "unauthorized", message: "يجب تسجيل الدخول بحساب نشط." }, 401);
  let body: Record<string, any>;
  try { body = await readWorkshopJson(req) as Record<string, any>; }
  catch (error) {
    if (error instanceof WorkshopRequestError) return response(req, { error: error.code, message: error.message }, error.status);
    return response(req, { error: "invalid_json" }, 400);
  }

  const action = text(body.action, 60);
  const slug = text(body.workshop_slug, 120);
  try {
    if (action === "ping") {
      const workshops = await sql`
        select definition.slug, definition.title, definition.grade_level, definition.academic_term, definition.lecture_no
        from private.workshop_definitions definition
        join private.workshop_versions version on version.id = definition.active_version_id and version.status = 'published'
        where definition.status = 'published'
        order by definition.lecture_no, definition.slug`;
      return response(req, { ok: true, role: account.role, profile: { student_code: account.profile.student_code ?? null, full_name: account.profile.full_name ?? null, grade_level: account.profile.grade_level ?? null, group_code: account.profile.group_code ?? null }, workshops: account.role === "admin" ? workshops : workshops.filter((workshop) => eligible(account.profile, workshop)) });
    }
    if (!slug) throw new WorkshopContractError(400, "missing_workshop", "معرف الورشة مطلوب.");
    const trackKey = body.track === "home" ? "home" : "class";
    if (action === "load") return response(req, { ok: true, ...(await loadWorkshop(account, slug, trackKey)) });
    if (account.role !== "student") throw new WorkshopContractError(403, "admin_read_only", "معاينة الإدارة لا تسجل إجابات طلاب.");

    const questionRef = text(body.question_ref, 120);
    const partKey = action === "submit_track" ? "" : text(body.part_key || "main", 80);
    const context = await getTrackContext(slug, trackKey, questionRef || undefined, partKey || undefined);
    if (!context?.part_id) throw new WorkshopContractError(404, "question_not_found", "السؤال أو الجزء غير متاح.");
    if (!eligible(account.profile, context)) throw new WorkshopContractError(403, "workshop_not_allowed", "هذه الورشة غير متاحة لحسابك.");
    const requestId = validateRequestId(body.request_id);
    const bodyHash = await sha256(body);

    if (action === "attempt") {
      if (context.mode !== "interactive") throw new WorkshopContractError(400, "wrong_track_mode", "هذا القسم يستخدم التسليم النهائي.");
      const expectedRevision = validateExpectedRevision(body.expected_revision);
      const result = await sql.begin(async (tx) => {
        const cycle = await ensureCycle(tx, String(context.workshop_id), account.user.id);
        if (!cycleAllows(cycle, trackKey, questionRef)) throw new WorkshopContractError(403, "reopen_scope_mismatch", "دورة الإعادة الحالية لا تشمل هذا السؤال.");
        await tx`select pg_advisory_xact_lock(hashtextextended(${`workshop-attempt:${cycle.id}:${context.track_id}:${context.part_id}`}, 0))`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${`workshop-key:${context.part_id}`}, 0))`;
        const [receipt] = await tx`select action, body_sha256, response_json from private.workshop_mutation_receipts where user_id = ${account.user.id}::uuid and request_id = ${requestId}::uuid`;
        if (receipt) {
          if (receipt.action !== action || receipt.body_sha256 !== bodyHash) throw new WorkshopContractError(409, "request_id_reused", "تم استخدام معرف الطلب مع بيانات مختلفة.");
          return receipt.response_json;
        }
        const [key] = await tx`select * from private.current_workshop_part_keys where part_id = ${context.part_id}::uuid limit 1`;
        if (!key) throw new WorkshopContractError(503, "key_not_available", "تعذر تصحيح هذا السؤال حاليًا.");
        const graded = gradeWorkshopAnswer(context.input_type as WorkshopInputType, key.answer_spec, body.answer);
        if (context.input_type === "mcq" && !safeArray(context.options_public).some((option) =>
          normalizeWorkshopAnswer("mcq", jsonObject(option).value) === graded.normalized
        )) throw new WorkshopContractError(400, "invalid_answer", "اختر إجابة من البدائل المتاحة.");
        const [stored] = await tx`
          select revision, attempts_count, tried_answers, first_attempt_correct,
                 independently_mastered, assisted, revealed
          from private.workshop_progress
          where cycle_id = ${cycle.id}::uuid and track_id = ${context.track_id}::uuid and part_id = ${context.part_id}::uuid
          for update`;
        const current = stored ? {
          ...stored,
          revision: Number(stored.revision), attempts_count: Number(stored.attempts_count),
          tried_answers: safeArray(stored.tried_answers).map(String),
        } as WorkshopProgressState : emptyProgress();
        const policy = jsonObject(context.policy);
        const decision = decideInteractiveAttempt({
          progress: current,
          policy: {
            max_unique_attempts: Math.max(1, Number(policy.max_unique_attempts ?? 3)),
            reveal_after_attempts: Math.max(1, Number(policy.reveal_after_attempts ?? 3)),
            auto_reveal_mcq: policy.auto_reveal_mcq === true,
          },
          expectedRevision,
          normalized: graded.normalized,
          correct: graded.correct,
          inputType: context.input_type as WorkshopInputType,
          optionCount: safeArray(context.options_public).length,
        });
        let payload: Record<string, any>;
        if (["stale", "duplicate", "already_mastered", "already_assisted", "locked"].includes(decision.kind)) {
          payload = { ok: true, [decision.kind]: true, progress: current, message: decision.kind === "stale" ? "تغير التقدم في جهاز آخر. تم تحميل أحدث حالة دون تسجيل محاولة." : "لم تُسجل محاولة جديدة." };
        } else {
          const next = decision.progress;
          const [progress] = await tx`
            insert into private.workshop_progress
              (cycle_id, track_id, part_id, revision, attempts_count, tried_answers,
               first_attempt_correct, independently_mastered, assisted, revealed, last_answer, updated_at)
            values (${cycle.id}::uuid, ${context.track_id}::uuid, ${context.part_id}::uuid,
                    ${next.revision}, ${next.attempts_count}, ${tx.json(next.tried_answers)},
                    ${next.first_attempt_correct}, ${next.independently_mastered}, ${next.assisted},
                    ${next.revealed}, ${tx.json({ raw: body.answer, normalized: graded.normalized })}, now())
            on conflict (cycle_id, track_id, part_id) do update set
              revision = excluded.revision, attempts_count = excluded.attempts_count,
              tried_answers = excluded.tried_answers, first_attempt_correct = excluded.first_attempt_correct,
              independently_mastered = excluded.independently_mastered, assisted = excluded.assisted,
              revealed = excluded.revealed, last_answer = excluded.last_answer, updated_at = now()
            returning *`;
          const outcome = decision.kind === "mastered" ? (next.first_attempt_correct ? "first_try" : "later_independent") : decision.kind;
          const [event] = await tx`
            insert into private.workshop_attempt_events
              (request_id, cycle_id, track_id, question_id, part_id, attempt_no,
               answer_json, normalized_answer, key_version_id, is_correct, outcome, awarded_points, max_points)
            values (${requestId}::uuid, ${cycle.id}::uuid, ${context.track_id}::uuid,
                    ${context.question_id}::uuid, ${context.part_id}::uuid, ${next.attempts_count},
                    ${tx.json({ raw: body.answer, normalized: graded.normalized })}, ${graded.normalized},
                    ${key.key_version_id}::uuid, ${graded.correct}, ${outcome},
                    ${graded.correct ? Number(context.max_points) : 0}, ${Number(context.max_points)})
            returning id`;
          await tx`
            insert into private.workshop_grading_decisions
              (cycle_id, part_id, response_ref, answer_snapshot, key_version_id, is_correct,
               awarded_points, max_points, decision_kind, reason)
            values (${cycle.id}::uuid, ${context.part_id}::uuid, ${`attempt:${event.id}`},
                    ${tx.json({ raw: body.answer, normalized: graded.normalized })}, ${key.key_version_id}::uuid,
                    ${graded.correct}, ${graded.correct ? Number(context.max_points) : 0}, ${Number(context.max_points)},
                    'automatic_attempt', 'Server-side grading at original attempt time')`;
          if (next.revealed) await tx`
            insert into private.workshop_reveal_events
              (request_id, cycle_id, track_id, question_id, part_id, key_version_id)
            values (gen_random_uuid(), ${cycle.id}::uuid, ${context.track_id}::uuid,
                    ${context.question_id}::uuid, ${context.part_id}::uuid, ${key.key_version_id}::uuid)
            on conflict (cycle_id, track_id, part_id) do nothing`;
          payload = {
            ok: true, correct: graded.correct, assisted: next.assisted, progress,
            can_reveal: decision.can_reveal ?? false,
            message: graded.correct ? "إجابة صحيحة." : next.assisted ? "انتهت المحاولات؛ سُجل السؤال كتعلّم بمساعدة." : "ليست صحيحة. راجع التلميح وحاول مجددًا.",
            hint: graded.correct || next.assisted ? null : key.feedback_hint,
            display_answer: next.assisted ? key.display_answer : null,
            explanation: graded.correct || next.assisted ? key.explanation : null,
          };
        }
        await tx`insert into private.workshop_mutation_receipts(request_id, user_id, action, body_sha256, response_json) values (${requestId}::uuid, ${account.user.id}::uuid, ${action}, ${bodyHash}, ${tx.json(payload)})`;
        return payload;
      });
      return response(req, result);
    }

    if (action === "reveal") {
      if (context.mode !== "interactive") throw new WorkshopContractError(400, "wrong_track_mode", "هذا القسم لا يدعم الإظهار التفاعلي.");
      const result = await sql.begin(async (tx) => {
        const cycle = await ensureCycle(tx, String(context.workshop_id), account.user.id);
        if (!cycleAllows(cycle, trackKey, questionRef)) throw new WorkshopContractError(403, "reopen_scope_mismatch", "دورة الإعادة الحالية لا تشمل هذا السؤال.");
        await tx`select pg_advisory_xact_lock(hashtextextended(${`workshop-reveal:${cycle.id}:${context.track_id}:${context.part_id}`}, 0))`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${`workshop-key:${context.part_id}`}, 0))`;
        const [receipt] = await tx`select action, body_sha256, response_json from private.workshop_mutation_receipts where user_id = ${account.user.id}::uuid and request_id = ${requestId}::uuid`;
        if (receipt) {
          if (receipt.action !== action || receipt.body_sha256 !== bodyHash) throw new WorkshopContractError(409, "request_id_reused", "تم استخدام معرف الطلب مع بيانات مختلفة.");
          return receipt.response_json;
        }
        const [current] = await tx`select * from private.workshop_progress where cycle_id = ${cycle.id}::uuid and track_id = ${context.track_id}::uuid and part_id = ${context.part_id}::uuid for update`;
        const [key] = await tx`select * from private.current_workshop_part_keys where part_id = ${context.part_id}::uuid limit 1`;
        if (!key) throw new WorkshopContractError(503, "key_not_available", "تعذر إظهار الإجابة حاليًا.");
        if (current?.independently_mastered) throw new WorkshopContractError(409, "already_mastered", "تم إتقان هذا المطلوب بالفعل.");
        const threshold = Math.max(1, Number(jsonObject(context.policy).reveal_after_attempts ?? 3));
        if (Number(current?.attempts_count ?? 0) < threshold) throw new WorkshopContractError(403, "reveal_not_allowed", "لم تستنفد عدد المحاولات المطلوب بعد.");
        const [progress] = await tx`
          update private.workshop_progress set assisted = true, revealed = true, revision = revision + 1, updated_at = now()
          where cycle_id = ${cycle.id}::uuid and track_id = ${context.track_id}::uuid and part_id = ${context.part_id}::uuid
          returning *`;
        await tx`
          insert into private.workshop_reveal_events(request_id, cycle_id, track_id, question_id, part_id, key_version_id)
          values (${requestId}::uuid, ${cycle.id}::uuid, ${context.track_id}::uuid, ${context.question_id}::uuid, ${context.part_id}::uuid, ${key.key_version_id}::uuid)
          on conflict (cycle_id, track_id, part_id) do nothing`;
        const payload = { ok: true, assisted: true, progress, display_answer: key.display_answer, explanation: key.explanation, message: "سُجل الإظهار كتعلّم بمساعدة، وليس إتقانًا مستقلًا." };
        await tx`insert into private.workshop_mutation_receipts(request_id, user_id, action, body_sha256, response_json) values (${requestId}::uuid, ${account.user.id}::uuid, ${action}, ${bodyHash}, ${tx.json(payload)})`;
        return payload;
      });
      return response(req, result);
    }

    if (action === "save_draft") {
      if (context.mode !== "final_submit") throw new WorkshopContractError(400, "wrong_track_mode", "هذا القسم لا يستخدم مسودة تسليم.");
      const expectedRevision = validateExpectedRevision(body.expected_revision);
      const normalized = normalizeWorkshopAnswer(context.input_type as WorkshopInputType, body.answer);
      if (!normalized) throw new WorkshopContractError(400, "invalid_answer", "اكتب إجابة صالحة.");
      if (context.input_type === "mcq" && !safeArray(context.options_public).some((option) => String(jsonObject(option).value) === normalized)) {
        throw new WorkshopContractError(400, "invalid_answer", "اختر إجابة من البدائل المتاحة.");
      }
      const result = await sql.begin(async (tx) => {
        const cycle = await ensureCycle(tx, String(context.workshop_id), account.user.id);
        if (!cycleAllows(cycle, trackKey, questionRef)) throw new WorkshopContractError(403, "reopen_scope_mismatch", "دورة الإعادة الحالية لا تشمل هذا السؤال.");
        await tx`select pg_advisory_xact_lock(hashtextextended(${`workshop-draft:${cycle.id}:${context.track_id}:${context.part_id}`}, 0))`;
        const [receipt] = await tx`select action, body_sha256, response_json from private.workshop_mutation_receipts where user_id = ${account.user.id}::uuid and request_id = ${requestId}::uuid`;
        if (receipt) {
          if (receipt.action !== action || receipt.body_sha256 !== bodyHash) throw new WorkshopContractError(409, "request_id_reused", "تم استخدام معرف الطلب مع بيانات مختلفة.");
          return receipt.response_json;
        }
        const [submitted] = await tx`select id from private.workshop_submissions where cycle_id = ${cycle.id}::uuid and track_id = ${context.track_id}::uuid limit 1`;
        if (submitted) throw new WorkshopContractError(409, "already_submitted", "تم تثبيت هذا التسليم ولا يمكن تغيير إجاباته الأصلية.");
        const [current] = await tx`select revision from private.workshop_drafts where cycle_id = ${cycle.id}::uuid and track_id = ${context.track_id}::uuid and part_id = ${context.part_id}::uuid for update`;
        if (Number(current?.revision ?? 0) !== expectedRevision) {
          const payload = { ok: true, stale: true, revision: Number(current?.revision ?? 0), message: "تغيرت المسودة على جهاز آخر. أعد تحميل أحدث إجابة." };
          await tx`insert into private.workshop_mutation_receipts(request_id, user_id, action, body_sha256, response_json) values (${requestId}::uuid, ${account.user.id}::uuid, ${action}, ${bodyHash}, ${tx.json(payload)})`;
          return payload;
        }
        const [draft] = await tx`
          insert into private.workshop_drafts(cycle_id, track_id, part_id, answer_json, revision, updated_at)
          values (${cycle.id}::uuid, ${context.track_id}::uuid, ${context.part_id}::uuid,
                  ${tx.json({ raw: body.answer, normalized })}, ${expectedRevision + 1}, now())
          on conflict (cycle_id, track_id, part_id) do update set
            answer_json = excluded.answer_json, revision = excluded.revision, updated_at = now()
          returning part_id, answer_json, revision, updated_at`;
        const payload = { ok: true, draft };
        await tx`insert into private.workshop_mutation_receipts(request_id, user_id, action, body_sha256, response_json) values (${requestId}::uuid, ${account.user.id}::uuid, ${action}, ${bodyHash}, ${tx.json(payload)})`;
        return payload;
      });
      return response(req, result);
    }

    if (action === "submit_track") {
      if (context.mode !== "final_submit") throw new WorkshopContractError(400, "wrong_track_mode", "هذا القسم لا يستخدم التسليم النهائي.");
      const result = await sql.begin(async (tx) => {
        const cycle = await ensureCycle(tx, String(context.workshop_id), account.user.id);
        if (!cycleAllows(cycle, trackKey, questionRef || undefined)) throw new WorkshopContractError(403, "reopen_scope_mismatch", "دورة الإعادة الحالية لا تشمل هذا القسم.");
        await tx`select pg_advisory_xact_lock(hashtextextended(${`workshop-submit:${cycle.id}:${context.track_id}`}, 0))`;
        const [receipt] = await tx`select action, body_sha256, response_json from private.workshop_mutation_receipts where user_id = ${account.user.id}::uuid and request_id = ${requestId}::uuid`;
        if (receipt) {
          if (receipt.action !== action || receipt.body_sha256 !== bodyHash) throw new WorkshopContractError(409, "request_id_reused", "تم استخدام معرف الطلب مع بيانات مختلفة.");
          return receipt.response_json;
        }
        const [existing] = await tx`select id, score, max_score, submitted_at from private.workshop_submissions where cycle_id = ${cycle.id}::uuid and track_id = ${context.track_id}::uuid limit 1`;
        if (existing) {
          const payload = { ok: true, already_submitted: true, submission: existing };
          await tx`insert into private.workshop_mutation_receipts(request_id, user_id, action, body_sha256, response_json) values (${requestId}::uuid, ${account.user.id}::uuid, ${action}, ${bodyHash}, ${tx.json(payload)})`;
          return payload;
        }
        const partIds = await tx`
          select part.id
          from private.workshop_track_questions placement
          join private.workshop_question_parts part on part.question_id = placement.question_id
          where placement.track_id = ${context.track_id}::uuid
          order by part.id`;
        for (const part of partIds) await tx`select pg_advisory_xact_lock(hashtextextended(${`workshop-key:${part.id}`}, 0))`;
        const rows = await tx`
          select question.id as question_id, question.question_ref, part.id as part_id, part.input_type,
                 part.max_points, draft.answer_json, key.key_version_id, key.answer_spec,
                 key.display_answer, key.explanation
          from private.workshop_track_questions placement
          join private.workshop_questions question on question.id = placement.question_id and question.active = true
          join private.workshop_question_parts part on part.question_id = question.id
          left join private.current_workshop_part_keys key on key.part_id = part.id
          left join private.workshop_drafts draft on draft.cycle_id = ${cycle.id}::uuid
            and draft.track_id = ${context.track_id}::uuid and draft.part_id = part.id
          where placement.track_id = ${context.track_id}::uuid
          order by placement.sort_order, part.sort_order`;
        const missingKeys = rows.filter((row) => !row.key_version_id).map((row) => row.question_ref);
        if (missingKeys.length) throw new WorkshopContractError(503, "key_not_available", "تعذر تصحيح بعض الأسئلة حاليًا؛ لم يُثبت التسليم.");
        const missing = rows.filter((row) => !row.answer_json).map((row) => row.question_ref);
        if (missing.length) throw new WorkshopContractError(409, "incomplete_submission", `أكمل ${missing.length} إجابة قبل التسليم.`);
        const graded = (rows as unknown as Record<string, any>[]).map((row): Record<string, any> & { raw_answer: any; normalized: string; correct: boolean; points: number } => {
          const answer = jsonObject(row.answer_json).raw;
          const result = gradeWorkshopAnswer(row.input_type as WorkshopInputType, row.answer_spec, answer);
          return { ...row, raw_answer: answer, normalized: result.normalized, correct: result.correct, points: result.correct ? Number(row.max_points) : 0 };
        });
        const score = graded.reduce((sum, item) => sum + item.points, 0);
        const maxScore = graded.reduce((sum, item) => sum + Number(item.max_points), 0);
        const [submission] = await tx`
          insert into private.workshop_submissions(request_id, cycle_id, track_id, score, max_score)
          values (${requestId}::uuid, ${cycle.id}::uuid, ${context.track_id}::uuid, ${score}, ${maxScore})
          returning id, score, max_score, submitted_at`;
        const results = [];
        for (const item of graded) {
          await tx`
            insert into private.workshop_submission_answers
              (submission_id, question_id, part_id, answer_json, normalized_answer,
               key_version_id, is_correct, awarded_points, max_points)
            values (${submission.id}::uuid, ${item.question_id}::uuid, ${item.part_id}::uuid,
                    ${tx.json({ raw: item.raw_answer, normalized: item.normalized })}, ${item.normalized},
                    ${item.key_version_id}::uuid, ${item.correct}, ${item.points}, ${Number(item.max_points)})`;
          await tx`
            insert into private.workshop_grading_decisions
              (cycle_id, part_id, response_ref, answer_snapshot, key_version_id, is_correct,
               awarded_points, max_points, decision_kind, reason)
            values (${cycle.id}::uuid, ${item.part_id}::uuid, ${`submission:${submission.id}:${item.part_id}`},
                    ${tx.json({ raw: item.raw_answer, normalized: item.normalized })}, ${item.key_version_id}::uuid,
                    ${item.correct}, ${item.points}, ${Number(item.max_points)},
                    'automatic_submission', 'Server-side grading at immutable final submission time')`;
          await tx`
            insert into private.workshop_progress
              (cycle_id, track_id, part_id, revision, attempts_count, tried_answers,
               first_attempt_correct, independently_mastered, assisted, revealed, last_answer, updated_at)
            values (${cycle.id}::uuid, ${context.track_id}::uuid, ${item.part_id}::uuid, 1, 1,
                    ${tx.json([item.normalized])}, ${item.correct}, ${item.correct}, false, false,
                    ${tx.json({ raw: item.raw_answer, normalized: item.normalized })}, now())
            on conflict (cycle_id, track_id, part_id) do nothing`;
          results.push({ part_id: item.part_id, question_ref: item.question_ref, is_correct: item.correct, awarded_points: item.points, max_points: Number(item.max_points), display_answer: item.display_answer, explanation: item.explanation });
        }
        const payload = { ok: true, submission: { ...submission, answers: results } };
        await tx`insert into private.workshop_mutation_receipts(request_id, user_id, action, body_sha256, response_json) values (${requestId}::uuid, ${account.user.id}::uuid, ${action}, ${bodyHash}, ${tx.json(payload)})`;
        return payload;
      });
      return response(req, result);
    }

    throw new WorkshopContractError(400, "unknown_action", "الإجراء المطلوب غير معروف.");
  } catch (error) {
    if (error instanceof WorkshopContractError) return response(req, { error: error.code, message: error.message }, error.status);
    console.error("unified-workshop", error);
    return response(req, { error: "server_error", message: "تعذر إتمام الطلب الآن. لم تُحتسب محاولة غير مؤكدة." }, 500);
  }
});
