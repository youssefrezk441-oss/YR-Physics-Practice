-- Applied to staging and production on 2026-10-31. No keys or user records are included.
alter table private.g2_activities
 add column if not exists provisional_manual_grading boolean not null default false,
 add column if not exists provisional_live_pilot boolean not null default false;
alter table private.g2_activities drop constraint if exists g2_ready_only_publication;
alter table private.g2_activities add constraint g2_ready_only_publication check(
 status<>'published' or (
  cardinality(eligible_group_codes)>0
  and content_verified and images_verified and keys_verified
  and (rubrics_verified or provisional_manual_grading)
  and (staging_verified or provisional_live_pilot)
  and published_at is not null
 )
);
comment on column private.g2_activities.provisional_manual_grading is
 'Human essay review with a provisionally imported step-by-step rubric; not automated essay scoring.';
comment on column private.g2_activities.provisional_live_pilot is
 'Explicit admin-authorized pilot while separate staging authenticated E2E is pending.';