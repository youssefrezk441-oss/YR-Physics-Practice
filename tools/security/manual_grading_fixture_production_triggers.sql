\set ON_ERROR_STOP on
-- Reproduces the actual production scoring trigger logic found by read-only
-- pg_get_functiondef inspection on 2026-10-31. Installed ONLY into local fixture.
CREATE OR REPLACE FUNCTION private.recompute_attempt_from_responses()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private AS $$
DECLARE v_score numeric;v_pending integer;
BEGIN
 IF new.submitted_at IS NULL OR new.status NOT IN ('submitted','graded') THEN RETURN new; END IF;
 SELECT coalesce(sum(awarded_points),0),
        count(*) FILTER(WHERE grading_status IN ('review','pending'))::integer
 INTO v_score,v_pending FROM public.responses WHERE attempt_id=new.id;
 new.score:=v_score;
 new.percentage:=CASE WHEN coalesce(new.max_score,0)>0
   THEN round((v_score/new.max_score)*100,2) ELSE 0 END;
 new.status:=CASE WHEN v_pending>0 THEN 'submitted' ELSE 'graded' END;
 RETURN new;
END $$;
CREATE TRIGGER trg_recompute_attempt_from_responses
BEFORE UPDATE OF submitted_at,status,score,percentage ON public.attempts
FOR EACH ROW EXECUTE FUNCTION private.recompute_attempt_from_responses();

CREATE OR REPLACE FUNCTION private.sync_attempt_after_response_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,private,pg_catalog AS $$
DECLARE v_max_score numeric;v_score numeric;v_pending integer;
BEGIN
 SELECT a.max_score INTO v_max_score FROM public.attempts a
 WHERE a.id=new.attempt_id AND a.submitted_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN new; END IF;
 SELECT coalesce(sum(r.awarded_points),0),
  count(*) FILTER(WHERE r.grading_status IN ('review','pending'))::integer
 INTO v_score,v_pending FROM public.responses r WHERE r.attempt_id=new.attempt_id;
 UPDATE public.attempts SET score=v_score,
  percentage=CASE WHEN coalesce(v_max_score,0)>0
    THEN round((v_score/v_max_score)*100,2) ELSE 0 END,
  status=CASE WHEN v_pending>0 THEN 'submitted' ELSE 'graded' END
 WHERE id=new.attempt_id;
 RETURN new;
END $$;
CREATE TRIGGER trg_sync_attempt_after_response_review
AFTER UPDATE OF grading_status,awarded_points ON public.responses
FOR EACH ROW WHEN(
 old.grading_status IS DISTINCT FROM new.grading_status
 OR old.awarded_points IS DISTINCT FROM new.awarded_points)
EXECUTE FUNCTION private.sync_attempt_after_response_review();
