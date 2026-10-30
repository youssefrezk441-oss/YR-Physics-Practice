\set ON_ERROR_STOP on

-- SYNTHETIC ONLY. Creates disposable local fixtures; no production identifier is used.
CREATE SCHEMA auth;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
GRANT USAGE ON SCHEMA auth,public TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.student_profiles(
  user_id uuid PRIMARY KEY,student_code text,group_code text,grade_level text,
  is_active boolean DEFAULT false
);
CREATE TABLE public.attempts(
  id uuid PRIMARY KEY,user_id uuid REFERENCES public.student_profiles(user_id),
  status text DEFAULT 'in_progress',max_score numeric,score numeric,percentage numeric
);
CREATE TABLE public.responses(
  id uuid PRIMARY KEY,attempt_id uuid REFERENCES public.attempts(id),
  awarded_points numeric,grading_status text DEFAULT 'pending'
);
INSERT INTO public.student_profiles(user_id,student_code,group_code,grade_level,is_active) VALUES
('00000000-0000-4000-8000-000000000001','SYN-A','G-A','grade3',false),
('00000000-0000-4000-8000-000000000002','SYN-B','G-B','grade3',true);
INSERT INTO public.attempts(id,user_id,status,max_score,score,percentage) VALUES
('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','in_progress',10,0,0),
('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','in_progress',10,0,0);
INSERT INTO public.responses(id,attempt_id,awarded_points,grading_status) VALUES
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',0,'pending'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',0,'pending');

-- Baseline grants and own-row policies reproduce the risky AUTHORIZATION shape
-- observed in the actual production catalog. No production schema is copied.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.student_profiles,public.attempts,public.responses TO authenticated;
ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_profile_read ON public.student_profiles FOR SELECT TO authenticated USING(auth.uid()=user_id);
CREATE POLICY own_profile_update ON public.student_profiles FOR UPDATE TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
CREATE POLICY own_attempt_read ON public.attempts FOR SELECT TO authenticated USING(auth.uid()=user_id);
CREATE POLICY own_attempt_update ON public.attempts FOR UPDATE TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
CREATE POLICY own_response_read ON public.responses FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM public.attempts a WHERE a.id=attempt_id AND a.user_id=auth.uid()));
CREATE POLICY own_response_update ON public.responses FOR UPDATE TO authenticated
  USING(EXISTS(SELECT 1 FROM public.attempts a WHERE a.id=attempt_id AND a.user_id=auth.uid()))
  WITH CHECK(EXISTS(SELECT 1 FROM public.attempts a WHERE a.id=attempt_id AND a.user_id=auth.uid()));

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);

-- Vulnerable baseline (EXPECTED TO SUCCEED): owner can edit sensitive attributes.
UPDATE public.student_profiles SET is_active=true,group_code='G-B'
  WHERE user_id=auth.uid();
UPDATE public.attempts SET max_score=999,score=999,percentage=100,status='graded'
  WHERE user_id=auth.uid();
UPDATE public.responses SET awarded_points=999,grading_status='correct'
  WHERE id='20000000-0000-4000-8000-000000000001';
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id=auth.uid() AND is_active AND group_code='G-B')
   OR NOT EXISTS(SELECT 1 FROM public.attempts WHERE user_id=auth.uid() AND score=999 AND max_score=999)
   OR NOT EXISTS(SELECT 1 FROM public.responses WHERE id='20000000-0000-4000-8000-000000000001' AND awarded_points=999) THEN
   RAISE EXCEPTION 'Baseline did not reproduce vulnerable own-row write capabilities';
 END IF;
END $$;

-- Still cannot alter somebody else's row via RLS; avoids confusing IDOR with self-tampering.
DO $$
DECLARE n bigint;
BEGIN
 UPDATE public.attempts SET score=100 WHERE id='10000000-0000-4000-8000-000000000002';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Fixture unexpectedly permits cross-user attempts write'; END IF;
END $$;
RESET ROLE;

-- Target boundary: illustrative least privilege; exact migration follows in PR-02/04.
REVOKE UPDATE,INSERT,DELETE ON public.student_profiles,public.attempts,public.responses FROM authenticated;
SET ROLE authenticated;
DO $$
DECLARE denied integer:=0;
BEGIN
 BEGIN
   EXECUTE 'UPDATE public.student_profiles SET is_active=false WHERE user_id=auth.uid()';
 EXCEPTION WHEN insufficient_privilege THEN denied:=denied+1;
 END;
 BEGIN
   EXECUTE 'UPDATE public.attempts SET score=0 WHERE user_id=auth.uid()';
 EXCEPTION WHEN insufficient_privilege THEN denied:=denied+1;
 END;
 BEGIN
   EXECUTE 'UPDATE public.responses SET awarded_points=0 WHERE id=''20000000-0000-4000-8000-000000000001''';
 EXCEPTION WHEN insufficient_privilege THEN denied:=denied+1;
 END;
 IF denied<>3 THEN
   RAISE EXCEPTION 'Hardened fixture still permits % of 3 direct writes',3-denied;
 END IF;
END $$;
RESET ROLE;

SELECT 'PASS: current exposure demonstrated, other-student RLS preserved, and proposed direct-write deny boundary tested' AS synthetic_result;
