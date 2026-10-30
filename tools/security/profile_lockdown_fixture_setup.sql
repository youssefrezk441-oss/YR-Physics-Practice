\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA auth,public TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE public.student_profiles(
 user_id uuid PRIMARY KEY,student_code text UNIQUE NOT NULL,full_name text,grade_level text,
 is_active boolean NOT NULL,group_code text,student_phone text,guardian_phone text
);
INSERT INTO public.student_profiles(user_id,student_code,full_name,grade_level,is_active,group_code)
VALUES
('00000000-0000-4000-8000-000000000001','SYN-01','Synthetic A','grade3',true,'G1'),
('00000000-0000-4000-8000-000000000002','SYN-02','Synthetic B','grade3',true,'G2');

-- Mirror the production grants and read/write RLS, but with no personal data.
GRANT ALL PRIVILEGES ON TABLE public.student_profiles TO anon,authenticated,service_role;
ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_select ON public.student_profiles FOR SELECT TO authenticated USING (auth.uid()=user_id);
CREATE POLICY own_update ON public.student_profiles FOR UPDATE TO authenticated
 USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY admin_read ON public.student_profiles FOR SELECT TO authenticated USING (false);
