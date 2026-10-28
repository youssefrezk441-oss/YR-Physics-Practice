import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";
import {
  classifyCh2MistakeStatus,
  filterCh2MistakeItems,
  summarizeCh2Mistakes,
  validateCh2MistakeRef,
  type Ch2MistakeFilters,
  type Ch2MistakeListItem,
} from "../_shared/ch2-mistakes-core.ts";
import {
  gradeWorkshopAnswer,
  normalizeWorkshopAnswer,
  validateRequestId,
  WorkshopContractError,
  type WorkshopInputType,
} from "../_shared/unified-workshop-core.ts";
import { readWorkshopJson, WorkshopRequestError } from "../_shared/workshop-security.ts";

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
const stableJson = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(stableJson).join(",")}]`
  : value && typeof value === "object"
  ? `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`
  : JSON.stringify(value);
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

type StudentProfile = {
  student_code: string | null;
  full_name: string | null;
  grade_level: string;
  group_code: string | null;
  center_name: string | null;
  is_active: boolean;
  group_grade: string | null;
};

async function requireStudent(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const { data, error } = await authClient.auth.getUser(authorization.slice(7));
  if (error || !data.user || data.user.app_metadata?.role !== "student") return null;
  const [profile] = await sql`
    select profile.student_code, profile.full_name, profile.grade_level, profile.group_code,
           profile.center_name, profile.is_active, student_group.grade_level as group_grade
    from public.student_profiles profile
    left join public.student_groups student_group on student_group.group_code = profile.group_code
    where profile.user_id = ${data.user.id}::uuid
    limit 1`;
  const studentProfile = profile as unknown as StudentProfile | undefined;
  if (!studentProfile?.is_active || canonicalGrade(studentProfile.group_grade ?? studentProfile.grade_level) !== "الصف الثالث الثانوي") return null;
  return { user: data.user, profile: { ...studentProfile, grade_level: "الصف الثالث الثانوي" } };
}

type EvidenceRow = Record<string, any>;

async function loadMistakes(userId: string, groupCode: string): Promise<EvidenceRow[]> {
  const rows = await sql`
    select evidence.*,
           review.reviewed_at,
           coalesce(mastery.mastered_at, essay_mastery.mastered_at) as mastered_at,
           (coalesce(mastery.attempts_count, 0) + coalesce(essay_mastery.attempts_count, 0))::int as mastery_attempts_count,
           case when essay_mastery.mastered_at is not null then 'essay_self_review'
                when mastery.mastered_at is not null then 'server_graded' else null end as mastery_kind
    from (
      select * from private.ch2_verified_mistake_evidence
      union all
      select * from private.ch2_paper_homework_mistake_evidence
    ) evidence
    left join lateral (
      select min(event.reviewed_at) as reviewed_at
      from private.ch2_mistake_review_events event
      where event.user_id = evidence.user_id and event.mistake_ref = evidence.mistake_ref
    ) review on true
    left join lateral (
      select min(attempt.attempted_at) filter (where attempt.is_correct) as mastered_at,
             count(*)::int as attempts_count
      from private.ch2_mistake_mastery_attempts attempt
      where attempt.user_id = evidence.user_id and attempt.mistake_ref = evidence.mistake_ref
    ) mastery on true
    left join lateral (
      select min(review_event.reviewed_at) filter (where review_event.assessment = 'correct') as mastered_at,
             count(retry.id)::int as attempts_count
      from private.ch2_essay_mastery_retries retry
      left join private.ch2_essay_mastery_reviews review_event on review_event.retry_id = retry.id
      where retry.user_id = evidence.user_id and retry.mistake_ref = evidence.mistake_ref
    ) essay_mastery on true
    where evidence.user_id = ${userId}::uuid
      and (
        jsonb_array_length(evidence.eligible_group_codes) = 0
        or evidence.eligible_group_codes ? ${groupCode}
      )
    order by evidence.lecture_no, case when evidence.track_key = 'class' then 0 else 1 end,
             evidence.original_wrong_at, evidence.question_ref, evidence.part_key
    limit 1000`;
  return rows as unknown as EvidenceRow[];
}

async function loadIncomplete(userId: string, groupCode: string): Promise<EvidenceRow[]> {
  const rows = await sql`
    with source_parts as (
      select definition.id as workshop_id, definition.slug as workshop_slug,
             definition.title as workshop_title, definition.lecture_no,
             version.id as version_id, track.id as track_id, track.track_key,
             track.title as track_title, track.mode,
             question.id as question_id, question.question_ref,
             question.source_ref as bank_source_ref, question.source_kind as question_source_kind,
             question.question_kind, question.title as question_title,
             question.prompt_text, question.image_path, question.image_sha256,
             question.skill_ref, skill.name as skill_name, question.difficulty,
             part.id as part_id, part.part_key, part.label as part_label,
             part.input_type, part.options_public, part.unit_text,
             part.max_points, part.public_config
      from private.workshop_definitions definition
      join private.ch2_mistake_source_policies policy on policy.workshop_id = definition.id and policy.enabled
        and policy.source_contract = 'unified_workshop_v1'
      join private.workshop_versions version on version.id = definition.active_version_id and version.status = 'published'
      join private.workshop_tracks track on track.version_id = version.id
      join private.workshop_track_questions placement on placement.track_id = track.id
      join private.workshop_questions question on question.id = placement.question_id and question.active = true
      join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
      join private.workshop_question_parts part on part.question_id = question.id
      where definition.academic_term = 'second' and definition.status = 'published'
        and (
          jsonb_array_length(definition.eligible_group_codes) = 0
          or definition.eligible_group_codes ? ${groupCode}
        )
    ), unified_incomplete as (
      select source.* from source_parts source
      where case
        when source.mode = 'interactive' then not exists (
          select 1 from private.workshop_cycles cycle
          join private.workshop_attempt_events event on event.cycle_id = cycle.id
            and event.track_id = source.track_id and event.part_id = source.part_id
          where cycle.workshop_id = source.workshop_id and cycle.user_id = ${userId}::uuid
            and cycle.source = 'initial'
        )
        when source.mode = 'final_submit' then not exists (
          select 1 from private.workshop_cycles cycle
          join private.workshop_submissions submission on submission.cycle_id = cycle.id
            and submission.track_id = source.track_id
          join private.workshop_submission_answers answer on answer.submission_id = submission.id
            and answer.part_id = source.part_id
          where cycle.workshop_id = source.workshop_id and cycle.user_id = ${userId}::uuid
            and cycle.source = 'initial'
        )
        else false
      end
    ), paper_incomplete as (
      select definition.id as workshop_id, definition.slug as workshop_slug,
           definition.title as workshop_title, definition.lecture_no,
           submission.version_id, track.id as track_id, track.track_key,
           track.title as track_title, track.mode,
           question.id as question_id, question.question_ref,
           question.source_ref as bank_source_ref, question.source_kind as question_source_kind,
           question.question_kind, question.title as question_title,
           question.prompt_text, question.image_path, question.image_sha256,
           question.skill_ref, skill.name as skill_name, question.difficulty,
           part.id as part_id, part.part_key, part.label as part_label,
           part.input_type, part.options_public, part.unit_text, part.max_points, part.public_config
    from private.homework_submission_answers answer
    join private.homework_submissions submission on submission.id = answer.submission_id
      and submission.user_id = ${userId}::uuid
    join private.workshop_definitions definition on definition.id = submission.workshop_id
    join private.ch2_mistake_source_policies policy on policy.workshop_id = definition.id
      and policy.enabled and policy.source_contract = 'paper_homework_capture_v1'
    join private.workshop_tracks track on track.version_id = submission.version_id and track.track_key = 'home'
    join private.workshop_questions question on question.id = answer.question_id
    join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
    join private.workshop_question_parts part on part.id = answer.part_id
      where definition.academic_term = 'second' and definition.status = 'published'
        and answer.answer_state = 'unanswered'
        and (jsonb_array_length(definition.eligible_group_codes) = 0 or definition.eligible_group_codes ? ${groupCode})
    )
    select * from (
      select * from unified_incomplete
      union all
      select * from paper_incomplete
    ) incomplete
    order by lecture_no, case when track_key = 'class' then 0 else 1 end, question_ref, part_key
    limit 1000`;
  return rows as unknown as EvidenceRow[];
}

function publicQuestion(row: EvidenceRow) {
  return {
    workshop_slug: row.workshop_slug,
    workshop_title: row.workshop_title,
    lecture_no: Number(row.lecture_no),
    track_key: row.track_key,
    track_title: row.track_title,
    question_ref: row.question_ref,
    bank_source_ref: row.bank_source_ref,
    question_source_kind: row.question_source_kind,
    question_kind: row.question_kind,
    question_title: row.question_title,
    prompt_text: row.prompt_text,
    image_path: row.image_path,
    image_sha256: row.image_sha256,
    skill_ref: row.skill_ref,
    skill_name: row.skill_name,
    difficulty: row.difficulty,
    part_key: row.part_key,
    part_label: row.part_label,
    input_type: row.input_type,
    options_public: safeArray(row.options_public),
    unit_text: row.unit_text,
    max_points: Number(row.max_points),
  };
}

function filtersFrom(body: Record<string, any>): Ch2MistakeFilters {
  const lecture = Number(body.lecture_no);
  const track = body.track_key === "class" || body.track_key === "home" ? body.track_key : null;
  const allowedStatuses = new Set(["needs_review", "reviewed", "mastered", "incomplete"]);
  const status = allowedStatuses.has(String(body.status)) ? body.status : null;
  return {
    lecture_no: Number.isInteger(lecture) && lecture > 0 ? lecture : null,
    track_key: track,
    skill_ref: text(body.skill_ref, 80) || null,
    status,
  } as Ch2MistakeFilters;
}

async function evidenceForUser(query: postgres.TransactionSql, userId: string, groupCode: string, mistakeRef: string) {
  const [row] = await query`
    select * from (
      select * from private.ch2_verified_mistake_evidence
      union all
      select * from private.ch2_paper_homework_mistake_evidence
    ) evidence
    where user_id = ${userId}::uuid and mistake_ref = ${mistakeRef}
      and (
        jsonb_array_length(eligible_group_codes) = 0
        or eligible_group_codes ? ${groupCode}
      )
    limit 1`;
  return row as EvidenceRow | undefined;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return response(req, { error: "method_not_allowed" }, 405);
  const account = await requireStudent(req);
  if (!account) return response(req, { error: "unauthorized", message: "يجب تسجيل الدخول بحساب طالب نشط من الصف الثالث الثانوي." }, 401);

  let body: Record<string, any>;
  try { body = await readWorkshopJson(req) as Record<string, any>; }
  catch (error) {
    if (error instanceof WorkshopRequestError) return response(req, { error: error.code, message: error.message }, error.status);
    return response(req, { error: "invalid_json" }, 400);
  }

  const action = text(body.action, 60);
  const groupCode = String(account.profile.group_code ?? "");
  try {
    if (action === "ping") {
      const [availability] = await sql`
        select count(*)::int as sources
        from private.ch2_mistake_source_policies policy
        join private.workshop_definitions definition on definition.id = policy.workshop_id
        where policy.enabled and definition.academic_term = 'second' and definition.status = 'published'
          and (
            jsonb_array_length(definition.eligible_group_codes) = 0
            or definition.eligible_group_codes ? ${groupCode}
          )`;
      return response(req, {
        ok: true,
        available: Number(availability?.sources ?? 0) > 0,
        profile: {
          student_code: account.profile.student_code ?? null,
          full_name: account.profile.full_name ?? null,
          grade_level: account.profile.grade_level,
          group_code: account.profile.group_code ?? null,
        },
      });
    }

    if (action === "list") {
      const [mistakeRows, incompleteRows] = await Promise.all([
        loadMistakes(account.user.id, groupCode),
        loadIncomplete(account.user.id, groupCode),
      ]);
      const mistakes = mistakeRows.map((row) => ({
        kind: "mistake" as const,
        mistake_ref: row.mistake_ref,
        evidence_kind: row.evidence_kind,
        original_wrong_at: row.original_wrong_at,
        reviewed_at: row.reviewed_at,
        mastered_at: row.mastered_at,
        mastery_attempts_count: Number(row.mastery_attempts_count ?? 0),
        mastery_kind: row.mastery_kind ?? null,
        status: classifyCh2MistakeStatus({
          reviewed_at: row.reviewed_at,
          mastery_attempts: row.mastered_at ? [{ is_correct: true, attempted_at: row.mastered_at }] : [],
        }),
        ...publicQuestion(row),
      }));
      const incomplete = incompleteRows.map((row) => ({
        kind: "incomplete" as const,
        mistake_ref: null,
        evidence_kind: null,
        original_wrong_at: null,
        reviewed_at: null,
        mastered_at: null,
        mastery_attempts_count: 0,
        status: "incomplete" as const,
        ...publicQuestion(row),
      }));
      const allItems = [...mistakes, ...incomplete] as unknown as (Ch2MistakeListItem & Record<string, any>)[];
      const filtered = filterCh2MistakeItems(allItems, filtersFrom(body));
      return response(req, {
        ok: true,
        profile: {
          student_code: account.profile.student_code ?? null,
          full_name: account.profile.full_name ?? null,
          grade_level: account.profile.grade_level,
          group_code: account.profile.group_code ?? null,
        },
        summary: summarizeCh2Mistakes(allItems),
        items: filtered,
        filters: {
          lectures: [...new Set(allItems.map((item) => Number(item.lecture_no)))].sort((a, b) => a - b),
          skills: [...new Map(allItems.map((item) => [item.skill_ref, item.skill_name])).entries()].map(([id, name]) => ({ id, name })),
        },
      });
    }

    let mistakeRef: string;
    try { mistakeRef = validateCh2MistakeRef(body.mistake_ref); }
    catch { throw new WorkshopContractError(400, "invalid_mistake_ref", "مرجع الخطأ غير صالح."); }
    const requestId = validateRequestId(body.request_id);
    const bodyHash = await sha256(body);

    if (action === "mark_reviewed") {
      const payload = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`ch2-review:${account.user.id}:${mistakeRef}`}, 0))`;
        const [receipt] = await tx`
          select action, body_sha256, response_json
          from private.workshop_mutation_receipts
          where user_id = ${account.user.id}::uuid and request_id = ${requestId}::uuid`;
        if (receipt) {
          if (receipt.action !== "ch2_mark_reviewed" || receipt.body_sha256 !== bodyHash) throw new WorkshopContractError(409, "request_id_reused", "تم استخدام معرف الطلب مع بيانات مختلفة.");
          return receipt.response_json;
        }
        const evidence = await evidenceForUser(tx, account.user.id, groupCode, mistakeRef);
        if (!evidence) throw new WorkshopContractError(404, "mistake_not_found", "هذا الخطأ غير موجود في سجلك المثبت.");
        const [event] = await tx`
          insert into private.ch2_mistake_review_events
            (request_id, user_id, mistake_ref, workshop_id, version_id, question_id, part_id, evidence_kind)
          values (${requestId}::uuid, ${account.user.id}::uuid, ${mistakeRef},
                  ${evidence.workshop_id}::uuid, ${evidence.version_id}::uuid,
                  ${evidence.question_id}::uuid, ${evidence.part_id}::uuid, ${evidence.evidence_kind})
          returning reviewed_at`;
        const [mastery] = await tx`
          select min(attempted_at) as mastered_at
          from private.ch2_mistake_mastery_attempts
          where user_id = ${account.user.id}::uuid and mistake_ref = ${mistakeRef} and is_correct`;
        const result = {
          ok: true,
          status: mastery?.mastered_at ? "mastered" : "reviewed",
          reviewed_at: event.reviewed_at,
          mastered_at: mastery?.mastered_at ?? null,
          message: mastery?.mastered_at
            ? "تم حفظ المراجعة مع بقاء حالة الإتقان المسجلة سابقًا."
            : "تم حفظ المراجعة. هذا لا يُعد إتقانًا حتى تحل إجابة صحيحة مستقلة.",
        };
        await tx`
          insert into private.workshop_mutation_receipts(request_id, user_id, action, body_sha256, response_json)
          values (${requestId}::uuid, ${account.user.id}::uuid, 'ch2_mark_reviewed', ${bodyHash}, ${tx.json(result)})`;
        return result;
      });
      return response(req, payload);
    }

    if (action === "begin_essay_mastery") {
      const payload = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`ch2-essay:${account.user.id}:${mistakeRef}`}, 0))`;
        const [storedReceipt] = await tx`select action, body_sha256, response_json from private.workshop_mutation_receipts where user_id = ${account.user.id}::uuid and request_id = ${requestId}::uuid`;
        if (storedReceipt) {
          if (storedReceipt.action !== "ch2_begin_essay_mastery" || storedReceipt.body_sha256 !== bodyHash) throw new WorkshopContractError(409, "request_id_reused", "تم استخدام معرف الطلب مع بيانات مختلفة.");
          return storedReceipt.response_json;
        }
        const evidence = await evidenceForUser(tx, account.user.id, groupCode, mistakeRef);
        if (!evidence || evidence.evidence_kind !== "paper_homework_essay_self_review") throw new WorkshopContractError(404, "essay_mistake_not_found", "هذا ليس خطأً مقاليًا مثبتًا في سجلك.");
        const answer = jsonObject(body.answer);
        const answerText = text(answer.text, 4000);
        const imageIds = safeArray(answer.image_ids).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 3);
        if (!answerText && imageIds.length === 0) throw new WorkshopContractError(400, "empty_answer", "اكتب محاولة جديدة مستقلة قبل عرض الحل.");
        const [mastered] = await tx`
          select 1 from private.ch2_essay_mastery_retries retry
          join private.ch2_essay_mastery_reviews review on review.retry_id = retry.id and review.assessment = 'correct'
          where retry.user_id = ${account.user.id}::uuid and retry.mistake_ref = ${mistakeRef} limit 1`;
        if (mastered) throw new WorkshopContractError(409, "already_mastered", "تم تسجيل إتقان هذا المطلوب بتقييم ذاتي سابق.");
        const [key] = await tx`select key_version_id, display_answer, explanation from private.current_workshop_part_keys where part_id = ${evidence.part_id}::uuid limit 1`;
        if (!key) throw new WorkshopContractError(503, "key_not_available", "الحل النموذجي غير متاح حاليًا.");
        const [retry] = await tx`
          insert into private.ch2_essay_mastery_retries
            (request_id, user_id, mistake_ref, workshop_id, version_id, question_id, part_id, answer_json, key_version_id)
          values (${requestId}::uuid, ${account.user.id}::uuid, ${mistakeRef}, ${evidence.workshop_id}::uuid,
            ${evidence.version_id}::uuid, ${evidence.question_id}::uuid, ${evidence.part_id}::uuid,
            ${tx.json({ text: answerText, image_ids: imageIds })}, ${key.key_version_id}::uuid)
          returning id, attempted_at`;
        const result = { ok: true, retry_id: retry.id, attempted_at: retry.attempted_at, model_answer: key.display_answer, solution_steps: key.explanation,
          message: "تم تثبيت محاولتك الجديدة أولًا. راجعها الآن أمام الحل ثم ثبّت تقييمك الذاتي." };
        await tx`insert into private.workshop_mutation_receipts(request_id, user_id, action, body_sha256, response_json)
          values (${requestId}::uuid, ${account.user.id}::uuid, 'ch2_begin_essay_mastery', ${bodyHash}, ${tx.json(result)})`;
        return result;
      });
      return response(req, payload);
    }

    if (action === "assess_essay_mastery") {
      const retryId = text(body.retry_id, 40);
      const assessment = text(body.assessment, 20);
      if (!new Set(["correct", "partial", "incorrect"]).has(assessment)) throw new WorkshopContractError(400, "invalid_assessment", "اختر تقييمًا صحيحًا للمحاولة.");
      const payload = await sql.begin(async (tx) => {
        const [storedReceipt] = await tx`select action, body_sha256, response_json from private.workshop_mutation_receipts where user_id = ${account.user.id}::uuid and request_id = ${requestId}::uuid`;
        if (storedReceipt) {
          if (storedReceipt.action !== "ch2_assess_essay_mastery" || storedReceipt.body_sha256 !== bodyHash) throw new WorkshopContractError(409, "request_id_reused", "تم استخدام معرف الطلب مع بيانات مختلفة.");
          return storedReceipt.response_json;
        }
        const [retry] = await tx`select id from private.ch2_essay_mastery_retries where id = ${retryId}::uuid and user_id = ${account.user.id}::uuid and mistake_ref = ${mistakeRef} for update`;
        if (!retry) throw new WorkshopContractError(404, "retry_not_found", "المحاولة المقالية الجديدة غير موجودة.");
        const [review] = await tx`insert into private.ch2_essay_mastery_reviews(request_id, user_id, retry_id, assessment)
          values (${requestId}::uuid, ${account.user.id}::uuid, ${retry.id}::uuid, ${assessment})
          on conflict (retry_id) do nothing returning reviewed_at`;
        if (!review) throw new WorkshopContractError(409, "assessment_locked", "تم تثبيت تقييم هذه المحاولة من قبل.");
        const result = { ok: true, assessment, status: assessment === "correct" ? "mastered" : "reviewed", mastery_kind: "essay_self_review", reviewed_at: review.reviewed_at,
          message: assessment === "correct" ? "سُجل الإتقان كتقييم ذاتي صريح، مع بقاء الخطأ والمحاولة الأصلية." : "تم حفظ التقييم الذاتي. يمكنك إنشاء محاولة مستقلة أخرى لاحقًا." };
        await tx`insert into private.workshop_mutation_receipts(request_id, user_id, action, body_sha256, response_json)
          values (${requestId}::uuid, ${account.user.id}::uuid, 'ch2_assess_essay_mastery', ${bodyHash}, ${tx.json(result)})`;
        return result;
      });
      return response(req, payload);
    }

    if (action === "attempt_mastery") {
      const payload = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`ch2-mastery:${account.user.id}:${mistakeRef}`}, 0))`;
        const [receipt] = await tx`
          select action, body_sha256, response_json
          from private.workshop_mutation_receipts
          where user_id = ${account.user.id}::uuid and request_id = ${requestId}::uuid`;
        if (receipt) {
          if (receipt.action !== "ch2_attempt_mastery" || receipt.body_sha256 !== bodyHash) throw new WorkshopContractError(409, "request_id_reused", "تم استخدام معرف الطلب مع بيانات مختلفة.");
          return receipt.response_json;
        }
        const evidence = await evidenceForUser(tx, account.user.id, groupCode, mistakeRef);
        if (!evidence) throw new WorkshopContractError(404, "mistake_not_found", "هذا الخطأ غير موجود في سجلك المثبت.");
        if (evidence.evidence_kind === "paper_homework_essay_self_review") throw new WorkshopContractError(409, "essay_requires_self_review", "السؤال المقالي يحتاج محاولة جديدة ثم تقييمًا ذاتيًا منفصلًا؛ لا يُصحح نصه آليًا.");
        const [mastered] = await tx`
          select id from private.ch2_mistake_mastery_attempts
          where user_id = ${account.user.id}::uuid and mistake_ref = ${mistakeRef} and is_correct
          limit 1`;
        if (mastered) throw new WorkshopContractError(409, "already_mastered", "تم إتقان هذا السؤال بالفعل، وسجل الخطأ الأصلي ما زال محفوظًا.");

        await tx`select pg_advisory_xact_lock(hashtextextended(${`workshop-key:${evidence.part_id}`}, 0))`;
        const [key] = await tx`
          select key_version_id, answer_spec
          from private.current_workshop_part_keys
          where part_id = ${evidence.part_id}::uuid
          limit 1`;
        if (!key) throw new WorkshopContractError(503, "key_not_available", "تعذر تصحيح المحاولة حاليًا؛ لم تُسجل محاولة غير مؤكدة.");
        const graded = gradeWorkshopAnswer(evidence.input_type as WorkshopInputType, key.answer_spec, body.answer);
        if (evidence.input_type === "mcq" && !safeArray(evidence.options_public).some((option) =>
          normalizeWorkshopAnswer("mcq", jsonObject(option).value) === graded.normalized
        )) throw new WorkshopContractError(400, "invalid_answer", "اختر إجابة من البدائل المتاحة.");
        const [duplicate] = await tx`
          select id from private.ch2_mistake_mastery_attempts
          where user_id = ${account.user.id}::uuid and mistake_ref = ${mistakeRef}
            and normalized_answer = ${graded.normalized}
          limit 1`;
        if (duplicate) throw new WorkshopContractError(409, "duplicate_answer", "هذه الإجابة جُربت من قبل ولم تُسجل محاولة مكررة.");
        const [counter] = await tx`
          select count(*)::int as count
          from private.ch2_mistake_mastery_attempts
          where user_id = ${account.user.id}::uuid and mistake_ref = ${mistakeRef}`;
        const attemptNo = Number(counter?.count ?? 0) + 1;
        const [attempt] = await tx`
          insert into private.ch2_mistake_mastery_attempts
            (request_id, user_id, mistake_ref, workshop_id, version_id, question_id, part_id,
             attempt_no, answer_json, normalized_answer, key_version_id, is_correct)
          values (${requestId}::uuid, ${account.user.id}::uuid, ${mistakeRef},
                  ${evidence.workshop_id}::uuid, ${evidence.version_id}::uuid,
                  ${evidence.question_id}::uuid, ${evidence.part_id}::uuid, ${attemptNo},
                  ${tx.json({ raw: body.answer, normalized: graded.normalized })}, ${graded.normalized},
                  ${key.key_version_id}::uuid, ${graded.correct})
          returning attempted_at`;
        const [review] = await tx`
          select min(reviewed_at) as reviewed_at
          from private.ch2_mistake_review_events
          where user_id = ${account.user.id}::uuid and mistake_ref = ${mistakeRef}`;
        const result = {
          ok: true,
          correct: graded.correct,
          status: graded.correct ? "mastered" : review?.reviewed_at ? "reviewed" : "needs_review",
          attempt_no: attemptNo,
          attempted_at: attempt.attempted_at,
          message: graded.correct
            ? "إجابة صحيحة مستقلة. تم تسجيل الإتقان مع الاحتفاظ بالخطأ الأصلي وتاريخ المراجعة."
            : "الإجابة غير صحيحة. لم يُعرض المفتاح، ويمكنك المراجعة ثم المحاولة بإجابة مختلفة.",
        };
        await tx`
          insert into private.workshop_mutation_receipts(request_id, user_id, action, body_sha256, response_json)
          values (${requestId}::uuid, ${account.user.id}::uuid, 'ch2_attempt_mastery', ${bodyHash}, ${tx.json(result)})`;
        return result;
      });
      return response(req, payload);
    }

    throw new WorkshopContractError(400, "unknown_action", "الإجراء المطلوب غير معروف.");
  } catch (error) {
    if (error instanceof WorkshopContractError) return response(req, { error: error.code, message: error.message }, error.status);
    console.error("student-ch2-mistakes", error);
    return response(req, { error: "server_error", message: "تعذر إتمام الطلب الآن. لم تُسجل مراجعة أو محاولة غير مؤكدة." }, 500);
  }
});
