-- Sampling schedules: what was selected for testing, how, and what each test found. The method, seed, size and the selected
-- items are fixed when the schedule is made, with a fingerprint of the population so the selection can be reproduced and
-- defended. Only the test results move afterwards, and each result carries who recorded it and when.

create table sampling_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  engagement_id uuid not null,
  title text not null check (length(title) between 1 and 200),
  objective text check (objective is null or length(objective) <= 500),
  method text not null check (method in ('random', 'monetary_unit', 'top')),
  seed text not null check (length(seed) between 1 and 80),
  requested_size integer not null check (requested_size between 1 and 500),
  population_count integer not null check (population_count between 1 and 50000),
  population_total_cents bigint not null,
  population_hash text not null check (population_hash ~ '^[0-9a-f]{64}$'),
  interval_cents bigint,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, engagement_id) references engagements (tenant_id, id)
);
create index sampling_schedules_engagement on sampling_schedules (engagement_id, created_at);

create table sample_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  schedule_id uuid not null,
  position integer not null,
  ref text not null check (length(ref) between 1 and 100),
  description text not null check (length(description) <= 300),
  amount_cents bigint not null,
  reason text not null check (reason in ('random', 'interval', 'key_item', 'top')),
  result text not null default 'pending' check (result in ('pending', 'supported', 'exception', 'not_tested')),
  misstatement_cents bigint,
  note text check (note is null or length(note) <= 1000),
  evidence_item_id uuid,
  tested_by uuid references users (id),
  tested_at timestamptz,
  foreign key (tenant_id, schedule_id) references sampling_schedules (tenant_id, id) on delete cascade
);
create index sample_items_schedule on sample_items (schedule_id, position);

create function sampling_schedules_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if tg_op = 'INSERT' then
    new.created_by := app_user();
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- Once any result has been recorded the schedule is part of the file and stays.
    if exists (select 1 from sample_items where schedule_id = old.id and result <> 'pending') then
      raise exception 'schedule_in_use' using errcode = 'AO409';
    end if;
    return old;
  end if;
  raise exception 'schedule_immutable' using errcode = 'AO409';
end
$$;
create trigger sampling_schedules_guard before insert or update or delete on sampling_schedules for each row execute function sampling_schedules_guard();

create function sample_items_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if tg_op = 'INSERT' then
    new.result := 'pending'; new.misstatement_cents := null; new.note := null; new.evidence_item_id := null; new.tested_by := null; new.tested_at := null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- Only the schedule's own cascade may remove items, and the schedule guard has already allowed it.
    return old;
  end if;
  -- What was selected never changes.
  new.tenant_id := old.tenant_id; new.schedule_id := old.schedule_id; new.position := old.position;
  new.ref := old.ref; new.description := old.description; new.amount_cents := old.amount_cents; new.reason := old.reason;
  if new.result = 'exception' and (new.note is null or length(btrim(new.note)) < 5) then
    raise exception 'exception_needs_note' using errcode = 'AO422';
  end if;
  if new.result = 'exception' and new.misstatement_cents is null then
    raise exception 'exception_needs_amount' using errcode = 'AO422';
  end if;
  if new.result <> 'exception' then new.misstatement_cents := null; end if;
  if new.result = 'not_tested' and (new.note is null or length(btrim(new.note)) < 5) then
    raise exception 'not_tested_needs_note' using errcode = 'AO422';
  end if;
  if new.evidence_item_id is not null and not exists (
    select 1 from wp_items w join sampling_schedules s on s.engagement_id = w.engagement_id
     where w.id = new.evidence_item_id and s.id = old.schedule_id and w.kind = 'evidence' and w.deleted_at is null
  ) then raise exception 'invalid_evidence' using errcode = 'AO422'; end if;
  if new.result = 'pending' then new.tested_by := null; new.tested_at := null;
  else new.tested_by := app_user(); new.tested_at := now(); end if;
  return new;
end
$$;
create trigger sample_items_guard before insert or update or delete on sample_items for each row execute function sample_items_guard();

alter table sampling_schedules enable row level security;
alter table sampling_schedules force row level security;
alter table sample_items enable row level security;
alter table sample_items force row level security;

create policy sampling_select on sampling_schedules for select using (tenant_id = app_tenant() and can_view_engagement(engagement_id));
create policy sampling_insert on sampling_schedules for insert with check (tenant_id = app_tenant() and is_engagement_member(engagement_id));
create policy sampling_delete on sampling_schedules for delete using (tenant_id = app_tenant() and is_engagement_member(engagement_id));
create policy sampling_update on sampling_schedules for update using (false);

create policy sample_items_select on sample_items for select using (
  tenant_id = app_tenant() and exists (select 1 from sampling_schedules s where s.id = schedule_id and can_view_engagement(s.engagement_id))
);
create policy sample_items_insert on sample_items for insert with check (
  tenant_id = app_tenant() and exists (select 1 from sampling_schedules s where s.id = schedule_id and is_engagement_member(s.engagement_id))
);
create policy sample_items_update on sample_items for update
  using (tenant_id = app_tenant() and exists (select 1 from sampling_schedules s where s.id = schedule_id and is_engagement_member(s.engagement_id)))
  with check (tenant_id = app_tenant());
create policy sample_items_delete on sample_items for delete using (
  tenant_id = app_tenant() and exists (select 1 from sampling_schedules s where s.id = schedule_id and is_engagement_member(s.engagement_id))
);

grant select, delete on sampling_schedules, sample_items to auditos_app;
grant insert (tenant_id, engagement_id, title, objective, method, seed, requested_size, population_count, population_total_cents, population_hash, interval_cents) on sampling_schedules to auditos_app;
grant insert (tenant_id, schedule_id, position, ref, description, amount_cents, reason) on sample_items to auditos_app;
grant update (result, misstatement_cents, note, evidence_item_id) on sample_items to auditos_app;
