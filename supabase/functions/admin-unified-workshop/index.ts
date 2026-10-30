import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";
import { readWorkshopJson, WorkshopRequestError } from "../_shared/workshop-security.ts";
import { deriveInteractiveProgressAfterRegrade, previewWorkshopRegrade, WorkshopContractError, type WorkshopInputType, type WorkshopRegradeDecision } from "../_shared/unified-workshop-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const SUPABASE_KEY = publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const DATABASE_URL = Deno.env.get("SUPABASE_DB_URL") ?? "";
const authClient = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const sql = postgres(DATABASE_URL, { prepare: false, max: 4, idle_timeout: 20 });
const allowedOrigins = new Set(["https://youssefrezk441-oss.github.io", "http://127.0.0.1:8000", "http://localhost:8000"]);
const text = (value: unknown, max = 500) => String(value ?? "").normalize("NFKC").trim().slice(0, max);
const safeArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const jsonObject = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
type AdminRegradeDecision = WorkshopRegradeDecision & { cycle_id: string; response_ref: string };
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

async function requireAdmin(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const { data, error } = await authClient.auth.getUser(authorization.slice(7));
  if (error || !data.user || data.user.app_metadata?.role !== "admin") return null;
  const [permission] = await sql`select public.admin_access_level('students', ${data.user.id}::uuid) as level`;
  const level = String(permission?.level ?? "");
  return ["view", "edit"].includes(level) ? { user: data.user, level } : null;
}
const requireEdit = (admin: NonNullable<Awaited<ReturnType<typeof requireAdmin>>>) => {
  if (admin.level !== "edit") throw new WorkshopContractError(403, "edit_permission_required", "هذه العملية تحتاج صلاحية تعديل.");
};

async function workshopBySlug(slug: string) {
  const [workshop] = await sql`
    select definition.*, version.version_no, version.content_sha256
    from private.workshop_definitions definition
    left join private.workshop_versions version on version.id = definition.active_version_id
    where definition.slug = ${slug} limit 1`;
  return workshop ?? null;
}

async function analyticsOverview(workshop: Record<string, any>, trackKey: string, groupCode: string, cycleSource: string) {
  const [track] = await sql`select id from private.workshop_tracks where version_id = ${workshop.active_version_id}::uuid and track_key = ${trackKey} limit 1`;
  if (!track) throw new WorkshopContractError(404, "track_not_found", "القسم غير موجود.");
  const [eligible] = await sql`
    select count(*)::int as students
    from public.student_profiles profile
    left join public.student_groups student_group on student_group.group_code = profile.group_code
    where profile.is_active = true
      and (coalesce(student_group.grade_level, profile.grade_level, '') = ${workshop.grade_level}
           or coalesce(student_group.grade_level, profile.grade_level, '') = '3 ثانوي'
           or coalesce(student_group.grade_level, profile.grade_level, '') like '%الثالث%')
      ${groupCode ? sql`and profile.group_code = ${groupCode}` : sql``}`;
  const [questionCount] = await sql`select count(*)::int as count from private.workshop_track_questions where track_id = ${track.id}::uuid`;
  const [partCount] = await sql`
    select count(*)::int as count
    from private.workshop_track_questions placement
    join private.workshop_question_parts part on part.question_id = placement.question_id
    where placement.track_id = ${track.id}::uuid`;
  const [metrics] = await sql`
    with allowed_students as (
      select profile.user_id
      from public.student_profiles profile
      left join public.student_groups student_group on student_group.group_code = profile.group_code
      where profile.is_active = true
        and (coalesce(student_group.grade_level, profile.grade_level, '') = ${workshop.grade_level}
             or coalesce(student_group.grade_level, profile.grade_level, '') = '3 ثانوي'
             or coalesce(student_group.grade_level, profile.grade_level, '') like '%الثالث%')
        ${groupCode ? sql`and profile.group_code = ${groupCode}` : sql``}
    ), progress as (
      select cycle.user_id, state.*
      from private.workshop_progress state
      join private.workshop_cycles cycle on cycle.id = state.cycle_id
      where cycle.workshop_id = ${workshop.id}::uuid and state.track_id = ${track.id}::uuid
        ${cycleSource === "all" ? sql`` : sql`and cycle.source = ${cycleSource}`}
        and cycle.user_id in (select user_id from allowed_students)
    )
    select count(distinct user_id)::int as started_students,
           count(*)::int as attempted_parts,
           count(*) filter (where first_attempt_correct = true)::int as first_correct_parts,
           count(*) filter (where independently_mastered = true)::int as independently_mastered_parts,
           count(*) filter (where assisted = true or revealed = true)::int as assisted_parts,
           count(*) filter (where not independently_mastered and not assisted and not revealed)::int as in_progress_parts,
           coalesce(sum(attempts_count), 0)::int as attempts
    from progress`;
  const [completion] = await sql`
    with completed as (
      select cycle.user_id
      from private.workshop_progress state
      join private.workshop_cycles cycle on cycle.id = state.cycle_id
      join public.student_profiles profile on profile.user_id = cycle.user_id and profile.is_active = true
      left join public.student_groups student_group on student_group.group_code = profile.group_code
      where cycle.workshop_id = ${workshop.id}::uuid and state.track_id = ${track.id}::uuid
        ${cycleSource === "all" ? sql`` : sql`and cycle.source = ${cycleSource}`}
        ${groupCode ? sql`and profile.group_code = ${groupCode}` : sql``}
        and (coalesce(student_group.grade_level, profile.grade_level, '') = ${workshop.grade_level}
             or coalesce(student_group.grade_level, profile.grade_level, '') = '3 ثانوي'
             or coalesce(student_group.grade_level, profile.grade_level, '') like '%الثالث%')
      group by cycle.user_id, cycle.id
      having count(distinct state.part_id) >= ${Number(partCount?.count ?? 0)}
    ) select count(distinct user_id)::int as students from completed`;
  const studentCount = Number(eligible?.students ?? 0);
  const started = Number(metrics?.started_students ?? 0);
  const attempted = Number(metrics?.attempted_parts ?? 0);
  return {
    eligible_students: studentCount,
    started_students: started,
    participation_rate: studentCount ? Math.round(1000 * started / studentCount) / 10 : 0,
    completed_students: Number(completion?.students ?? 0),
    completion_rate: studentCount ? Math.round(1000 * Number(completion?.students ?? 0) / studentCount) / 10 : 0,
    questions: Number(questionCount?.count ?? 0),
    attempted_parts: attempted,
    first_attempt_rate: attempted ? Math.round(1000 * Number(metrics?.first_correct_parts ?? 0) / attempted) / 10 : 0,
    independent_mastery_rate: attempted ? Math.round(1000 * Number(metrics?.independently_mastered_parts ?? 0) / attempted) / 10 : 0,
    assisted_rate: attempted ? Math.round(1000 * Number(metrics?.assisted_parts ?? 0) / attempted) / 10 : 0,
    in_progress_parts: Number(metrics?.in_progress_parts ?? 0),
    attempts: Number(metrics?.attempts ?? 0),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return response(req, { error: "method_not_allowed" }, 405);
  const admin = await requireAdmin(req);
  if (!admin) return response(req, { error: "unauthorized", message: "لا توجد صلاحية إدارية." }, 401);
  let body: Record<string, any>;
  try { body = await readWorkshopJson(req, 64 * 1024) as Record<string, any>; }
  catch (error) {
    if (error instanceof WorkshopRequestError) return response(req, { error: error.code, message: error.message }, error.status);
    return response(req, { error: "invalid_json" }, 400);
  }
  const action = text(body.action, 80);
  const slug = text(body.workshop_slug, 120);
  try {
    if (action === "ping") return response(req, { ok: true, level: admin.level });
    if (action === "term2_catalog") {
      const rows = await sql`
        select slug, title, grade_level, status,
               (active_version_id is not null) as has_active_version
        from private.workshop_definitions
        where slug like '%-term-2-%'
          and status = 'published'
          and active_version_id is not null
        order by grade_level, slug
        limit 150`;
      return response(req, {
        ok: true,
        workshops: rows.filter((row) => !String(row.slug).endsWith("-homework")),
        homeworks: rows.filter((row) => String(row.slug).endsWith("-homework")),
      });
    }
    if (!slug) throw new WorkshopContractError(400, "missing_workshop", "معرف الورشة مطلوب.");
    const workshop = await workshopBySlug(slug);
    if (!workshop) throw new WorkshopContractError(404, "workshop_not_found", "الورشة غير موجودة.");
    const trackKey = body.track === "home" ? "home" : "class";
    const groupCode = text(body.group_code, 80);
    const cycleSource = body.cycle_source === "admin_reopen" ? "admin_reopen" : body.cycle_source === "all" ? "all" : "initial";
    const search = text(body.search, 120);

    if (action === "overview") return response(req, { ok: true, overview: await analyticsOverview(workshop, trackKey, groupCode, cycleSource) });

    if (action === "question_key_detail") {
      requireEdit(admin);
      const questionRef = text(body.question_ref, 120), partKey = text(body.part_key || "main", 80);
      const [detail] = await sql`
        select question.question_ref, question.title, question.prompt_text, question.image_path,
               question.image_sha256, part.part_key, part.input_type, part.options_public,
               key.key_version_id, key.version_no as key_version_no, key.answer_spec,
               key.display_answer, key.feedback_hint, key.explanation, key.activated_at
        from private.workshop_questions question
        join private.workshop_question_parts part on part.question_id = question.id and part.part_key = ${partKey}
        join private.current_workshop_part_keys key on key.part_id = part.id
        where question.version_id = ${workshop.active_version_id}::uuid and question.question_ref = ${questionRef}
        limit 1`;
      if (!detail) throw new WorkshopContractError(404, "question_not_found", "السؤال أو مفتاحه الحالي غير موجود.");
      return response(req, { ok: true, detail });
    }

    if (action === "students") {
      const rows = await sql`
        select profile.user_id, profile.student_code, profile.full_name, profile.group_code,
               count(distinct progress.cycle_id)::int as cycles,
               count(progress.*)::int as attempted_parts,
               count(*) filter (where progress.first_attempt_correct = true)::int as first_correct_parts,
               count(*) filter (where progress.independently_mastered = true)::int as independently_mastered_parts,
               count(*) filter (where progress.assisted = true or progress.revealed = true)::int as assisted_parts,
               max(progress.updated_at) as last_activity
        from public.student_profiles profile
        left join public.student_groups student_group on student_group.group_code = profile.group_code
        left join private.workshop_cycles cycle on cycle.user_id = profile.user_id and cycle.workshop_id = ${workshop.id}::uuid
          ${cycleSource === "all" ? sql`` : sql`and cycle.source = ${cycleSource}`}
        left join private.workshop_progress progress on progress.cycle_id = cycle.id
          and progress.track_id in (
            select id from private.workshop_tracks
            where version_id = ${workshop.active_version_id}::uuid and track_key = ${trackKey}
          )
        where profile.is_active = true
          and (coalesce(student_group.grade_level, profile.grade_level, '') = ${workshop.grade_level}
               or coalesce(student_group.grade_level, profile.grade_level, '') = '3 ثانوي'
               or coalesce(student_group.grade_level, profile.grade_level, '') like '%الثالث%')
          ${groupCode ? sql`and profile.group_code = ${groupCode}` : sql``}
          ${search ? sql`and (profile.full_name ilike ${`%${search}%`} or profile.student_code ilike ${`%${search}%`})` : sql``}
        group by profile.user_id, profile.student_code, profile.full_name, profile.group_code
        order by attempted_parts desc, profile.full_name
        limit 250`;
      return response(req, { ok: true, students: rows });
    }

    if (action === "questions") {
      const rows = await sql`
        with filtered_progress as (
          select progress.*, cycle.user_id
          from private.workshop_progress progress
          join private.workshop_cycles cycle on cycle.id = progress.cycle_id
          join public.student_profiles profile on profile.user_id = cycle.user_id
          where cycle.workshop_id = ${workshop.id}::uuid
            ${cycleSource === "all" ? sql`` : sql`and cycle.source = ${cycleSource}`}
            and (${groupCode} = '' or profile.group_code = ${groupCode})
        )
        select question.question_ref, question.title, question.skill_ref, skill.name as skill_name,
               question.difficulty, placement.sort_order,
               count(distinct progress.user_id)::int as students_attempted,
               count(progress.*)::int as attempted_parts,
               count(*) filter (where progress.first_attempt_correct = true)::int as first_correct_parts,
               count(*) filter (where progress.independently_mastered = true)::int as independently_mastered_parts,
               count(*) filter (where progress.assisted = true or progress.revealed = true)::int as assisted_parts,
               round(avg(progress.attempts_count)::numeric, 2)::float8 as average_attempts
        from private.workshop_tracks track
        join private.workshop_track_questions placement on placement.track_id = track.id
        join private.workshop_questions question on question.id = placement.question_id
        join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
        join private.workshop_question_parts part on part.question_id = question.id
        left join filtered_progress progress on progress.track_id = track.id and progress.part_id = part.id
        where track.version_id = ${workshop.active_version_id}::uuid and track.track_key = ${trackKey}
        group by question.question_ref, question.title, question.skill_ref, skill.name, question.difficulty, placement.sort_order
        order by placement.sort_order`;
      const wrongAnswers = await sql`
        with responses as (
          select question.question_ref, event.normalized_answer, cycle.user_id
          from private.workshop_attempt_events event
          join private.workshop_questions question on question.id = event.question_id
          join private.workshop_cycles cycle on cycle.id = event.cycle_id
          join private.current_workshop_grading_decisions decision
            on decision.part_id = event.part_id and decision.response_ref = 'attempt:' || event.id::text
          join public.student_profiles profile on profile.user_id = cycle.user_id
          join private.workshop_tracks track on track.id = event.track_id
          where question.version_id = ${workshop.active_version_id}::uuid and track.track_key = ${trackKey}
            and decision.is_correct = false
            ${cycleSource === "all" ? sql`` : sql`and cycle.source = ${cycleSource}`}
            ${groupCode ? sql`and profile.group_code = ${groupCode}` : sql``}
          union all
          select question.question_ref, answer.normalized_answer, cycle.user_id
          from private.workshop_submission_answers answer
          join private.workshop_questions question on question.id = answer.question_id
          join private.workshop_submissions submission on submission.id = answer.submission_id
          join private.workshop_cycles cycle on cycle.id = submission.cycle_id
          join private.current_workshop_grading_decisions decision
            on decision.part_id = answer.part_id
           and decision.response_ref = 'submission:' || submission.id::text || ':' || answer.part_id::text
          join public.student_profiles profile on profile.user_id = cycle.user_id
          join private.workshop_tracks track on track.id = submission.track_id
          where question.version_id = ${workshop.active_version_id}::uuid and track.track_key = ${trackKey}
            and decision.is_correct = false
            ${cycleSource === "all" ? sql`` : sql`and cycle.source = ${cycleSource}`}
            ${groupCode ? sql`and profile.group_code = ${groupCode}` : sql``}
        ), counts as (
          select question_ref, normalized_answer, count(*)::int as answer_count,
                 row_number() over (partition by question_ref order by count(*) desc, normalized_answer) as rank
          from responses where normalized_answer is not null
          group by question_ref, normalized_answer
        )
        select question_ref, normalized_answer, answer_count from counts where rank = 1`;
      const wrongByQuestion = new Map(wrongAnswers.map((item) => [String(item.question_ref), item]));
      return response(req, { ok: true, questions: rows.map((row) => ({ ...row, common_wrong: wrongByQuestion.get(String(row.question_ref)) ?? null })) });
    }

    if (action === "skills") {
      const rows = await sql`
        with filtered_progress as (
          select progress.*, cycle.user_id
          from private.workshop_progress progress
          join private.workshop_cycles cycle on cycle.id = progress.cycle_id
          join public.student_profiles profile on profile.user_id = cycle.user_id
          where cycle.workshop_id = ${workshop.id}::uuid
            ${cycleSource === "all" ? sql`` : sql`and cycle.source = ${cycleSource}`}
            and (${groupCode} = '' or profile.group_code = ${groupCode})
        )
        select skill.skill_ref, skill.name, count(distinct question.id)::int as questions,
               count(progress.*)::int as attempted_parts,
               count(distinct progress.user_id)::int as students_affected,
               count(*) filter (where progress.first_attempt_correct = false)::int as first_wrong_parts,
               count(*) filter (where progress.independently_mastered = true)::int as independently_mastered_parts,
               count(*) filter (where progress.assisted = true or progress.revealed = true)::int as assisted_parts
        from private.workshop_skills skill
        join private.workshop_questions question on question.version_id = skill.version_id and question.skill_ref = skill.skill_ref
        join private.workshop_track_questions placement on placement.question_id = question.id
        join private.workshop_tracks track on track.id = placement.track_id and track.track_key = ${trackKey}
        join private.workshop_question_parts part on part.question_id = question.id
        left join filtered_progress progress on progress.track_id = track.id and progress.part_id = part.id
        where skill.version_id = ${workshop.active_version_id}::uuid
        group by skill.skill_ref, skill.name, skill.sort_order
        order by skill.sort_order`;
      return response(req, { ok: true, skills: rows });
    }

    if (action === "groups") {
      const rows = await sql`
        select profile.group_code, count(distinct profile.user_id)::int as students,
               count(distinct profile.user_id) filter (where progress.cycle_id is not null)::int as started_students,
               count(progress.*)::int as attempted_parts,
               count(*) filter (where progress.first_attempt_correct = true)::int as first_correct_parts,
               count(*) filter (where progress.independently_mastered = true)::int as independently_mastered_parts,
               count(*) filter (where progress.assisted = true or progress.revealed = true)::int as assisted_parts
        from public.student_profiles profile
        left join public.student_groups student_group on student_group.group_code = profile.group_code
        left join private.workshop_cycles cycle on cycle.user_id = profile.user_id and cycle.workshop_id = ${workshop.id}::uuid
          ${cycleSource === "all" ? sql`` : sql`and cycle.source = ${cycleSource}`}
        left join private.workshop_progress progress on progress.cycle_id = cycle.id
          and progress.track_id in (
            select id from private.workshop_tracks
            where version_id = ${workshop.active_version_id}::uuid and track_key = ${trackKey}
          )
        where profile.is_active = true and profile.group_code is not null
          and (coalesce(student_group.grade_level, profile.grade_level, '') = ${workshop.grade_level}
               or coalesce(student_group.grade_level, profile.grade_level, '') = '3 ثانوي'
               or coalesce(student_group.grade_level, profile.grade_level, '') like '%الثالث%')
        group by profile.group_code order by profile.group_code`;
      return response(req, { ok: true, groups: rows });
    }

    if (action === "student_detail") {
      const userId = text(body.user_id, 60);
      if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new WorkshopContractError(400, "invalid_student", "معرف الطالب غير صالح.");
      const [profile] = await sql`select user_id, student_code, full_name, group_code, grade_level from public.student_profiles where user_id = ${userId}::uuid limit 1`;
      if (!profile) throw new WorkshopContractError(404, "student_not_found", "الطالب غير موجود.");
      const cycles = await sql`select id, cycle_no, source, scope_kind, scope_ref, status, opened_at, opened_by, opened_reason, closed_at from private.workshop_cycles where workshop_id = ${workshop.id}::uuid and user_id = ${userId}::uuid order by cycle_no desc`;
      const progress = await sql`
        select cycle.cycle_no, track.track_key, question.question_ref, part.part_key,
               state.revision, state.attempts_count, state.first_attempt_correct,
               state.independently_mastered, state.assisted, state.revealed, state.last_answer, state.updated_at
        from private.workshop_progress state
        join private.workshop_cycles cycle on cycle.id = state.cycle_id
        join private.workshop_tracks track on track.id = state.track_id
        join private.workshop_question_parts part on part.id = state.part_id
        join private.workshop_questions question on question.id = part.question_id
        where cycle.workshop_id = ${workshop.id}::uuid and cycle.user_id = ${userId}::uuid
        order by cycle.cycle_no desc, track.track_key, question.question_ref, part.sort_order`;
      const attempts = await sql`
        select cycle.cycle_no, track.track_key, question.question_ref, part.part_key,
               event.attempt_no, event.answer_json, event.normalized_answer,
               event.is_correct as original_is_correct, event.key_version_id as original_key_version_id,
               decision.is_correct as current_is_correct, decision.key_version_id as current_key_version_id,
               decision.decision_kind as current_decision_kind, event.server_received_at
        from private.workshop_attempt_events event
        join private.workshop_cycles cycle on cycle.id = event.cycle_id
        join private.workshop_tracks track on track.id = event.track_id
        join private.workshop_questions question on question.id = event.question_id
        join private.workshop_question_parts part on part.id = event.part_id
        join private.current_workshop_grading_decisions decision
          on decision.part_id = event.part_id and decision.response_ref = 'attempt:' || event.id::text
        where cycle.workshop_id = ${workshop.id}::uuid and cycle.user_id = ${userId}::uuid
        order by cycle.cycle_no desc, event.server_received_at, event.attempt_no`;
      const weaknesses = await sql`
        select skill.skill_ref, skill.name,
               count(progress.*)::int as attempted_parts,
               count(*) filter (where progress.first_attempt_correct = false)::int as first_wrong_parts,
               count(*) filter (where progress.assisted or progress.revealed)::int as assisted_parts,
               count(*) filter (where not progress.independently_mastered and not progress.assisted and not progress.revealed)::int as in_progress_parts
        from private.workshop_progress progress
        join private.workshop_cycles cycle on cycle.id = progress.cycle_id
        join private.workshop_question_parts part on part.id = progress.part_id
        join private.workshop_questions question on question.id = part.question_id
        join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
        where cycle.workshop_id = ${workshop.id}::uuid and cycle.user_id = ${userId}::uuid
        group by skill.skill_ref, skill.name
        order by assisted_parts desc, first_wrong_parts desc, skill.skill_ref`;
      const unstarted = await sql`
        with latest_cycle as (
          select id from private.workshop_cycles
          where workshop_id = ${workshop.id}::uuid and user_id = ${userId}::uuid
          order by cycle_no desc limit 1
        )
        select track.track_key, question.question_ref, part.part_key, skill.skill_ref, skill.name as skill_name
        from private.workshop_tracks track
        join private.workshop_track_questions placement on placement.track_id = track.id
        join private.workshop_questions question on question.id = placement.question_id and question.active = true
        join private.workshop_question_parts part on part.question_id = question.id
        join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
        left join private.workshop_progress progress on progress.cycle_id = (select id from latest_cycle)
          and progress.track_id = track.id and progress.part_id = part.id
        where track.version_id = ${workshop.active_version_id}::uuid and progress.part_id is null
        order by track.sort_order, placement.sort_order, part.sort_order`;
      return response(req, { ok: true, profile, cycles, progress, attempts, weaknesses, unstarted });
    }

    if (action === "reopen") {
      requireEdit(admin);
      const userId = text(body.user_id, 60);
      const scopeKind = text(body.scope_kind, 20);
      const scopeRef = scopeKind === "workshop" ? null : text(body.scope_ref, 120);
      const reason = text(body.reason, 2000);
      if (!/^[0-9a-f-]{36}$/i.test(userId) || !["workshop", "track", "question"].includes(scopeKind) || (scopeKind !== "workshop" && !scopeRef) || reason.length < 8) {
        throw new WorkshopContractError(400, "invalid_reopen_request", "حدد الطالب والنطاق وسببًا واضحًا لإعادة الفتح.");
      }
      if (scopeKind === "track" && !["class", "home"].includes(scopeRef!)) throw new WorkshopContractError(400, "invalid_scope", "قسم إعادة الفتح غير صالح.");
      if (scopeKind === "question") {
        const [question] = await sql`select id from private.workshop_questions where version_id = ${workshop.active_version_id}::uuid and question_ref = ${scopeRef} limit 1`;
        if (!question) throw new WorkshopContractError(404, "question_not_found", "السؤال غير موجود في النسخة الحالية.");
      }
      const reopened = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`workshop-admin-reopen:${workshop.id}:${userId}`}, 0))`;
        const [previous] = await tx`select * from private.workshop_cycles where workshop_id = ${workshop.id}::uuid and user_id = ${userId}::uuid and status = 'open' order by cycle_no desc limit 1 for update`;
        if (previous) await tx`update private.workshop_cycles set status = 'closed', closed_at = now() where id = ${previous.id}::uuid`;
        const [cycle] = await tx`
          insert into private.workshop_cycles(workshop_id, user_id, cycle_no, source, scope_kind, scope_ref, opened_by, opened_reason)
          select ${workshop.id}::uuid, ${userId}::uuid, coalesce(max(cycle_no), 0) + 1,
                 'admin_reopen', ${scopeKind}, ${scopeRef}, ${admin.user.id}::uuid, ${reason}
          from private.workshop_cycles where workshop_id = ${workshop.id}::uuid and user_id = ${userId}::uuid
          returning *`;
        await tx`
          insert into private.workshop_admin_events(actor_user_id, student_user_id, workshop_id, action, scope_ref, reason, before_state, after_state)
          values (${admin.user.id}::uuid, ${userId}::uuid, ${workshop.id}::uuid,
                  ${scopeKind === 'question' ? 'reopen_question' : scopeKind === 'track' ? 'reopen_track' : 'reopen_workshop'},
                  ${scopeRef}, ${reason}, ${previous ? tx.json(previous) : null}, ${tx.json(cycle)})`;
        return cycle;
      });
      return response(req, { ok: true, cycle: reopened });
    }

    if (action === "key_version_create") {
      requireEdit(admin);
      const questionRef = text(body.question_ref, 120), partKey = text(body.part_key || "main", 80);
      const reason = text(body.reason, 2000), displayAnswer = text(body.display_answer, 2000);
      const answerSpec = jsonObject(body.answer_spec);
      if (!questionRef || !partKey || reason.length < 8 || !displayAnswer || !Object.keys(answerSpec).length) throw new WorkshopContractError(400, "invalid_key_version", "بيانات نسخة المفتاح أو سببها غير مكتملة.");
      const [part] = await sql`
        select part.id, part.input_type, part.options_public
        from private.workshop_question_parts part
        join private.workshop_questions question on question.id = part.question_id
        where question.version_id = ${workshop.active_version_id}::uuid and question.question_ref = ${questionRef} and part.part_key = ${partKey}
        limit 1`;
      if (!part) throw new WorkshopContractError(404, "question_not_found", "السؤال أو الجزء غير موجود.");
      if (part.input_type === "mcq") {
        const option = text(answerSpec.option, 20);
        if (!safeArray(part.options_public).some((item) => text(jsonObject(item).value, 20) === option)) throw new WorkshopContractError(400, "invalid_answer_key", "المفتاح لا يطابق بدائل السؤال.");
      }
      const contentHash = await sha256({ answerSpec, displayAnswer, hint: body.feedback_hint ?? null, explanation: body.explanation ?? null });
      const [version] = await sql`
        insert into private.workshop_part_key_versions
          (part_id, version_no, answer_spec, display_answer, feedback_hint, explanation,
           content_sha256, change_reason, source_kind, created_by)
        select ${part.id}::uuid, coalesce(max(version_no), 0) + 1, ${sql.json(answerSpec)}, ${displayAnswer},
               ${text(body.feedback_hint, 2000) || null}, ${text(body.explanation, 5000) || null},
               ${contentHash}, ${reason}, 'approved_correction', ${admin.user.id}::uuid
        from private.workshop_part_key_versions where part_id = ${part.id}::uuid
        returning id, part_id, version_no, content_sha256, change_reason, created_at, created_by`;
      await sql`
        insert into private.workshop_admin_events(actor_user_id, workshop_id, action, scope_ref, reason, after_state)
        values (${admin.user.id}::uuid, ${workshop.id}::uuid, 'key_version_created', ${`${questionRef}:${partKey}`}, ${reason}, ${sql.json(version)})`;
      return response(req, { ok: true, key_version: version });
    }

    if (action === "key_preview") {
      requireEdit(admin);
      const keyVersionId = text(body.key_version_id, 60), reason = text(body.reason, 2000);
      if (!/^[0-9a-f-]{36}$/i.test(keyVersionId) || reason.length < 8) throw new WorkshopContractError(400, "invalid_preview", "حدد نسخة المفتاح وسبب المعاينة.");
      const [candidate] = await sql`
        select version.*, part.input_type
        from private.workshop_part_key_versions version
        join private.workshop_question_parts part on part.id = version.part_id
        join private.workshop_questions question on question.id = part.question_id
        where version.id = ${keyVersionId}::uuid and question.version_id = ${workshop.active_version_id}::uuid
        limit 1`;
      if (!candidate) throw new WorkshopContractError(404, "key_version_not_found", "نسخة المفتاح غير موجودة.");
      const [current] = await sql`select * from private.current_workshop_part_keys where part_id = ${candidate.part_id}::uuid limit 1`;
      if (!current || current.key_version_id === candidate.id) throw new WorkshopContractError(409, "key_already_active", "هذه النسخة مفعلة بالفعل أو لا يوجد مفتاح حالي للمقارنة.");
      const decisions = await sql`
        select decision.*, cycle.user_id
        from private.current_workshop_grading_decisions decision
        join private.workshop_cycles cycle on cycle.id = decision.cycle_id
        where decision.part_id = ${candidate.part_id}::uuid`;
      const { changes, summary } = previewWorkshopRegrade(
        candidate.input_type as WorkshopInputType,
        candidate.answer_spec,
        decisions as unknown as AdminRegradeDecision[],
      );
      const preview = await sql.begin(async (tx) => {
        const [created] = await tx`
          insert into private.workshop_regrade_previews
            (part_id, from_key_version_id, to_key_version_id, requested_reason, summary, created_by, expires_at)
          values (${candidate.part_id}::uuid, ${current.key_version_id}::uuid, ${candidate.id}::uuid,
                  ${reason}, ${tx.json(summary)}, ${admin.user.id}::uuid, now() + interval '24 hours')
          returning id, part_id, from_key_version_id, to_key_version_id, requested_reason, summary, created_at, created_by, expires_at`;
        for (const item of changes) await tx`
          insert into private.workshop_regrade_preview_items(preview_id, previous_decision_id, proposed_correct, proposed_points)
          values (${created.id}::uuid, ${item.decision.id}::uuid, ${item.proposedCorrect}, ${item.proposedPoints})`;
        await tx`
          insert into private.workshop_admin_events(actor_user_id, workshop_id, action, scope_ref, reason, after_state)
          values (${admin.user.id}::uuid, ${workshop.id}::uuid, 'key_preview_created', ${String(candidate.part_id)}, ${reason}, ${tx.json(summary)})`;
        return created;
      });
      return response(req, { ok: true, preview });
    }

    if (action === "key_approve") {
      requireEdit(admin);
      const previewId = text(body.preview_id, 60), reason = text(body.reason, 2000);
      const expectedSummary = jsonObject(body.expected_summary);
      if (!/^[0-9a-f-]{36}$/i.test(previewId) || reason.length < 8 || !Object.keys(expectedSummary).length) throw new WorkshopContractError(400, "invalid_approval", "بيانات الاعتماد غير مكتملة.");
      const approved = await sql.begin(async (tx) => {
        const [preview] = await tx`select * from private.workshop_regrade_previews where id = ${previewId}::uuid for update`;
        if (!preview || new Date(preview.expires_at).getTime() <= Date.now()) throw new WorkshopContractError(409, "preview_expired", "المعاينة غير موجودة أو انتهت صلاحيتها.");
        if (preview.created_by === admin.user.id) throw new WorkshopContractError(403, "second_admin_required", "يجب أن يعتمد التصحيح مسؤول آخر.");
        if (stableJson(preview.summary) !== stableJson(expectedSummary)) throw new WorkshopContractError(409, "preview_changed", "ملخص الأثر لا يطابق المعاينة المحفوظة.");
        const [existing] = await tx`select id from private.workshop_regrade_approvals where preview_id = ${preview.id}::uuid limit 1`;
        if (existing) throw new WorkshopContractError(409, "already_approved", "تم اعتماد هذه المعاينة من قبل.");
        const [approval] = await tx`
          insert into private.workshop_regrade_approvals(preview_id, approved_by, approval_reason, expected_summary)
          values (${preview.id}::uuid, ${admin.user.id}::uuid, ${reason}, ${tx.json(expectedSummary)})
          returning *`;
        await tx`
          insert into private.workshop_admin_events(actor_user_id, workshop_id, action, scope_ref, reason, after_state)
          values (${admin.user.id}::uuid, ${workshop.id}::uuid, 'key_approved', ${String(preview.part_id)}, ${reason}, ${tx.json({ preview_id: preview.id, approval_id: approval.id, summary: expectedSummary })})`;
        return approval;
      });
      return response(req, { ok: true, approval: approved, key_activated: false, regrade_executed: false, message: "تم الاعتماد دون تغيير النتائج. يلزم تنفيذ إعادة التقييم بتأكيد مستقل." });
    }

    if (action === "key_execute_regrade") {
      requireEdit(admin);
      const approvalId = text(body.approval_id, 60), reason = text(body.reason, 2000);
      const confirmation = text(body.confirmation, 100);
      if (!/^[0-9a-f-]{36}$/i.test(approvalId) || reason.length < 8 || confirmation !== "تنفيذ إعادة التقييم") {
        throw new WorkshopContractError(400, "invalid_regrade_execution", "يلزم اعتماد صالح وسبب وعبارة التأكيد: تنفيذ إعادة التقييم");
      }
      const executed = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`workshop-regrade:${approvalId}`}, 0))`;
        const [record] = await tx`
          select approval.id as approval_id, approval.approved_by, approval.expected_summary,
                 preview.id as preview_id, preview.part_id, preview.from_key_version_id,
                 preview.to_key_version_id, preview.summary, preview.created_by,
                 candidate.answer_spec, part.input_type, definition.id as workshop_id
          from private.workshop_regrade_approvals approval
          join private.workshop_regrade_previews preview on preview.id = approval.preview_id
          join private.workshop_part_key_versions candidate on candidate.id = preview.to_key_version_id
          join private.workshop_question_parts part on part.id = preview.part_id
          join private.workshop_versions version on version.id = part.version_id
          join private.workshop_definitions definition on definition.id = version.workshop_id
          where approval.id = ${approvalId}::uuid and definition.id = ${workshop.id}::uuid
          for update of approval, preview`;
        if (!record) throw new WorkshopContractError(404, "approval_not_found", "اعتماد إعادة التقييم غير موجود لهذه الورشة.");
        const [completed] = await tx`
          select id from private.workshop_regrade_execution_events
          where approval_id = ${approvalId}::uuid and event_type = 'completed' limit 1`;
        if (completed) throw new WorkshopContractError(409, "regrade_already_executed", "نُفذت إعادة التقييم لهذا الاعتماد من قبل.");

        await tx`select pg_advisory_xact_lock(hashtextextended(${`workshop-key:${record.part_id}`}, 0))`;
        const [currentKey] = await tx`
          select key_version_id from private.current_workshop_part_keys
          where part_id = ${record.part_id}::uuid limit 1`;
        if (!currentKey || currentKey.key_version_id !== record.from_key_version_id) {
          throw new WorkshopContractError(409, "active_key_changed", "تغير المفتاح الحالي بعد المعاينة؛ أنشئ معاينة واعتمادًا جديدين.");
        }
        const decisions = await tx`
          select decision.*, cycle.user_id
          from private.current_workshop_grading_decisions decision
          join private.workshop_cycles cycle on cycle.id = decision.cycle_id
          where decision.part_id = ${record.part_id}::uuid`;
        const { changes, summary } = previewWorkshopRegrade(
          record.input_type as WorkshopInputType,
          record.answer_spec,
          decisions as unknown as AdminRegradeDecision[],
        );
        if (stableJson(summary) !== stableJson(record.summary) || stableJson(summary) !== stableJson(record.expected_summary)) {
          throw new WorkshopContractError(409, "regrade_population_changed", "تغيرت المحاولات أو النتائج منذ المعاينة؛ أنشئ معاينة واعتمادًا جديدين.");
        }

        await tx`
          insert into private.workshop_regrade_execution_events(approval_id, event_type, detail, recorded_by)
          values (${approvalId}::uuid, 'started', ${tx.json({ summary, reason })}, ${admin.user.id}::uuid)`;
        await tx`
          insert into private.workshop_admin_events(actor_user_id, workshop_id, action, scope_ref, reason, after_state)
          values (${admin.user.id}::uuid, ${workshop.id}::uuid, 'regrade_started', ${String(record.part_id)}, ${reason}, ${tx.json({ approval_id: approvalId, summary })})`;
        await tx`
          insert into private.workshop_part_key_activations
            (part_id, key_version_id, previous_key_version_id, activation_kind,
             activation_reason, activated_by, approved_by)
          values (${record.part_id}::uuid, ${record.to_key_version_id}::uuid,
                  ${record.from_key_version_id}::uuid, 'approved_correction', ${reason},
                  ${record.created_by}::uuid, ${record.approved_by}::uuid)`;

        for (const item of changes) await tx`
          insert into private.workshop_grading_decisions
            (cycle_id, part_id, response_ref, answer_snapshot, key_version_id, is_correct,
             awarded_points, max_points, decision_kind, supersedes_decision_id, reason, created_by)
          values (${item.decision.cycle_id}::uuid, ${record.part_id}::uuid, ${item.decision.response_ref},
                  ${tx.json(item.decision.answer_snapshot)}, ${record.to_key_version_id}::uuid,
                  ${item.proposedCorrect}, ${item.proposedPoints}, ${item.maxPoints},
                  'approved_regrade', ${item.decision.id}::uuid, ${reason}, ${admin.user.id}::uuid)`;

        const affectedCycles = [...new Set(changes.map((item) => String(item.decision.cycle_id)))];
        for (const cycleId of affectedCycles) {
          const attempts = await tx`
            select event.track_id, event.attempt_no, event.server_received_at,
                   decision.is_correct, reveal.revealed_at
            from private.workshop_attempt_events event
            join private.current_workshop_grading_decisions decision
              on decision.part_id = event.part_id and decision.response_ref = 'attempt:' || event.id::text
            left join private.workshop_reveal_events reveal
              on reveal.cycle_id = event.cycle_id and reveal.track_id = event.track_id and reveal.part_id = event.part_id
            where event.cycle_id = ${cycleId}::uuid and event.part_id = ${record.part_id}::uuid
            order by event.attempt_no` as unknown as Array<{ track_id: string; attempt_no: number; server_received_at: string | Date; is_correct: boolean; revealed_at?: string | Date | null }>;
          if (attempts.length) {
            const revealAt = attempts.find((item) => item.revealed_at)?.revealed_at;
            const derived = deriveInteractiveProgressAfterRegrade(attempts, revealAt);
            await tx`
              update private.workshop_progress
              set first_attempt_correct = ${derived.first_attempt_correct},
                  independently_mastered = ${derived.independently_mastered},
                  assisted = ${derived.assisted}, revealed = ${derived.revealed},
                  updated_at = now()
              where cycle_id = ${cycleId}::uuid and track_id = ${attempts[0].track_id}::uuid
                and part_id = ${record.part_id}::uuid`;
          }
          const submissions = await tx`
            select submission.track_id, decision.is_correct
            from private.workshop_submission_answers answer
            join private.workshop_submissions submission on submission.id = answer.submission_id
            join private.current_workshop_grading_decisions decision
              on decision.part_id = answer.part_id
             and decision.response_ref = 'submission:' || submission.id::text || ':' || answer.part_id::text
            where submission.cycle_id = ${cycleId}::uuid and answer.part_id = ${record.part_id}::uuid`;
          for (const submission of submissions) await tx`
            update private.workshop_progress
            set first_attempt_correct = ${Boolean(submission.is_correct)},
                independently_mastered = ${Boolean(submission.is_correct)},
                assisted = false, revealed = false, updated_at = now()
            where cycle_id = ${cycleId}::uuid and track_id = ${submission.track_id}::uuid
              and part_id = ${record.part_id}::uuid`;
        }

        const detail = { approval_id: approvalId, appended_decisions: changes.length, affected_cycles: affectedCycles.length, summary };
        await tx`
          insert into private.workshop_regrade_execution_events(approval_id, event_type, detail, recorded_by)
          values (${approvalId}::uuid, 'completed', ${tx.json(detail)}, ${admin.user.id}::uuid)`;
        await tx`
          insert into private.workshop_admin_events(actor_user_id, workshop_id, action, scope_ref, reason, after_state)
          values (${admin.user.id}::uuid, ${workshop.id}::uuid, 'regrade_completed', ${String(record.part_id)}, ${reason}, ${tx.json(detail)})`;
        return detail;
      });
      return response(req, { ok: true, key_activated: true, regrade_executed: true, execution: executed });
    }

    throw new WorkshopContractError(400, "unknown_action", "الإجراء المطلوب غير معروف.");
  } catch (error) {
    if (error instanceof WorkshopContractError) return response(req, { error: error.code, message: error.message }, error.status);
    console.error("admin-unified-workshop", error);
    return response(req, { error: "server_error", message: "تعذر تنفيذ العملية الإدارية. لم تُحذف أو تُعدّل محاولات." }, 500);
  }
});
