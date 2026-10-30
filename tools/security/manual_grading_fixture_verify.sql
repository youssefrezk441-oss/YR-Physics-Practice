\set ON_ERROR_STOP on
-- The candidate RPC is already installed in this disposable DB.
DO $$
BEGIN
 IF NOT has_function_privilege('authenticated','public.review_short_text_response(uuid,numeric,text)','EXECUTE')
 OR has_function_privilege('anon','public.review_short_text_response(uuid,numeric,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Invalid RPC EXECUTE privileges'; END IF;
 IF has_table_privilege('authenticated','public.responses','UPDATE')
 OR has_table_privilege('authenticated','public.attempts','UPDATE')
 THEN RAISE EXCEPTION 'Direct browser grade write unexpectedly allowed'; END IF;
END $$;

-- A normal student cannot invoke the privileged grading function.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000021',false);
DO $$
BEGIN
 BEGIN
  PERFORM public.review_short_text_response(
   '20000000-0000-4000-8000-000000000001',10,'wrong role');
  RAISE EXCEPTION 'UNEXPECTED: student graded an essay';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;

-- View-only admin must also be rejected even when they can SELECT essays.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',false);
DO $$
BEGIN
 BEGIN
  PERFORM public.review_short_text_response(
   '20000000-0000-4000-8000-000000000001',10,'view only');
  RAISE EXCEPTION 'UNEXPECTED: view-only admin graded an essay';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;

-- An editor cannot exceed question points or review an unfinished attempt.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',false);
DO $$
BEGIN
 BEGIN
  PERFORM public.review_short_text_response(
   '20000000-0000-4000-8000-000000000001',100,'out of range');
  RAISE EXCEPTION 'UNEXPECTED: exceeded maximum question points';
 EXCEPTION WHEN SQLSTATE '22003' THEN NULL;
 END;
 BEGIN
  PERFORM public.review_short_text_response(
   '20000000-0000-4000-8000-000000000002',3,'unfinished attempt');
  RAISE EXCEPTION 'UNEXPECTED: graded an unfinished attempt';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;

-- Same JSON interface as existing admin pages. No browser table write privilege.
DO $$
DECLARE result jsonb;
BEGIN
 result:=public.review_short_text_response(
  '20000000-0000-4000-8000-000000000001',7,'verified synthetic rubric');
 IF (result->>'score')::numeric<>7
 OR (result->>'max_score')::numeric<>10
 OR (result->>'percentage')::numeric<>70
 OR result->>'grading_status'<>'partial'
 OR result->>'attempt_status'<>'graded'
 OR (result->>'pending_reviews')::integer<>0 THEN
  RAISE EXCEPTION 'Admin RPC produced incorrect result: %',result;
 END IF;
END $$;
RESET ROLE;

-- Single audited event, signed with actual invoking admin UID from the request.
DO $$
BEGIN
 IF (SELECT count(*) FROM private.short_text_grade_audit)<>1
 OR NOT EXISTS(SELECT 1 FROM private.short_text_grade_audit
   WHERE actor_user_id='00000000-0000-4000-8000-000000000011'
   AND old_awarded_points=0 AND new_awarded_points=7)
 THEN RAISE EXCEPTION 'Grade-change audit missing or wrong actor'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.attempts
   WHERE id='10000000-0000-4000-8000-000000000001'
     AND score=7 AND percentage=70 AND status='graded')
 THEN RAISE EXCEPTION 'Score recomputation failed'; END IF;
END $$;

-- An unchanged retry should not create a second audit or mutate reviewed_at.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',false);
SELECT public.review_short_text_response(
 '20000000-0000-4000-8000-000000000001',7,'verified synthetic rubric');
RESET ROLE;
DO $$
BEGIN
 IF (SELECT count(*) FROM private.short_text_grade_audit)<>1
 THEN RAISE EXCEPTION 'Identical retry wrote another audit record'; END IF;
END $$;

-- A changed grade causes one more event and recomputes the score.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',false);
SELECT public.review_short_text_response(
 '20000000-0000-4000-8000-000000000001',10,'changed after new rubric review');
RESET ROLE;
DO $$
BEGIN
 IF (SELECT count(*) FROM private.short_text_grade_audit)<>2
 OR NOT EXISTS(SELECT 1 FROM public.attempts
  WHERE id='10000000-0000-4000-8000-000000000001'
    AND score=10 AND percentage=100 AND status='graded')
 THEN RAISE EXCEPTION 'Changed grading result/audit incorrect'; END IF;
END $$;
SELECT 'PASS: admin edit only, range/attempt checks, audited/idempotent and compatible JSON, no direct browser writes' AS result;
