-- The pipeline: prospects owned by a named person, from first contact until they become a client or are lost.
-- Every change goes through a function that also writes a plain-English audit event, so the app role can only read.

create table prospects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  name text not null check (length(name) between 2 and 200),
  sector text check (sector is null or sector in ('trading','consultancy','rental','farming','pension','investment')),
  contact_name text check (contact_name is null or length(contact_name) <= 120),
  source text check (source is null or length(source) <= 120),
  owner_id uuid not null references users (id),
  stage text not null default 'lead' check (stage in ('lead','proposal','loe_sent','won','lost')),
  expected_fee_cents bigint check (expected_fee_cents is null or expected_fee_cents >= 0),
  expected_start date,
  notes text check (notes is null or length(notes) <= 4000),
  lost_reason text check (lost_reason is null or length(lost_reason) <= 500),
  client_id uuid,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, client_id) references clients (tenant_id, id),
  check ((stage = 'won') = (client_id is not null))
);
create index prospects_owner on prospects (tenant_id, owner_id);
create index prospects_stage on prospects (tenant_id, stage);

-- Partners and managers see the whole pipeline; everyone else sees the prospects they own.
create function sees_all_prospects() returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select exists (
    select 1 from memberships
     where tenant_id = app_tenant() and user_id = app_user() and active and role in ('partner', 'manager')
  )
$$;
revoke all on function sees_all_prospects() from public;
grant execute on function sees_all_prospects() to auditos_app;

alter table prospects enable row level security;
alter table prospects force row level security;
create policy prospects_select on prospects for select
  using (tenant_id = app_tenant() and (owner_id = app_user() or sees_all_prospects()));
grant select on prospects to auditos_app;
-- Writes happen inside the functions below, which run as the table owner; row-level security still applies to them,
-- so these policies are what lets them write. The application role itself holds no write grant.
create policy prospects_insert on prospects for insert with check (tenant_id = app_tenant());
create policy prospects_update on prospects for update
  using (tenant_id = app_tenant() and (owner_id = app_user() or sees_all_prospects())) with check (tenant_id = app_tenant());

-- The caller's role, or null when they are not an active member of the firm.
create function caller_role() returns text
language sql stable security definer set search_path = public, pg_temp as
$$ select role from memberships where tenant_id = app_tenant() and user_id = app_user() and active $$;
revoke all on function caller_role() from public;
grant execute on function caller_role() to auditos_app;

create function person_name(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as
$$ select coalesce(u.full_name, u.email) from users u where u.id = p_user $$;
revoke all on function person_name(uuid) from public;

-- Someone who can own a prospect: an active partner, manager, senior or member of staff.
create function prospect_owner_valid(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select exists (
    select 1 from memberships m join users u on u.id = m.user_id
     where m.tenant_id = app_tenant() and m.user_id = p_user and m.active and u.active and m.role in ('partner', 'manager', 'senior', 'staff')
  )
$$;
revoke all on function prospect_owner_valid(uuid) from public;
grant execute on function prospect_owner_valid(uuid) to auditos_app;

create function prospect_create(
  p_name text, p_sector text, p_contact text, p_source text, p_owner uuid, p_fee_cents bigint, p_start date, p_notes text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as
$$
declare v uuid := gen_random_uuid(); role text := caller_role();
begin
  if role is null or role not in ('partner', 'manager', 'senior', 'staff') then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if p_owner <> app_user() and role not in ('partner', 'manager') then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if not prospect_owner_valid(p_owner) then raise exception 'invalid_owner' using errcode = 'AO422'; end if;
  insert into prospects (id, tenant_id, name, sector, contact_name, source, owner_id, expected_fee_cents, expected_start, notes, created_by)
  values (v, app_tenant(), trim(p_name), p_sector, nullif(trim(p_contact), ''), nullif(trim(p_source), ''), p_owner, p_fee_cents, p_start, nullif(trim(p_notes), ''), app_user());
  perform audit_append_internal(app_tenant(), app_user(), 'prospect.created', 'prospect', v::text,
    jsonb_build_object('prospectName', trim(p_name), 'ownerName', person_name(p_owner)));
  return v;
end
$$;

create function prospect_update(
  p_id uuid, p_name text, p_sector text, p_contact text, p_source text, p_fee_cents bigint, p_start date, p_notes text
) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare pr prospects%rowtype;
begin
  select * into pr from prospects where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if pr.stage in ('won', 'lost') then raise exception 'prospect_closed' using errcode = 'AO409'; end if;
  update prospects set name = trim(p_name), sector = p_sector, contact_name = nullif(trim(p_contact), ''), source = nullif(trim(p_source), ''),
         expected_fee_cents = p_fee_cents, expected_start = p_start, notes = nullif(trim(p_notes), ''), updated_at = now()
   where id = p_id;
  perform audit_append_internal(app_tenant(), app_user(), 'prospect.edited', 'prospect', p_id::text, jsonb_build_object('prospectName', trim(p_name)));
end
$$;

-- Moves a prospect along the pipeline. Winning happens only through conversion to a client.
create function prospect_set_stage(p_id uuid, p_stage text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare pr prospects%rowtype;
begin
  select * into pr from prospects where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if pr.stage in ('won', 'lost') then raise exception 'prospect_closed' using errcode = 'AO409'; end if;
  if p_stage not in ('lead', 'proposal', 'loe_sent', 'lost') then raise exception 'invalid_stage' using errcode = 'AO422'; end if;
  if p_stage = 'lost' and length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required' using errcode = 'AO422'; end if;
  update prospects set stage = p_stage, lost_reason = case when p_stage = 'lost' then trim(p_reason) else null end, updated_at = now() where id = p_id;
  perform audit_append_internal(app_tenant(), app_user(), 'prospect.stage_changed', 'prospect', p_id::text,
    jsonb_build_object('prospectName', pr.name, 'from', pr.stage, 'to', p_stage, 'reason', nullif(trim(coalesce(p_reason, '')), '')));
end
$$;

-- Hands a prospect to another person. Partners and managers only, with a reason.
create function prospect_reassign(p_id uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare pr prospects%rowtype;
begin
  if coalesce(caller_role(), '') not in ('partner', 'manager') then raise exception 'forbidden' using errcode = 'AO403'; end if;
  select * into pr from prospects where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if pr.stage in ('won', 'lost') then raise exception 'prospect_closed' using errcode = 'AO409'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required' using errcode = 'AO422'; end if;
  if not prospect_owner_valid(p_user) then raise exception 'invalid_owner' using errcode = 'AO422'; end if;
  update prospects set owner_id = p_user, updated_at = now() where id = p_id;
  perform audit_append_internal(app_tenant(), app_user(), 'prospect.reassigned', 'prospect', p_id::text,
    jsonb_build_object('prospectName', pr.name, 'from', person_name(pr.owner_id), 'to', person_name(p_user), 'reason', trim(p_reason)));
end
$$;

-- Marks a prospect as won once its client exists. A prospect becomes a client only once.
create function prospect_mark_won(p_id uuid, p_client uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare pr prospects%rowtype;
begin
  select * into pr from prospects where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if pr.stage in ('won', 'lost') or pr.client_id is not null then raise exception 'prospect_closed' using errcode = 'AO409'; end if;
  update prospects set stage = 'won', client_id = p_client, lost_reason = null, updated_at = now() where id = p_id;
  perform audit_append_internal(app_tenant(), app_user(), 'prospect.won', 'prospect', p_id::text,
    jsonb_build_object('prospectName', pr.name, 'clientId', p_client));
end
$$;

revoke all on function prospect_create(text, text, text, text, uuid, bigint, date, text), prospect_update(uuid, text, text, text, text, bigint, date, text),
  prospect_set_stage(uuid, text, text), prospect_reassign(uuid, uuid, text), prospect_mark_won(uuid, uuid) from public;
grant execute on function prospect_create(text, text, text, text, uuid, bigint, date, text), prospect_update(uuid, text, text, text, text, bigint, date, text),
  prospect_set_stage(uuid, text, text), prospect_reassign(uuid, uuid, text), prospect_mark_won(uuid, uuid) to auditos_app;
