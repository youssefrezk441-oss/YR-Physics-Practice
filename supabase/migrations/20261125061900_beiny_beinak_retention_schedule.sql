-- Schedule only after isolated retention preview is verified and tests pass.
begin;
do $$ begin
 if not exists(select 1 from pg_extension where extname='pg_cron') then raise exception 'BY_CRON_NOT_AVAILABLE';end if;
 if exists(select 1 from cron.job where jobname='by-private-retention') then raise exception 'BY_CRON_ALREADY_EXISTS';end if;
 if (by_private.retention_preview()->>'threads_over_180_days_eligible')::bigint<>0 then raise exception 'BY_INITIAL_RETENTION_REQUIRES_REVIEW';end if;
end $$;
select cron.schedule('by-private-retention','15 3 * * *','select by_private.retention_cleanup();');
commit;
