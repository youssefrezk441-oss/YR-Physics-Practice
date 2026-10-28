import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.0";
import postgres from "npm:postgres@3.4.7";
import { readWorkshopJson, WorkshopRequestError } from "../_shared/workshop-security.ts";
import { validateRequestId } from "../_shared/unified-workshop-core.ts";
import {
  gradeHomeworkPart,
  PaperHomeworkError,
  summarizeHomework,
  validateHomeworkAnswer,
  validateSelfAssessment,
  type HomeworkAnswerState,
  type HomeworkResponseKind,
} from "../_shared/paper-homework-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLIC_KEYS = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
const SUPABASE_KEY = PUBLIC_KEYS.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DATABASE_URL = Deno.env.get("SUPABASE_DB_URL") ?? "";
const authClient = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const storageClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = postgres(DATABASE_URL, { prepare: false, max: 4, idle_timeout: 20 });
const BUCKET = "homework-answer-images";
const allowedOrigins = new Set(["https://youssefrezk441-oss.github.io", "http://127.0.0.1:8000", "http://localhost:8000"]);

const text = (value: unknown, max = 300) => String(value ?? "").normalize("NFKC").trim().slice(0, max);
const canonicalGrade = (value: unknown) => {
  const grade = text(value, 100);
  return grade === "3 ثانوي" || grade.includes("الثالث") || /^3(?:\D|$)/.test(grade) ? "الصف الثالث الثانوي" : grade;
};
const stableJson = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(stableJson).join(",")}]`
  : value && typeof value === "object"
  ? `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`
  : JSON.stringify(value);
async function sha256(value: string | ArrayBuffer) {
  const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const bytes = await crypto.subtle.digest("SHA-256", data);
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
const respond = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers(req) });

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
    where profile.user_id = ${data.user.id}::uuid limit 1`;
  if (!profile?.is_active || canonicalGrade(profile.group_grade ?? profile.grade_level) !== "الصف الثالث الثانوي") return null;
  return { user: data.user, profile };
}

async function requireAdmin(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const { data, error } = await authClient.auth.getUser(authorization.slice(7));
  if (error || !data.user) return null;
  const [permission] = await sql`select public.admin_access_level('students', ${data.user.id}::uuid) as level`;
  return permission?.level && permission.level !== "none" ? { user: data.user, level: permission.level } : null;
}

const adminActions = new Set(["overview", "students", "student_detail", "questions", "skills"]);

async function handleAdmin(req: Request, body: Record<string, unknown>, action: string) {
  const admin = await requireAdmin(req);
  if (!admin) return respond(req, { error: "unauthorized", message: "لا توجد صلاحية إدارية." }, 401);
  const slug = text(body.workshop_slug || "third-secondary-term-2-lecture-1-homework", 180);
  const group = text(body.group_code, 80);
  const search = text(body.search, 120);
  const [work] = await sql`select id, active_version_id as version_id, title, grade_level, eligible_group_codes from private.workshop_definitions where slug=${slug} limit 1`;
  if (!work) return respond(req, { error: "not_found", message: "الواجب غير موجود." }, 404);
  if (action === "overview") {
    const [eligible] = await sql`select count(*)::int as count from public.student_profiles profile left join public.student_groups student_group on student_group.group_code=profile.group_code where profile.is_active and (coalesce(student_group.grade_level,profile.grade_level,'')='3 ثانوي' or coalesce(student_group.grade_level,profile.grade_level,'') like '%الثالث%') ${group ? sql`and profile.group_code=${group}` : sql``}`;
    const [metrics] = await sql`select count(*)::int as submitted,coalesce(avg(case when mcq_max_score>0 then mcq_score*100/mcq_max_score end),0)::numeric(10,2) as average_mcq,coalesce(sum(unanswered_parts),0)::int as unanswered from private.homework_submissions submission join public.student_profiles profile on profile.user_id=submission.user_id where submission.workshop_id=${work.id}::uuid ${group ? sql`and profile.group_code=${group}` : sql``}`;
    const [essays] = await sql`select count(*) filter(where review.assessment='correct')::int as correct,count(*) filter(where review.assessment='partial')::int as partial,count(*) filter(where review.assessment='incorrect')::int as incorrect,count(*) filter(where answer.response_kind='essay_self_review' and review.id is null)::int as pending from private.homework_submission_answers answer join private.homework_submissions submission on submission.id=answer.submission_id left join private.homework_self_review_events review on review.submission_answer_id=answer.id join public.student_profiles profile on profile.user_id=submission.user_id where submission.workshop_id=${work.id}::uuid ${group ? sql`and profile.group_code=${group}` : sql``}`;
    const [mistakes] = await sql`select count(*)::int as total,
      count(*) filter(where exists(select 1 from private.ch2_mistake_review_events review where review.user_id=evidence.user_id and review.mistake_ref=evidence.mistake_ref))::int as reviewed,
      count(*) filter(where exists(select 1 from private.ch2_mistake_mastery_attempts attempt where attempt.user_id=evidence.user_id and attempt.mistake_ref=evidence.mistake_ref and attempt.is_correct)
        or exists(select 1 from private.ch2_essay_mastery_retries retry join private.ch2_essay_mastery_reviews review on review.retry_id=retry.id and review.assessment='correct' where retry.user_id=evidence.user_id and retry.mistake_ref=evidence.mistake_ref))::int as mastered
      from private.ch2_paper_homework_mistake_evidence evidence join public.student_profiles profile on profile.user_id=evidence.user_id
      where evidence.workshop_id=${work.id}::uuid ${group ? sql`and profile.group_code=${group}` : sql``}`;
    return respond(req, { ok: true, level: admin.level, overview: { eligible: Number(eligible.count), submitted: Number(metrics.submitted), unsubmitted: Math.max(0, Number(eligible.count) - Number(metrics.submitted)), average_mcq: Number(metrics.average_mcq), unanswered: Number(metrics.unanswered), essay_self_review: essays, mistake_progress: mistakes } });
  }
  if (action === "students") {
    const rows = await sql`select profile.user_id,profile.student_code,profile.full_name,profile.group_code,submission.id as submission_id,submission.mcq_score,submission.mcq_max_score,submission.answered_parts,submission.unanswered_parts,submission.submitted_at from public.student_profiles profile left join private.homework_submissions submission on submission.user_id=profile.user_id and submission.workshop_id=${work.id}::uuid where profile.is_active and (profile.grade_level='3 ثانوي' or profile.grade_level like '%الثالث%') ${group ? sql`and profile.group_code=${group}` : sql``} ${search ? sql`and (profile.full_name ilike ${`%${search}%`} or profile.student_code ilike ${`%${search}%`})` : sql``} order by (submission.id is null),profile.full_name limit 500`;
    return respond(req, { ok: true, students: rows });
  }
  if (action === "student_detail") {
    const userId = text(body.user_id, 40);
    const rows = await sql`select question.question_ref,question.source_ref,question.title,question.image_path,question.skill_ref,skill.name as skill_name,part.part_key,part.label,answer.response_kind,answer.answer_state,answer.answer_json,answer.is_correct,answer.awarded_points,answer.max_points,review.assessment,review.reviewed_at from private.homework_submission_answers answer join private.homework_submissions submission on submission.id=answer.submission_id join private.workshop_questions question on question.id=answer.question_id join private.workshop_skills skill on skill.version_id=question.version_id and skill.skill_ref=question.skill_ref join private.workshop_question_parts part on part.id=answer.part_id left join private.homework_self_review_events review on review.submission_answer_id=answer.id where submission.workshop_id=${work.id}::uuid and submission.user_id=${userId}::uuid order by question.question_ref,part.sort_order`;
    return respond(req, { ok: true, answers: rows });
  }
  if (action === "questions") {
    const rows = await sql`select question.question_ref,question.source_ref,question.title,question.skill_ref,skill.name as skill_name,part.part_key,part.label,count(answer.id)::int as submissions,count(*) filter(where answer.answer_state='answered' and answer.is_correct=false)::int as wrong,count(*) filter(where answer.answer_state='unanswered')::int as unanswered from private.workshop_questions question join private.workshop_skills skill on skill.version_id=question.version_id and skill.skill_ref=question.skill_ref join private.workshop_question_parts part on part.question_id=question.id left join private.homework_submission_answers answer on answer.question_id=question.id and answer.part_id=part.id left join private.homework_submissions submission on submission.id=answer.submission_id left join public.student_profiles profile on profile.user_id=submission.user_id where question.version_id=${work.version_id}::uuid ${group ? sql`and (profile.group_code=${group} or profile.user_id is null)` : sql``} group by question.question_ref,question.source_ref,question.title,question.skill_ref,skill.name,part.part_key,part.label,part.sort_order order by wrong desc,question.question_ref,part.sort_order`;
    return respond(req, { ok: true, questions: rows });
  }
  const rows = await sql`select skill.skill_ref,skill.name,count(answer.id) filter(where answer.answer_state='answered')::int as answered,count(answer.id) filter(where answer.answer_state='answered' and answer.is_correct=false)::int as wrong,count(answer.id) filter(where answer.answer_state='unanswered')::int as unanswered from private.workshop_skills skill join private.workshop_questions question on question.version_id=skill.version_id and question.skill_ref=skill.skill_ref join private.workshop_question_parts part on part.question_id=question.id left join private.homework_submission_answers answer on answer.part_id=part.id left join private.homework_submissions submission on submission.id=answer.submission_id left join public.student_profiles profile on profile.user_id=submission.user_id where skill.version_id=${work.version_id}::uuid ${group ? sql`and (profile.group_code=${group} or profile.user_id is null)` : sql``} group by skill.skill_ref,skill.name,skill.sort_order order by skill.sort_order`;
  return respond(req, { ok: true, skills: rows });
}

async function getWorkshop(slug: string, groupCode: string) {
  const [row] = await sql`
    select definition.id, definition.slug, definition.title, definition.grade_level,
           definition.academic_term, definition.lecture_no, definition.eligible_group_codes,
           definition.active_version_id as version_id, version.content_sha256,
           policy.delivery_contract
    from private.workshop_definitions definition
    join private.workshop_versions version on version.id = definition.active_version_id and version.status = 'published'
    join private.homework_delivery_policies policy on policy.workshop_id = definition.id and policy.enabled
    where definition.slug = ${slug} and definition.status = 'published'
      and definition.academic_term = 'second'
      and (jsonb_array_length(definition.eligible_group_codes) = 0 or definition.eligible_group_codes ? ${groupCode})
    limit 1`;
  return row ?? null;
}

async function loadParts(workshopId: string, versionId: string) {
  return await sql`
    select question.id as question_id, question.question_ref, question.source_ref,
           question.title as question_title, question.image_path, question.image_sha256,
           question.skill_ref, skill.name as skill_name, placement.sort_order as question_order,
           part.id as part_id, part.part_key, part.label, part.input_type, part.options_public,
           part.max_points, part.public_config, part.sort_order as part_order
    from private.workshop_questions question
    join private.workshop_track_questions placement on placement.question_id = question.id
    join private.workshop_tracks track on track.id = placement.track_id and track.track_key = 'home'
    join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
    join private.workshop_question_parts part on part.question_id = question.id
    where question.version_id = ${versionId}::uuid and question.active = true
      and track.version_id = ${versionId}::uuid
    order by placement.sort_order, part.sort_order`;
}

async function ensureAttempt(workshopId: string, versionId: string, userId: string) {
  const [attempt] = await sql`
    insert into private.homework_attempts (workshop_id, version_id, user_id)
    values (${workshopId}::uuid, ${versionId}::uuid, ${userId}::uuid)
    on conflict (workshop_id, user_id) do update set last_activity_at = case
      when private.homework_attempts.status = 'draft' then now() else private.homework_attempts.last_activity_at end
    returning *`;
  return attempt;
}

async function receipt(tx: postgres.TransactionSql, userId: string, requestId: string, bodyHash: string) {
  const [stored] = await tx`select body_sha256, response_json from private.homework_mutation_receipts where user_id = ${userId}::uuid and request_id = ${requestId}::uuid limit 1`;
  if (!stored) return null;
  if (stored.body_sha256 !== bodyHash) throw new PaperHomeworkError(409, "request_id_reused", "أُعيد استخدام معرف الطلب ببيانات مختلفة.");
  return stored.response_json;
}

async function storeReceipt(tx: postgres.TransactionSql, userId: string, requestId: string, action: string, bodyHash: string, result: Record<string, unknown>) {
  await tx`insert into private.homework_mutation_receipts (request_id, user_id, action, body_sha256, response_json)
    values (${requestId}::uuid, ${userId}::uuid, ${action}, ${bodyHash}, ${tx.json(result as any)})`;
}

async function submissionResult(userId: string, workshopId: string) {
  const [submission] = await sql`
    select id, mcq_score, mcq_max_score, answered_parts, unanswered_parts, submitted_at
    from private.homework_submissions where user_id = ${userId}::uuid and workshop_id = ${workshopId}::uuid limit 1`;
  if (!submission) return null;
  const answers = await sql`
    select answer.id, answer.question_id, answer.part_id, answer.response_kind, answer.answer_state,
           answer.answer_json, answer.normalized_answer, answer.is_correct, answer.awarded_points,
           answer.max_points, question.question_ref, question.source_ref, question.title as question_title,
           question.image_path, question.skill_ref, skill.name as skill_name,
           part.part_key, part.label, key.display_answer, key.feedback_hint, key.explanation,
           review.assessment, review.reviewed_at
    from private.homework_submission_answers answer
    join private.workshop_questions question on question.id = answer.question_id
    join private.workshop_skills skill on skill.version_id = question.version_id and skill.skill_ref = question.skill_ref
    join private.workshop_question_parts part on part.id = answer.part_id
    join private.workshop_part_key_versions key on key.id = answer.key_version_id
    left join private.homework_self_review_events review on review.submission_answer_id = answer.id
    where answer.submission_id = ${submission.id}::uuid
    order by question.question_ref, part.sort_order`;
  return { ...submission, mcq_score: Number(submission.mcq_score), mcq_max_score: Number(submission.mcq_max_score), answers };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return respond(req, { error: "method_not_allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await readWorkshopJson(req, 32 * 1024); }
  catch (error) {
    if (error instanceof WorkshopRequestError) return respond(req, { error: error.code, message: error.message }, error.status);
    return respond(req, { error: "invalid_json" }, 400);
  }
  const action = text(body.action, 60);
  if (adminActions.has(action)) {
    try { return await handleAdmin(req, body, action); }
    catch (error) {
      console.error("paper-homework-admin", action, error instanceof Error ? error.message : error);
      return respond(req, { error: "server_error", message: "تعذر تحميل التقرير." }, 500);
    }
  }
  const account = await requireStudent(req);
  if (!account) return respond(req, { error: "unauthorized", message: "يجب تسجيل الدخول بحساب طالب نشط من الصف الثالث الثانوي." }, 401);
  const slug = text(body.workshop_slug, 160);
  const groupCode = String(account.profile.group_code ?? "");
  try {
    const workshop = await getWorkshop(slug, groupCode);
    if (!workshop) throw new PaperHomeworkError(404, "homework_unavailable", "هذا الواجب غير متاح لمجموعتك حاليًا.");
    if (action === "ping") return respond(req, { ok: true, available: true, workshop: { slug: workshop.slug, title: workshop.title } });

    if (action === "load") {
      const attempt = await ensureAttempt(workshop.id, workshop.version_id, account.user.id);
      const parts = await loadParts(workshop.id, workshop.version_id);
      const drafts = attempt.status === "draft" ? await sql`
        select part_id, answer_state, answer_json, revision, updated_at
        from private.homework_draft_answers where attempt_id = ${attempt.id}::uuid` : [];
      const result = attempt.status === "submitted" ? await submissionResult(account.user.id, workshop.id) : null;
      return respond(req, {
        ok: true,
        profile: { full_name: account.profile.full_name, student_code: account.profile.student_code },
        workshop: { slug: workshop.slug, title: workshop.title, lecture_no: workshop.lecture_no },
        attempt: { id: attempt.id, status: attempt.status, opened_at: attempt.opened_at },
        parts,
        drafts,
        submission: result,
      });
    }

    if (action === "submission_status") {
      return respond(req, { ok: true, submission: await submissionResult(account.user.id, workshop.id) });
    }

    if (action === "save_answer") {
      const requestId = validateRequestId(body.request_id);
      const partId = text(body.part_id, 40);
      const expectedRevision = Number(body.expected_revision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new PaperHomeworkError(400, "invalid_revision", "نسخة الإجابة غير صالحة.");
      const bodyHash = await sha256(stableJson(body));
      const result = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`paper-homework:${workshop.id}:${account.user.id}`}, 0))`;
        const replay = await receipt(tx, account.user.id, requestId, bodyHash);
        if (replay) return replay;
        const [attempt] = await tx`select * from private.homework_attempts where workshop_id = ${workshop.id}::uuid and user_id = ${account.user.id}::uuid for update`;
        if (!attempt || attempt.status !== "draft") throw new PaperHomeworkError(409, "already_submitted", "تم تسليم هذا الواجب بالفعل.");
        const [part] = await tx`
          select part.id, part.question_id, part.input_type, part.public_config
          from private.workshop_question_parts part
          join private.workshop_questions question on question.id = part.question_id
          where part.id = ${partId}::uuid and question.version_id = ${workshop.version_id}::uuid limit 1`;
        if (!part) throw new PaperHomeworkError(404, "part_not_found", "جزء السؤال غير موجود.");
        const responseKind: HomeworkResponseKind = part.public_config?.essay_self_review ? "essay_self_review" : "auto_mcq";
        const validated = validateHomeworkAnswer({ responseKind, state: body.answer_state, answer: body.answer });
        const imageIds = validated.state === "answered" && responseKind === "essay_self_review"
          ? (validated.answer.image_ids as string[]) : [];
        if (imageIds.length) {
          const [owned] = await tx`
            select count(*)::int as count from private.homework_answer_images
            where attempt_id = ${attempt.id}::uuid and question_id = ${part.question_id}::uuid
              and removed_at is null and id in ${tx(imageIds)} `;
          if (Number(owned?.count ?? 0) !== imageIds.length) throw new PaperHomeworkError(400, "invalid_answer_image", "إحدى صور الإجابة لا تخص هذا السؤال أو لم يكتمل حفظها.");
        }
        const [current] = await tx`select revision from private.homework_draft_answers where attempt_id = ${attempt.id}::uuid and part_id = ${partId}::uuid for update`;
        const actual = Number(current?.revision ?? 0);
        if (actual !== expectedRevision) return { ok: true, stale: true, revision: actual };
        const [saved] = await tx`
          insert into private.homework_draft_answers (attempt_id, question_id, part_id, answer_state, answer_json, revision)
          select ${attempt.id}::uuid, part.question_id, part.id, ${validated.state}, ${validated.answer ? tx.json(validated.answer) : null}, ${actual + 1}
          from private.workshop_question_parts part where part.id = ${partId}::uuid
          on conflict (attempt_id, part_id) do update set answer_state = excluded.answer_state,
            answer_json = excluded.answer_json, revision = excluded.revision, updated_at = now()
          returning revision, updated_at`;
        await tx`update private.homework_attempts set last_activity_at = now() where id = ${attempt.id}::uuid`;
        const response = { ok: true, stale: false, revision: Number(saved.revision), updated_at: saved.updated_at };
        await storeReceipt(tx, account.user.id, requestId, action, bodyHash, response);
        return response;
      });
      return respond(req, result);
    }

    if (action === "create_image_upload") {
      if (!SERVICE_KEY) throw new PaperHomeworkError(503, "storage_unavailable", "رفع الصور غير متاح مؤقتًا.");
      const questionId = text(body.question_id, 40);
      const mime = text(body.mime_type, 40);
      if (!new Set(["image/jpeg", "image/webp"]).has(mime)) throw new PaperHomeworkError(400, "invalid_image_type", "ارفع صورة JPEG أو WebP.");
      const [attempt] = await sql`select id, status from private.homework_attempts where workshop_id = ${workshop.id}::uuid and user_id = ${account.user.id}::uuid limit 1`;
      if (!attempt || attempt.status !== "draft") throw new PaperHomeworkError(409, "already_submitted", "لا يمكن تعديل الصور بعد التسليم.");
      const [question] = await sql`select id from private.workshop_questions where id = ${questionId}::uuid and version_id = ${workshop.version_id}::uuid limit 1`;
      if (!question) throw new PaperHomeworkError(404, "question_not_found", "السؤال غير موجود.");
      const extension = mime === "image/webp" ? "webp" : "jpg";
      const uploadId = crypto.randomUUID();
      const path = `${account.user.id}/${attempt.id}/${questionId}/${uploadId}.${extension}`;
      const { data, error } = await storageClient.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
      if (error || !data) throw new PaperHomeworkError(503, "upload_url_failed", "تعذر تجهيز رفع الصورة.");
      return respond(req, { ok: true, upload_id: uploadId, object_path: path, signed_url: data.signedUrl, token: data.token });
    }

    if (action === "confirm_image_upload") {
      if (!SERVICE_KEY) throw new PaperHomeworkError(503, "storage_unavailable", "رفع الصور غير متاح مؤقتًا.");
      const requestId = validateRequestId(body.request_id);
      const questionId = text(body.question_id, 40);
      const objectPath = text(body.object_path, 1000);
      const expectedPrefix = `${account.user.id}/`;
      if (!objectPath.startsWith(expectedPrefix) || !/\.(?:jpg|webp)$/.test(objectPath)) throw new PaperHomeworkError(400, "invalid_object_path", "مسار الصورة غير صالح.");
      const { data: file, error } = await storageClient.storage.from(BUCKET).download(objectPath);
      if (error || !file) throw new PaperHomeworkError(404, "image_not_uploaded", "لم يصل ملف الصورة بعد.");
      if (file.size < 1 || file.size > 409600 || !new Set(["image/jpeg", "image/webp"]).has(file.type)) throw new PaperHomeworkError(400, "invalid_image", "الصورة لا تطابق حدود النوع أو الحجم.");
      const digest = await sha256(await file.arrayBuffer());
      const stored = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`paper-homework-image:${account.user.id}:${questionId}`}, 0))`;
        const [row] = await tx`
          insert into private.homework_answer_images (request_id, attempt_id, question_id, object_path, mime_type, size_bytes, image_sha256)
          select ${requestId}::uuid, attempt.id, question.id, ${objectPath}, ${file.type}, ${file.size}, ${digest}
          from private.homework_attempts attempt
          join private.workshop_questions question on question.id = ${questionId}::uuid and question.version_id = attempt.version_id
          where attempt.workshop_id = ${workshop.id}::uuid and attempt.user_id = ${account.user.id}::uuid and attempt.status = 'draft'
            and (select count(*) from private.homework_answer_images image where image.attempt_id = attempt.id and image.question_id = question.id and image.removed_at is null) < 3
          on conflict (attempt_id, request_id) do update set request_id = excluded.request_id
          returning id, object_path, mime_type, size_bytes, image_sha256`;
        return row;
      });
      if (!stored) throw new PaperHomeworkError(409, "image_limit_or_submitted", "تعذر تثبيت الصورة؛ ربما وصل السؤال للحد الأقصى أو تم التسليم.");
      return respond(req, { ok: true, image: stored });
    }

    if (action === "remove_image") {
      const imageId = text(body.image_id, 40);
      const [removed] = await sql`
        update private.homework_answer_images image set removed_at = now()
        from private.homework_attempts attempt
        where image.id = ${imageId}::uuid and image.attempt_id = attempt.id
          and attempt.workshop_id = ${workshop.id}::uuid and attempt.user_id = ${account.user.id}::uuid
          and attempt.status = 'draft' and image.removed_at is null
        returning image.id`;
      if (!removed) throw new PaperHomeworkError(404, "image_not_found", "الصورة غير موجودة أو تم التسليم بالفعل.");
      return respond(req, { ok: true, image_id: removed.id });
    }

    if (action === "submit") {
      const requestId = validateRequestId(body.request_id);
      const bodyHash = await sha256(stableJson(body));
      const result = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`paper-homework:${workshop.id}:${account.user.id}`}, 0))`;
        const replay = await receipt(tx, account.user.id, requestId, bodyHash);
        if (replay) return replay;
        const [attempt] = await tx`select * from private.homework_attempts where workshop_id = ${workshop.id}::uuid and user_id = ${account.user.id}::uuid for update`;
        if (!attempt) throw new PaperHomeworkError(409, "attempt_not_opened", "افتح الواجب أولًا.");
        if (attempt.status === "submitted") return { ok: true, already_submitted: true, submission_id: (await tx`select id from private.homework_submissions where attempt_id = ${attempt.id}::uuid`)[0]?.id };
        const rows = await tx`
          select question.id as question_id, part.id as part_id, part.input_type, part.max_points,
                 part.public_config, draft.answer_state, draft.answer_json,
                 key.id as key_version_id, key.answer_spec
          from private.workshop_questions question
          join private.workshop_question_parts part on part.question_id = question.id
          left join private.homework_draft_answers draft on draft.attempt_id = ${attempt.id}::uuid and draft.part_id = part.id
          join lateral (
            select version.id, version.answer_spec from private.workshop_part_key_activations activation
            join private.workshop_part_key_versions version on version.id = activation.key_version_id
            where activation.part_id = part.id order by activation.activated_at desc, activation.id desc limit 1
          ) key on true
          where question.version_id = ${workshop.version_id}::uuid and question.active = true
          order by question.question_ref, part.sort_order for update of question, part`;
        if (!rows.length) throw new PaperHomeworkError(409, "empty_homework", "الواجب لا يحتوي أسئلة قابلة للتسليم.");
        const sourceRows = rows as unknown as Record<string, any>[];
        const graded: Array<Record<string, any> & {
          responseKind: HomeworkResponseKind;
          answerState: HomeworkAnswerState;
          normalized: string | null;
          isCorrect: boolean | null;
          awardedPoints: number;
          maxPoints: number;
        }> = sourceRows.map((row) => {
          const responseKind: HomeworkResponseKind = row.public_config?.essay_self_review ? "essay_self_review" : "auto_mcq";
          const answerState: HomeworkAnswerState = row.answer_state === "answered" ? "answered" : "unanswered";
          const grade = gradeHomeworkPart({ responseKind, answerState, answer: row.answer_json, answerSpec: row.answer_spec, maxPoints: Number(row.max_points) });
          return { ...row, responseKind, answerState, ...grade, maxPoints: Number(row.max_points) };
        });
        const summary = summarizeHomework(graded);
        const [submission] = await tx`
          insert into private.homework_submissions (request_id, attempt_id, workshop_id, version_id, user_id, mcq_score, mcq_max_score, answered_parts, unanswered_parts)
          values (${requestId}::uuid, ${attempt.id}::uuid, ${workshop.id}::uuid, ${workshop.version_id}::uuid, ${account.user.id}::uuid,
            ${summary.mcqScore}, ${summary.mcqMaxScore}, ${summary.answeredParts}, ${summary.unansweredParts}) returning id, submitted_at`;
        for (const item of graded) await tx`
          insert into private.homework_submission_answers
            (submission_id, question_id, part_id, response_kind, answer_state, answer_json, normalized_answer,
             key_version_id, is_correct, awarded_points, max_points)
          values (${submission.id}::uuid, ${item.question_id}::uuid, ${item.part_id}::uuid, ${item.responseKind},
            ${item.answerState}, ${item.answer_json ? tx.json(item.answer_json) : null}, ${item.normalized},
            ${item.key_version_id}::uuid, ${item.isCorrect}, ${item.awardedPoints}, ${item.maxPoints})`;
        await tx`update private.homework_attempts set status = 'submitted', submitted_at = ${submission.submitted_at}, last_activity_at = ${submission.submitted_at} where id = ${attempt.id}::uuid`;
        const response = { ok: true, submission_id: submission.id, submitted_at: submission.submitted_at, summary };
        await storeReceipt(tx, account.user.id, requestId, action, bodyHash, response);
        return response;
      });
      return respond(req, { ...result, submission: await submissionResult(account.user.id, workshop.id) });
    }

    if (action === "self_review") {
      const requestId = validateRequestId(body.request_id);
      const answerId = text(body.submission_answer_id, 40);
      const bodyHash = await sha256(stableJson(body));
      const result = await sql.begin(async (tx) => {
        const replay = await receipt(tx, account.user.id, requestId, bodyHash);
        if (replay) return replay;
        const [answer] = await tx`
          select answer.id, answer.answer_state
          from private.homework_submission_answers answer
          join private.homework_submissions submission on submission.id = answer.submission_id
          where answer.id = ${answerId}::uuid and answer.response_kind = 'essay_self_review'
            and submission.user_id = ${account.user.id}::uuid and submission.workshop_id = ${workshop.id}::uuid
          limit 1 for update of answer`;
        if (!answer) throw new PaperHomeworkError(404, "essay_answer_not_found", "إجابة السؤال المقالي غير موجودة.");
        const assessment = validateSelfAssessment(body.assessment, answer.answer_state);
        const [event] = await tx`
          insert into private.homework_self_review_events (request_id, user_id, submission_answer_id, assessment)
          values (${requestId}::uuid, ${account.user.id}::uuid, ${answer.id}::uuid, ${assessment})
          on conflict (submission_answer_id) do nothing returning assessment, reviewed_at`;
        if (!event) throw new PaperHomeworkError(409, "review_locked", "تم تثبيت تقييم هذا المطلوب من قبل ولا يمكن تغييره.");
        const response = { ok: true, assessment: event.assessment, reviewed_at: event.reviewed_at };
        await storeReceipt(tx, account.user.id, requestId, action, bodyHash, response);
        return response;
      });
      return respond(req, result);
    }

    throw new PaperHomeworkError(400, "unknown_action", "العملية المطلوبة غير معروفة.");
  } catch (error) {
    if (error instanceof PaperHomeworkError) return respond(req, { error: error.code, message: error.message }, error.status);
    console.error("paper-homework", action, error instanceof Error ? error.message : error);
    return respond(req, { error: "server_error", message: "تعذر إتمام العملية بأمان. لم نغيّر حالة التسليم." }, 500);
  }
});
