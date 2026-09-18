alter table private.l3_workshop_progress_backup_20260918
  add constraint l3_workshop_progress_backup_20260918_pkey
  primary key (user_id, bank_no, part_index);

alter table private.l3_workshop_events_backup_20260918
  add constraint l3_workshop_events_backup_20260918_pkey
  primary key (id);

create index l3_workshop_progress_bank_no_idx
  on public.l3_workshop_progress (bank_no);
