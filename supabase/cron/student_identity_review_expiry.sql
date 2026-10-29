-- Deploy separately on the approved Staging/production project after pg_cron is enabled.
-- The request-time guard remains authoritative; this job only materializes expired states promptly.
select cron.schedule(
  'student-identity-expire-pending-reviews',
  '*/5 * * * *',
  $$select private.suspend_expired_student_reviews(now());$$
);
