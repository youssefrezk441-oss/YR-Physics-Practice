-- Isolated retention operations. Never touch academic records or existing schemas.
begin;
create table by_private.retention_holds (
 thread_id uuid primary key references by_private.threads(id) on delete cascade,
 reason_code text not null check(reason_code in ('safeguarding','legal','privacy_dispute')),
 review_at timestamptz not null,
 created_at timestamptz not null default now()
);
alter table by_private.retention_holds enable row level security;
revoke all on by_private.retention_holds from public,anon,authenticated;

create or replace function by_private.retention_preview()
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object(
  'threads_over_180_days_eligible',count(*) filter(where th.updated_at<now()-interval '180 days' and th.lifecycle<>'restricted' and not th.follow_up
   and not exists(select 1 from by_private.retention_holds h where h.thread_id=th.id)
   and not exists(select 1 from by_private.privacy_requests pr where pr.user_id=o.user_id and pr.resolved_at is null)),
  'threads_held',count(*) filter(where th.lifecycle='restricted' or th.follow_up
   or exists(select 1 from by_private.retention_holds h where h.thread_id=th.id)
   or exists(select 1 from by_private.privacy_requests pr where pr.user_id=o.user_id and pr.resolved_at is null)),
  'rate_events_over_48_hours',(select count(*) from by_private.rate_events where created_at<now()-interval '48 hours'),
  'resolved_requests_over_180_days',(select count(*) from by_private.privacy_requests where resolved_at<now()-interval '180 days'))
 from by_private.threads th join by_private.owners o on o.thread_id=th.id
$$;
revoke all on function by_private.retention_preview() from public,anon,authenticated;

create function by_private.retention_cleanup()
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c record; removed integer:=0; affected integer; rate_removed integer; requests_removed integer;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('by:retention',0)) then return jsonb_build_object('skipped',true);end if;
 -- Bounded batch, lock per owner before deletion to serialize with student writes and requests.
 for c in select th.id,o.user_id from by_private.threads th join by_private.owners o on o.thread_id=th.id
  where th.updated_at<now()-interval '180 days' and th.lifecycle<>'restricted' and not th.follow_up
  and not exists(select 1 from by_private.retention_holds h where h.thread_id=th.id)
  and not exists(select 1 from by_private.privacy_requests pr where pr.user_id=o.user_id and pr.resolved_at is null)
  order by th.updated_at limit 250
 loop
  if not pg_try_advisory_xact_lock(hashtextextended('by:'||c.user_id::text,0)) then continue;end if;
  delete from by_private.threads th where th.id=c.id
   and th.updated_at<now()-interval '180 days' and th.lifecycle<>'restricted' and not th.follow_up
   and not exists(select 1 from by_private.retention_holds h where h.thread_id=th.id)
   and not exists(select 1 from by_private.privacy_requests pr where pr.user_id=c.user_id and pr.resolved_at is null);
  get diagnostics affected=row_count;removed:=removed+affected;
 end loop;
 delete from by_private.rate_events where created_at<now()-interval '48 hours';
 get diagnostics rate_removed=row_count;
 delete from by_private.privacy_requests where resolved_at<now()-interval '180 days';
 get diagnostics requests_removed=row_count;
 return jsonb_build_object('threads_deleted',removed,'rate_events_deleted',rate_removed,'resolved_requests_deleted',requests_removed);
end
$$;
revoke all on function by_private.retention_cleanup() from public,anon,authenticated;
commit;
