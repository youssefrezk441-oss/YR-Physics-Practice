\set ON_ERROR_STOP on
-- Current state follows PR-04 candidate within local disposable Postgres.
DO $$
DECLARE t text; action text;
BEGIN
 FOREACH t IN ARRAY ARRAY['public.attempts','public.responses'] LOOP
  FOREACH action IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
   IF has_table_privilege('authenticated',t,action)
      OR has_table_privilege('anon',t,action) THEN
    RAISE EXCEPTION 'Direct browser privilege remains: % %',action,t;
   END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated',t,'SELECT')
     OR has_table_privilege('anon',t,'SELECT') THEN
    RAISE EXCEPTION 'Incorrect SELECT grants for %',t;
  END IF;
 END LOOP;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000021',false);
DO $$
DECLARE n integer;denied integer:=0;
BEGIN
 SELECT count(*) INTO n FROM public.attempts;
 IF n<>2 THEN RAISE EXCEPTION 'Fixture should show both owned attempts: %',n; END IF;
 BEGIN
  EXECUTE 'UPDATE public.attempts SET score=999 WHERE id=''10000000-0000-4000-8000-000000000001''';
 EXCEPTION WHEN insufficient_privilege THEN denied:=denied+1;
 END;
 BEGIN
  EXECUTE 'UPDATE public.responses SET awarded_points=999 WHERE id=''20000000-0000-4000-8000-000000000001''';
 EXCEPTION WHEN insufficient_privilege THEN denied:=denied+1;
 END;
 BEGIN
  EXECUTE 'DELETE FROM public.responses WHERE id=''20000000-0000-4000-8000-000000000001''';
 EXCEPTION WHEN insufficient_privilege THEN denied:=denied+1;
 END;
 BEGIN
  EXECUTE 'INSERT INTO public.responses(id,attempt_id,question_id,awarded_points,grading_status)
   VALUES (''20000000-0000-4000-8000-000000000099'',
   ''10000000-0000-4000-8000-000000000001'',
   ''30000000-0000-4000-8000-000000000001'',999,''correct'')';
 EXCEPTION WHEN insufficient_privilege THEN denied:=denied+1;
 END;
 IF denied<>4 THEN RAISE EXCEPTION 'Direct attempt/response writes still allowed (% of 4)',4-denied; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: attempts/responses are readable under RLS but browser score writes fail' AS result;
