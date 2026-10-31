-- SECURITY PR-03 CANDIDATE ONLY. NOT AN APPLIED MIGRATION.
-- Intended for controlled TEST first. Existing RPC request/response contract is preserved.
-- This security-definer route is necessary before later removing direct
-- authenticated UPDATE rights on public.responses and public.attempts.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.short_text_grade_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  response_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  old_awarded_points numeric,
  new_awarded_points numeric NOT NULL,
  old_grading_status text,
  new_grading_status text NOT NULL,
  old_feedback text,
  new_feedback text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private.short_text_grade_audit FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE private.short_text_grade_audit_id_seq FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS short_text_grade_audit_response_time_idx
  ON private.short_text_grade_audit (response_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.review_short_text_response(
  p_response_id uuid, p_awarded_points numeric, p_feedback text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_attempt_id uuid;
  v_response public.responses%ROWTYPE;
  v_max_points numeric;
  v_awarded numeric;
  v_grading_status text;
  v_feedback text;
  v_score numeric;
  v_max_score numeric;
  v_pending integer;
  v_percentage numeric;
  v_attempt_status text;
BEGIN
  -- Role claims alone do not grant access. Use the existing database-based
  -- editing permission evaluated for the authenticated invoking identity.
  IF v_actor IS NULL OR NOT public.admin_has_access('essay_reviews','edit') THEN
    RAISE EXCEPTION 'admin_edit_required' USING ERRCODE='42501';
  END IF;
  IF p_response_id IS NULL OR p_awarded_points IS NULL
     OR p_awarded_points::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'invalid_grade' USING ERRCODE='22003';
  END IF;

  -- Lock the attempt before its response. An existing review UPDATE trigger
  -- also locks the attempt; this order avoids competing admin-review deadlocks.
  SELECT r.attempt_id INTO v_attempt_id
  FROM public.responses AS r
  JOIN public.questions AS q ON q.id=r.question_id
  WHERE r.id=p_response_id AND q.type='short_text';
  IF v_attempt_id IS NULL THEN
    RAISE EXCEPTION 'review_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT a.max_score INTO v_max_score
  FROM public.attempts AS a
  WHERE a.id=v_attempt_id AND a.submitted_at IS NOT NULL
        AND a.status IN ('submitted','graded')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attempt_not_submitted' USING ERRCODE='23514';
  END IF;

  SELECT r.* INTO v_response
  FROM public.responses AS r
  WHERE r.id=p_response_id AND r.attempt_id=v_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'review_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT q.points INTO v_max_points FROM public.questions AS q
  WHERE q.id=v_response.question_id AND q.type='short_text';
  IF v_max_points IS NULL OR v_max_points < 0 OR
     p_awarded_points < 0 OR p_awarded_points > v_max_points THEN
    RAISE EXCEPTION 'grade_out_of_range' USING ERRCODE='22003';
  END IF;

  v_awarded := round(p_awarded_points,2);
  v_grading_status := CASE WHEN v_awarded<=0 THEN 'incorrect'
                           WHEN v_awarded>=v_max_points THEN 'correct'
                           ELSE 'partial' END;
  v_feedback := coalesce(nullif(btrim(p_feedback),''),'تمت مراجعة الإجابة.');
  IF length(v_feedback)>2000 THEN
    RAISE EXCEPTION 'feedback_too_long' USING ERRCODE='22001';
  END IF;

  -- An unchanged retry is read-only and does not duplicate audit entries.
  IF v_response.awarded_points IS DISTINCT FROM v_awarded
     OR v_response.grading_status IS DISTINCT FROM v_grading_status
     OR v_response.feedback IS DISTINCT FROM v_feedback
     OR v_response.reviewed_at IS NULL THEN
    UPDATE public.responses SET
      awarded_points=v_awarded,
      grading_status=v_grading_status,
      feedback=v_feedback,
      reviewed_at=now()
    WHERE id=p_response_id;
    INSERT INTO private.short_text_grade_audit(
      response_id,attempt_id,actor_user_id,
      old_awarded_points,new_awarded_points,
      old_grading_status,new_grading_status,
      old_feedback,new_feedback
    ) VALUES (
      p_response_id,v_attempt_id,v_actor,
      v_response.awarded_points,v_awarded,
      v_response.grading_status,v_grading_status,
      v_response.feedback,v_feedback
    );
  END IF;

  SELECT coalesce(sum(r.awarded_points),0),
         count(*) FILTER (WHERE r.grading_status IN ('review','pending'))::integer
  INTO v_score,v_pending
  FROM public.responses AS r
  WHERE r.attempt_id=v_attempt_id;

  v_percentage := CASE WHEN coalesce(v_max_score,0)>0
    THEN round((v_score/v_max_score)*100,2) ELSE 0 END;
  v_attempt_status := CASE WHEN v_pending>0 THEN 'submitted' ELSE 'graded' END;

  UPDATE public.attempts
  SET score=v_score, percentage=v_percentage, status=v_attempt_status
  WHERE id=v_attempt_id;

  RETURN jsonb_build_object(
    'response_id',p_response_id,
    'grading_status',v_grading_status,
    'awarded_points',v_awarded,
    'feedback',v_feedback,
    'reviewed_at',(SELECT r.reviewed_at FROM public.responses AS r WHERE r.id=p_response_id),
    'attempt_id',v_attempt_id,
    'attempt_status',v_attempt_status,
    'score',v_score,
    'max_score',v_max_score,
    'percentage',v_percentage,
    'pending_reviews',v_pending
  );
END;
$$;
REVOKE ALL ON FUNCTION public.review_short_text_response(uuid,numeric,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_short_text_response(uuid,numeric,text)
  TO authenticated;
COMMIT;
