\set ON_ERROR_STOP on
-- All IDs, grades and identities here are synthetic and local only.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.admin_permissions(
 user_id uuid NOT NULL,section text NOT NULL,access_level text NOT NULL,
 PRIMARY KEY(user_id,section)
);
INSERT INTO public.admin_permissions VALUES
 ('00000000-0000-4000-8000-000000000011','essay_reviews','edit'),
 ('00000000-0000-4000-8000-000000000012','essay_reviews','view');
-- A test-only equivalent of the DB authorization gate: NOT a public user role claim.
CREATE FUNCTION public.admin_has_access(section text, needed text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.admin_permissions ap
  WHERE ap.user_id=auth.uid() AND ap.section=$1
    AND (ap.access_level='edit' OR (ap.access_level='view' AND $2='view'))
 )
$$;
REVOKE ALL ON FUNCTION public.admin_has_access(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_has_access(text,text) TO authenticated;

CREATE TABLE public.questions(
 id uuid PRIMARY KEY,type text NOT NULL,points numeric NOT NULL
);
CREATE TABLE public.attempts(
 id uuid PRIMARY KEY,user_id uuid NOT NULL,submitted_at timestamptz,
 status text NOT NULL,score numeric,max_score numeric,percentage numeric
);
CREATE TABLE public.responses(
 id uuid PRIMARY KEY,
 attempt_id uuid NOT NULL REFERENCES public.attempts(id),
 question_id uuid NOT NULL REFERENCES public.questions(id),
 awarded_points numeric,
 grading_status text NOT NULL,
 feedback text,
 reviewed_at timestamptz
);
INSERT INTO public.questions VALUES
 ('30000000-0000-4000-8000-000000000001','short_text',10),
 ('30000000-0000-4000-8000-000000000002','short_text',5);
INSERT INTO public.attempts VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000021',now(),'submitted',0,10,0),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000021',NULL,'in_progress',0,5,0);
INSERT INTO public.responses VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',0,'review',NULL,NULL),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',0,'review',NULL,NULL);

-- Relatively strict fixture: table SELECT governed by RLS; no student/admin
-- browser write grants, as future PR-04 is expected to implement.
ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_attempt_read ON public.attempts FOR SELECT TO authenticated
 USING(user_id=auth.uid() OR public.admin_has_access('essay_reviews','view'));
CREATE POLICY own_response_read ON public.responses FOR SELECT TO authenticated
 USING(EXISTS (SELECT 1 FROM public.attempts a WHERE a.id=attempt_id
   AND (a.user_id=auth.uid() OR public.admin_has_access('essay_reviews','view'))));
GRANT SELECT ON public.questions,public.attempts,public.responses TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.attempts,public.responses FROM authenticated;
