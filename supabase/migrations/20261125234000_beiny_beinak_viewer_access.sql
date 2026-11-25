-- Explicit read-only inbox access for the approved manager account.
-- This permission is independent of academic section permissions and grants no write actions.
begin;
create table by_private.viewers (
 user_id uuid primary key references auth.users(id) on delete cascade,
 granted_by uuid not null references auth.users(id) on delete restrict,
 can_read boolean not null default true check (can_read),
 granted_at timestamptz not null default now()
);
alter table by_private.viewers enable row level security;
revoke all on by_private.viewers from public,anon,authenticated;
comment on table by_private.viewers is 'Allowlisted read-only viewers of the private Beiny Beinak inbox. No reply or management capability.';
insert into by_private.viewers(user_id,granted_by,can_read)
select a.user_id,s.teacher_user_id,true
from public.admin_profiles a
join auth.users u on u.id=a.user_id
cross join by_private.settings s
where a.user_id='75786d66-b5fe-4b1e-b317-54a731296d35'::uuid
  and a.display_name='أ/ جنى الزمر' and a.is_active and not a.is_owner
  and u.raw_app_meta_data->>'role'='admin' and s.singleton
on conflict(user_id) do update set can_read=true,granted_by=excluded.granted_by;
do $$ begin
 if not exists(select 1 from by_private.viewers v join public.admin_profiles a on a.user_id=v.user_id join auth.users u on u.id=v.user_id where v.user_id='75786d66-b5fe-4b1e-b317-54a731296d35'::uuid and a.display_name='أ/ جنى الزمر' and a.is_active and u.raw_app_meta_data->>'role'='admin') then raise exception 'BY_VIEWER_ACCOUNT_NOT_VERIFIED'; end if;
end $$;
create or replace function by_private.api(p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 actor text;
 enabled boolean;
 tid uuid;
 k uuid;
 t by_private.threads%rowtype;
 txt text;
 mode text;
 topic_value text;
 seq_value bigint;
 context_value bigint;
 n integer;
 off_value integer;
 before_value bigint;
 filter_value text;
 search_value text;
 result_value jsonb;
begin
 if uid is null then raise exception 'BY_FORBIDDEN' using errcode='42501'; end if;
 -- Read live account authorization, not editable user metadata or stale JWT roles.
 if exists(select 1 from by_private.settings s join public.admin_profiles a on a.user_id=s.teacher_user_id
  join auth.users u on u.id=a.user_id where a.user_id=uid and a.is_owner and a.is_active and u.raw_app_meta_data->>'role'='admin')
 then actor:='teacher';
 elsif exists(select 1 from by_private.viewers v join public.admin_profiles a on a.user_id=v.user_id
  join auth.users u on u.id=a.user_id where v.user_id=uid and v.can_read and a.is_active and not a.is_owner
  and u.raw_app_meta_data->>'role'='admin')
 then actor:='viewer';
 elsif exists(select 1 from public.student_profiles s join auth.users u on u.id=s.user_id
  where s.user_id=uid and s.is_active and u.raw_app_meta_data->>'role'='student')
 and not exists(select 1 from private.student_account_reviews r where r.user_id=uid and r.status<>'approved')
 then actor:='student';
 else raise exception 'BY_FORBIDDEN' using errcode='42501'; end if;
 select s.enabled into enabled from by_private.settings s where s.singleton;
 if p_action='status' then return jsonb_build_object('enabled',coalesce(enabled,false),'actor',actor); end if;
 if enabled is distinct from true then raise exception 'BY_DISABLED' using errcode='42501'; end if;
 if actor='viewer' and p_action not in ('counts','list','get') then raise exception 'BY_FORBIDDEN' using errcode='42501'; end if;

 if p_action='counts' then
  if actor in ('teacher','viewer') then
   return (select jsonb_build_object('total',count(*),
    'unread',count(*) filter(where last_student_seq>teacher_read_seq),
    'needs_reply',count(*) filter(where lifecycle='active' and last_student_seq>answered_student_seq),
    'follow_up',count(*) filter(where follow_up)) from by_private.threads);
  else
   return (select jsonb_build_object('unread',count(*) filter(where th.last_teacher_seq>th.student_read_seq))
    from by_private.threads th join by_private.owners o on o.thread_id=th.id where o.user_id=uid);
  end if;
 end if;

 if p_action='list' then
  off_value:=greatest(0,least(coalesce((p_payload->>'offset')::integer,0),100000));
  filter_value:=coalesce(p_payload->>'filter','all');
  search_value:=left(btrim(coalesce(p_payload->>'search','')),200);
  return (select coalesce(jsonb_agg(row_data order by priority desc, updated_at desc, id desc),'[]'::jsonb) from (
   select th.id, th.updated_at,
    case when actor in ('teacher','viewer') and th.lifecycle='active' and th.last_student_seq>th.answered_student_seq then 1 else 0 end as priority,
    jsonb_build_object('id',th.id,'identity_mode',th.identity_mode,'topic',th.topic,'lifecycle',th.lifecycle,
     'updated_at',th.updated_at,'preview',left((select m.body from by_private.messages m where m.thread_id=th.id order by m.seq desc limit 1),180),
     'unread',case when actor in ('teacher','viewer') then th.last_student_seq>th.teacher_read_seq else th.last_teacher_seq>th.student_read_seq end)
     || case when actor in ('teacher','viewer') then jsonb_build_object('display_name',case when th.identity_mode='named' then th.display_name end,
      'follow_up',th.follow_up,'category',th.category,'needs_reply',th.lifecycle='active' and th.last_student_seq>th.answered_student_seq) else '{}'::jsonb end as row_data
   from by_private.threads th
   where (actor='teacher' or exists(select 1 from by_private.owners o where o.thread_id=th.id and o.user_id=uid))
   and (actor='student' or filter_value='all' or (filter_value='needs_reply' and th.lifecycle='active' and th.last_student_seq>th.answered_student_seq)
    or (filter_value='unread' and th.last_student_seq>th.teacher_read_seq) or (filter_value='follow_up' and th.follow_up)
    or (filter_value='waiting' and th.lifecycle='active' and th.last_student_seq<=th.answered_student_seq)
    or (filter_value='archived' and th.lifecycle='archived') or (filter_value='restricted' and th.lifecycle='restricted'))
   and (actor='student' or search_value='' or position(lower(search_value) in th.id::text)>0
    or (th.identity_mode='named' and position(lower(search_value) in lower(th.display_name))>0)
    or exists(select 1 from by_private.messages m where m.thread_id=th.id and position(lower(search_value) in lower(m.body))>0))
   order by priority desc,th.updated_at desc,th.id desc offset off_value limit 30
  ) q);
 end if;

 if p_action in ('create','send','privacy_request') then
  k:=(p_payload->>'key')::uuid;
  if k is null then raise exception 'BY_INVALID'; end if;
 end if;
 if p_action in ('create','send') then
  txt:=regexp_replace(coalesce(p_payload->>'body',''),'^[[:space:]]+|[[:space:]]+$','','g');
  if char_length(txt) not between 1 and 3000 or octet_length(txt)>12000 then raise exception 'BY_INVALID'; end if;
 end if;
 if p_action='privacy_request' then
  if actor<>'student' or coalesce(p_payload->>'type','') not in ('delete','privacy') then raise exception 'BY_FORBIDDEN' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('by:'||uid::text,0));
  if exists(select 1 from by_private.privacy_requests pr where pr.user_id=uid and pr.request_key=k) then return jsonb_build_object('ok',true); end if;
  if (select count(*) from by_private.rate_events re where re.user_id=uid and re.event_type='privacy' and re.created_at>now()-interval '24 hours')>=3 then raise exception 'BY_RATE_LIMIT'; end if;
  insert into by_private.privacy_requests(user_id,request_type,request_key) values(uid,p_payload->>'type',k);
  insert into by_private.rate_events(user_id,event_type) values(uid,'privacy');
  return jsonb_build_object('ok',true);
 end if;

 if p_action='create' then
  if actor<>'student' then raise exception 'BY_FORBIDDEN' using errcode='42501'; end if;
  mode:=p_payload->>'identity_mode'; topic_value:=nullif(p_payload->>'topic','');
  if mode is null or mode not in ('hidden','named') or (topic_value is not null and topic_value not in ('suggestion','teaching','concern','difficulty','thanks','other')) then raise exception 'BY_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('by:'||uid::text,0));
  select o.thread_id into tid from by_private.owners o where o.user_id=uid and o.creation_key=k;
  if found then return jsonb_build_object('id',tid); end if;
  if (select count(*) from by_private.rate_events re where re.user_id=uid and re.event_type='create' and re.created_at>now()-interval '24 hours')>=3 then raise exception 'BY_RATE_LIMIT'; end if;
  insert into by_private.threads(identity_mode,display_name,topic,last_seq,last_student_seq)
   values(mode,case when mode='named' then (select s.full_name from public.student_profiles s where s.user_id=uid) end,topic_value,1,1)
   returning id into tid;
  insert into by_private.owners(thread_id,user_id,creation_key) values(tid,uid,k);
  insert into by_private.messages(thread_id,seq,sender_role,body,request_key) values(tid,1,'student',txt,k);
  insert into by_private.rate_events(user_id,event_type) values(uid,'create');
  return jsonb_build_object('id',tid);
 end if;

 if p_action not in ('get','mark','send','state','follow','category') then raise exception 'BY_INVALID'; end if;
 tid:=(p_payload->>'id')::uuid;
 -- Acquire per-student lock before thread lock, including rate checks across threads.
 if actor='student' and p_action='send' then perform pg_advisory_xact_lock(hashtextextended('by:'||uid::text,0)); end if;
 select th.* into t from by_private.threads th where th.id=tid and
  (actor='teacher' or exists(select 1 from by_private.owners o where o.thread_id=th.id and o.user_id=uid)) for update;
 if not found then raise exception 'BY_FORBIDDEN' using errcode='42501'; end if;

 if p_action='get' then
  before_value:=coalesce((p_payload->>'before')::bigint,9223372036854775807);
  select coalesce(jsonb_agg(jsonb_build_object('seq',m.seq,'sender_role',m.sender_role,'body',m.body,'created_at',m.created_at) order by m.seq),'[]'::jsonb)
  into result_value from (select seq,sender_role,body,created_at from by_private.messages where thread_id=tid and seq<before_value order by seq desc limit 50) m;
  return jsonb_build_object('id',t.id,'identity_mode',t.identity_mode,'topic',t.topic,'lifecycle',t.lifecycle,'messages',result_value)
   || case when actor in ('teacher','viewer') then jsonb_build_object('display_name',case when t.identity_mode='named' then t.display_name end,
    'follow_up',t.follow_up,'category',t.category,'needs_reply',t.lifecycle='active' and t.last_student_seq>t.answered_student_seq) else '{}'::jsonb end;
 end if;

 if p_action='mark' then
  seq_value:=coalesce((p_payload->>'seq')::bigint,0);
  if seq_value<1 then return jsonb_build_object('ok',true); end if;
  if actor='teacher' then
   if not exists(select 1 from by_private.messages where thread_id=tid and seq=seq_value and sender_role='student') then raise exception 'BY_INVALID'; end if;
   update by_private.threads set teacher_read_seq=greatest(teacher_read_seq,seq_value) where id=tid;
  else
   if not exists(select 1 from by_private.messages where thread_id=tid and seq=seq_value and sender_role='teacher') then raise exception 'BY_INVALID'; end if;
   update by_private.threads set student_read_seq=greatest(student_read_seq,seq_value) where id=tid;
  end if;
  return jsonb_build_object('ok',true);
 end if;

 if p_action='send' then
  select m.seq into seq_value from by_private.messages m where m.thread_id=tid and m.sender_role=actor and m.request_key=k;
  if found then return jsonb_build_object('id',tid,'seq',seq_value); end if;
  if t.lifecycle='restricted' then raise exception 'BY_RESTRICTED'; end if;
  if actor='student' then
   if (select count(*) from by_private.rate_events re where re.user_id=uid and re.event_type='send' and re.created_at>now()-interval '1 minute')>=10
   or (select count(*) from by_private.rate_events re where re.user_id=uid and re.event_type='send' and re.created_at>now()-interval '24 hours')>=50
   then raise exception 'BY_RATE_LIMIT'; end if;
   insert into by_private.rate_events(user_id,event_type) values(uid,'send');
  else
   context_value:=coalesce((p_payload->>'context_seq')::bigint,0);
   if context_value<1 or not exists(select 1 from by_private.messages where thread_id=tid and seq=context_value and sender_role='student') then raise exception 'BY_INVALID'; end if;
  end if;
  seq_value:=t.last_seq+1;
  insert into by_private.messages(thread_id,seq,sender_role,body,request_key) values(tid,seq_value,actor,txt,k);
  if actor='student' then
   update by_private.threads set last_seq=seq_value,last_student_seq=seq_value,updated_at=now(),lifecycle='active' where id=tid;
  else
   update by_private.threads set last_seq=seq_value,last_teacher_seq=seq_value,answered_student_seq=greatest(answered_student_seq,context_value),
     teacher_read_seq=greatest(teacher_read_seq,context_value),updated_at=now() where id=tid;
  end if;
  return jsonb_build_object('id',tid,'seq',seq_value);
 end if;

 if actor<>'teacher' then raise exception 'BY_FORBIDDEN' using errcode='42501'; end if;
 if p_action='state' then
  mode:=p_payload->>'lifecycle';
  if mode is null or mode not in ('active','archived','restricted') or (t.lifecycle='restricted' and mode='archived') then raise exception 'BY_INVALID'; end if;
  txt:=nullif(btrim(p_payload->>'reason'),'');
  if mode='restricted' and (txt is null or char_length(txt)>500) then raise exception 'BY_INVALID'; end if;
  update by_private.threads set lifecycle=mode where id=tid;
  insert into by_private.admin_actions(thread_id,action,reason) values(tid,mode,case when mode='restricted' then txt end);
 elsif p_action='follow' then
  if jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception 'BY_INVALID'; end if;
  update by_private.threads set follow_up=(p_payload->>'enabled')::boolean where id=tid;
  insert into by_private.admin_actions(thread_id,action) values(tid,'follow');
 elsif p_action='category' then
  topic_value:=nullif(p_payload->>'category','');
  if topic_value is not null and topic_value not in ('suggestion','teaching','concern','difficulty','thanks','other') then raise exception 'BY_INVALID'; end if;
  update by_private.threads set category=topic_value where id=tid;
  insert into by_private.admin_actions(thread_id,action) values(tid,'category');
 end if;
 return jsonb_build_object('ok',true);
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'BY_INVALID';
end
$$;
commit;
