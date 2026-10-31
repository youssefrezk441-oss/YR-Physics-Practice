-- Additive, previously applied to staging and production.
alter table public.student_groups add column if not exists education_track text;
alter table public.student_groups drop constraint if exists g2_group_education_track_values;
alter table public.student_groups add constraint g2_group_education_track_values
  check(education_track is null or education_track in ('azhar','baccalaureate'));
update public.student_groups set education_track='baccalaureate'
where group_code in ('N2-A','K2-A') and grade_level='الصف الثاني الثانوي';
update public.student_groups set education_track='azhar'
where group_code in ('N2-B','K2-B') and grade_level='الصف الثاني الثانوي';
