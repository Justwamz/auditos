-- Document control: working paper items, versions, sign-offs, deletion approvals, unlock.
-- Business rules live here (triggers + SECURITY DEFINER functions) so a bug or bypass in the
-- API cannot silently weaken them.

-- session_load now reports step-up age in database time.
drop function session_load(text, integer);
create function session_load(p_token_hash text, p_idle_minutes integer)
returns table (session_id uuid, user_id uuid, tenant_id uuid, stepup_age_seconds double precision, role text, grade integer, membership_active boolean)
language plpgsql security definer set search_path = public, pg_temp as
$$
declare s sessions%rowtype;
begin
  select * into s from sessions
   where token_hash = p_token_hash and revoked_at is null and expires_at > now()
     and last_seen_at > now() - make_interval(mins => p_idle_minutes)
     and exists (select 1 from users u where u.id = sessions.user_id and u.active);
  if not found then return; end if;
  update sessions set last_seen_at = now() where id = s.id;
  perform set_config('app.user_id', s.user_id::text, true);
  perform set_config('app.tenant_id', coalesce(s.tenant_id::text, ''), true);
  return query
    select s.id, s.user_id, s.tenant_id,
           case when s.stepup_at is null then null else extract(epoch from (now() - s.stepup_at))::double precision end,
           m.role, m.grade, m.active
    from (select 1) one
    left join memberships m on m.tenant_id = s.tenant_id and m.user_id = s.user_id;
end
$$;
revoke all on function session_load(text, integer) from public;
grant execute on function session_load(text, integer) to auditos_app;

alter table engagements add column unlocked_until timestamptz;

create function wp_hash(p_title text, p_content jsonb) returns text language sql immutable as
$$ select encode(digest(convert_to(jsonb_build_object('title', p_title, 'content', p_content)::text, 'UTF8'), 'sha256'), 'hex') $$;

create table wp_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  engagement_id uuid not null,
  kind text not null check (length(kind) between 1 and 60),
  title text not null check (length(title) between 1 and 300),
  content jsonb not null default '{}'::jsonb,
  state text not null default 'draft' check (state in ('draft','prepared','manager_reviewed','partner_approved')),
  version integer not null default 1,
  content_hash text not null default '',
  addendum_of uuid references wp_items (id),
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_reason text,
  unique (tenant_id, id),
  foreign key (tenant_id, engagement_id) references engagements (tenant_id, id)
);
create index wp_items_engagement on wp_items (engagement_id, kind);

create table wp_item_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  item_id uuid not null references wp_items (id),
  version integer not null,
  title text not null,
  content jsonb not null,
  content_hash text not null,
  edited_by uuid references users (id),
  edited_at timestamptz not null default now(),
  reason text,
  unique (item_id, version)
);

create table signoffs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  item_id uuid not null references wp_items (id),
  level text not null check (level in ('prepared','manager','partner')),
  user_id uuid not null references users (id),
  version integer not null,
  content_hash text not null,
  at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text
);
create index signoffs_item on signoffs (item_id);

create table deletion_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  item_id uuid not null references wp_items (id),
  requested_by uuid not null references users (id),
  approved_by uuid references users (id),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','executed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index deletion_requests_one_pending on deletion_requests (item_id) where status = 'pending';

create table unlock_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  engagement_id uuid not null,
  requested_by uuid not null references users (id),
  approved_by uuid references users (id),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (tenant_id, engagement_id) references engagements (tenant_id, id)
);
create unique index unlock_requests_one_pending on unlock_requests (engagement_id) where status = 'pending';

-- Row-level security: items are visible to members of their engagement.
create function is_engagement_member(p_engagement uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from engagement_members where engagement_id = p_engagement and user_id = app_user() and tenant_id = app_tenant()) $$;

alter table wp_items enable row level security;
alter table wp_items force row level security;
create policy wp_items_select on wp_items for select using (tenant_id = app_tenant() and is_engagement_member(engagement_id));
create policy wp_items_insert on wp_items for insert with check (tenant_id = app_tenant() and is_engagement_member(engagement_id));
create policy wp_items_update on wp_items for update using (tenant_id = app_tenant() and is_engagement_member(engagement_id)) with check (tenant_id = app_tenant());
grant select, insert, update (title, content) on wp_items to auditos_app;

alter table wp_item_versions enable row level security;
alter table wp_item_versions force row level security;
create policy wp_item_versions_select on wp_item_versions for select
  using (tenant_id = app_tenant() and exists (select 1 from wp_items i where i.id = wp_item_versions.item_id));
create policy wp_item_versions_write on wp_item_versions for insert with check (tenant_id = app_tenant());
grant select on wp_item_versions to auditos_app;

alter table signoffs enable row level security;
alter table signoffs force row level security;
create policy signoffs_select on signoffs for select
  using (tenant_id = app_tenant() and exists (select 1 from wp_items i where i.id = signoffs.item_id));
create policy signoffs_write on signoffs for insert with check (tenant_id = app_tenant());
create policy signoffs_revoke on signoffs for update using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select on signoffs to auditos_app;

alter table deletion_requests enable row level security;
alter table deletion_requests force row level security;
create policy deletion_requests_select on deletion_requests for select
  using (tenant_id = app_tenant() and exists (select 1 from wp_items i where i.id = deletion_requests.item_id));
create policy deletion_requests_write on deletion_requests for insert with check (tenant_id = app_tenant());
create policy deletion_requests_update on deletion_requests for update using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select on deletion_requests to auditos_app;

alter table unlock_requests enable row level security;
alter table unlock_requests force row level security;
create policy unlock_requests_select on unlock_requests for select using (tenant_id = app_tenant() and is_engagement_member(engagement_id));
create policy unlock_requests_write on unlock_requests for insert with check (tenant_id = app_tenant());
create policy unlock_requests_update on unlock_requests for update using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select on unlock_requests to auditos_app;

create function engagement_is_locked(p_engagement uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$ select coalesce((select state = 'locked' from engagements where id = p_engagement), false) $$;

-- Guard: versioning, revoke-on-edit, immutability and the lock, whatever path touches the table.
create function wp_items_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as
$$
declare reason text := nullif(current_setting('app.edit_reason', true), '');
begin
  if tg_op = 'INSERT' then
    if engagement_is_locked(new.engagement_id) and new.addendum_of is null then
      raise exception 'engagement is locked' using errcode = 'AO409';
    end if;
    new.version := 1;
    new.state := 'draft';
    new.deleted_at := null;
    new.deleted_reason := null;
    new.created_by := coalesce(new.created_by, app_user());
    new.content_hash := wp_hash(new.title, new.content);
    return new;
  end if;

  if engagement_is_locked(old.engagement_id) then
    raise exception 'engagement is locked' using errcode = 'AO409';
  end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.engagement_id <> old.engagement_id
     or new.kind <> old.kind or new.created_by <> old.created_by or new.addendum_of is distinct from old.addendum_of then
    raise exception 'immutable column changed' using errcode = 'AO403';
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    if coalesce(current_setting('app.deleting', true), '') <> 'on' then
      raise exception 'items are deleted only through the deletion procedure' using errcode = 'AO403';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if new.title is distinct from old.title or new.content is distinct from old.content then
    if old.deleted_at is not null then
      raise exception 'item_deleted' using errcode = 'AO409';
    end if;
    if old.state = 'partner_approved' and reason is null then
      raise exception 'reason_required' using errcode = 'AO422';
    end if;
    new.version := old.version + 1;
    new.content_hash := wp_hash(new.title, new.content);
    new.updated_at := now();
    if old.state in ('manager_reviewed', 'partner_approved') then
      new.state := 'prepared';
      update signoffs set revoked_at = now(), revoked_reason = coalesce(reason, 'content edited')
       where item_id = old.id and revoked_at is null and level in ('manager', 'partner');
    end if;
    return new;
  end if;

  if new.state is distinct from old.state then
    if coalesce(current_setting('app.signoff', true), '') <> 'on' then
      raise exception 'state changes only through sign-off' using errcode = 'AO403';
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;
create trigger wp_items_guard before insert or update on wp_items for each row execute function wp_items_guard();

create function wp_items_no_delete() returns trigger language plpgsql as
$$
begin
  if coalesce(current_setting('app.purge', true), '') = 'on' and current_user = 'auditos_owner' then
    return old;
  end if;
  raise exception 'working papers are never hard deleted' using errcode = 'AO403';
end
$$;
create trigger wp_items_no_delete before delete on wp_items for each row execute function wp_items_no_delete();

create function wp_items_after() returns trigger language plpgsql security definer set search_path = public, pg_temp as
$$
declare action text;
begin
  if tg_op = 'INSERT' then
    insert into wp_item_versions (tenant_id, item_id, version, title, content, content_hash, edited_by)
    values (new.tenant_id, new.id, new.version, new.title, new.content, new.content_hash, app_user());
    action := 'item.created';
  elsif new.version <> old.version then
    insert into wp_item_versions (tenant_id, item_id, version, title, content, content_hash, edited_by, reason)
    values (new.tenant_id, new.id, new.version, new.title, new.content, new.content_hash, app_user(), nullif(current_setting('app.edit_reason', true), ''));
    action := 'item.edited';
  elsif new.deleted_at is distinct from old.deleted_at then
    action := 'item.deleted';
  elsif new.state is distinct from old.state then
    action := 'item.state_changed';
  else
    return null;
  end if;
  perform audit_append_internal(
    new.tenant_id, app_user(), action, 'wp_item', new.id::text,
    jsonb_build_object('kind', new.kind, 'title', new.title, 'version', new.version, 'state', new.state,
      'content_hash', new.content_hash, 'previous_state', case when tg_op = 'UPDATE' then old.state end,
      'previous_hash', case when tg_op = 'UPDATE' then old.content_hash end,
      'reason', nullif(current_setting('app.edit_reason', true), ''))
  );
  return null;
end
$$;
create trigger wp_items_after after insert or update on wp_items for each row execute function wp_items_after();

-- Sign-off: stale-hash protection, state progression, separation of duties.
create function item_signoff(p_item uuid, p_level text, p_expected_hash text) returns text
language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  it wp_items%rowtype;
  last_editor uuid;
  caller_role text;
  need text;
  target text;
begin
  select * into it from wp_items where id = p_item;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if engagement_is_locked(it.engagement_id) then raise exception 'engagement is locked' using errcode = 'AO409'; end if;
  if it.deleted_at is not null then raise exception 'item_deleted' using errcode = 'AO409'; end if;
  if it.content_hash <> p_expected_hash then raise exception 'stale_content' using errcode = 'AO409'; end if;

  select role into caller_role from memberships where tenant_id = app_tenant() and user_id = app_user() and active;
  select edited_by into last_editor from wp_item_versions where item_id = it.id and version = it.version;

  if p_level = 'prepared' then
    need := 'draft'; target := 'prepared';
  elsif p_level = 'manager' then
    need := 'prepared'; target := 'manager_reviewed';
    if caller_role not in ('manager', 'partner') then raise exception 'forbidden' using errcode = 'AO403'; end if;
  elsif p_level = 'partner' then
    need := 'manager_reviewed'; target := 'partner_approved';
    if caller_role <> 'partner' then raise exception 'forbidden' using errcode = 'AO403'; end if;
  else
    raise exception 'invalid_level' using errcode = 'AO422';
  end if;
  if p_level <> 'prepared' and last_editor = app_user() then
    raise exception 'cannot review own work' using errcode = 'AO403';
  end if;
  if it.state <> need then raise exception 'invalid_item_state' using errcode = 'AO409'; end if;

  insert into signoffs (tenant_id, item_id, level, user_id, version, content_hash)
  values (it.tenant_id, it.id, p_level, app_user(), it.version, it.content_hash);
  perform set_config('app.signoff', 'on', true);
  update wp_items set state = target where id = it.id;
  perform set_config('app.signoff', 'off', true);
  return target;
end
$$;

-- Deletion: direct for draft/prepared (creator or manager+); reviewed/approved need two people.
create function item_delete_direct(p_item uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare it wp_items%rowtype; caller_role text;
begin
  select * into it from wp_items where id = p_item;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required' using errcode = 'AO422'; end if;
  if engagement_is_locked(it.engagement_id) then raise exception 'engagement is locked' using errcode = 'AO409'; end if;
  if it.deleted_at is not null then raise exception 'item_deleted' using errcode = 'AO409'; end if;
  if it.state not in ('draft', 'prepared') then raise exception 'approval_required' using errcode = 'AO409'; end if;
  select role into caller_role from memberships where tenant_id = app_tenant() and user_id = app_user() and active;
  if it.created_by <> app_user() and caller_role not in ('manager', 'partner') then
    raise exception 'forbidden' using errcode = 'AO403';
  end if;
  perform set_config('app.deleting', 'on', true);
  update wp_items set deleted_at = now(), deleted_reason = p_reason where id = it.id;
  perform set_config('app.deleting', 'off', true);
end
$$;

create function deletion_request_create(p_item uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as
$$
declare it wp_items%rowtype; v uuid;
begin
  select * into it from wp_items where id = p_item;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required' using errcode = 'AO422'; end if;
  if engagement_is_locked(it.engagement_id) then raise exception 'engagement is locked' using errcode = 'AO409'; end if;
  if it.deleted_at is not null then raise exception 'item_deleted' using errcode = 'AO409'; end if;
  insert into deletion_requests (tenant_id, item_id, requested_by, reason)
  values (it.tenant_id, it.id, app_user(), p_reason) returning id into v;
  return v;
exception when unique_violation then
  raise exception 'request_already_pending' using errcode = 'AO409';
end
$$;

create function deletion_request_approve(p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  r deletion_requests%rowtype;
  it wp_items%rowtype;
  caller_role text; caller_grade integer; requester_grade integer;
begin
  select * into r from deletion_requests where id = p_request;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  select * into it from wp_items where id = r.item_id;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if r.status <> 'pending' then raise exception 'request_not_pending' using errcode = 'AO409'; end if;
  if engagement_is_locked(it.engagement_id) then raise exception 'engagement is locked' using errcode = 'AO409'; end if;
  if r.requested_by = app_user() then raise exception 'cannot approve own request' using errcode = 'AO403'; end if;
  select role, grade into caller_role, caller_grade from memberships where tenant_id = app_tenant() and user_id = app_user() and active;
  select grade into requester_grade from memberships where tenant_id = app_tenant() and user_id = r.requested_by;
  if caller_role not in ('manager', 'partner') or caller_grade < coalesce(requester_grade, 0) then
    raise exception 'forbidden' using errcode = 'AO403';
  end if;
  perform set_config('app.deleting', 'on', true);
  update wp_items set deleted_at = now(), deleted_reason = r.reason where id = it.id;
  perform set_config('app.deleting', 'off', true);
  update deletion_requests set status = 'executed', approved_by = app_user(), decided_at = now() where id = r.id;
end
$$;

-- Unlock: partner requests with a reason; a different partner or quality officer on the engagement approves.
create function unlock_request_create(p_engagement uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as
$$
declare v uuid; caller_role text;
begin
  if not is_engagement_member(p_engagement) then raise exception 'not_found' using errcode = 'AO404'; end if;
  select role into caller_role from memberships where tenant_id = app_tenant() and user_id = app_user() and active;
  if caller_role <> 'partner' then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'reason_required' using errcode = 'AO422'; end if;
  if not engagement_is_locked(p_engagement) then raise exception 'engagement_not_locked' using errcode = 'AO409'; end if;
  insert into unlock_requests (tenant_id, engagement_id, requested_by, reason)
  values (app_tenant(), p_engagement, app_user(), p_reason) returning id into v;
  return v;
exception when unique_violation then
  raise exception 'request_already_pending' using errcode = 'AO409';
end
$$;

create function unlock_request_approve(p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare r unlock_requests%rowtype; caller_role text;
begin
  select * into r from unlock_requests where id = p_request;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if r.status <> 'pending' then raise exception 'request_not_pending' using errcode = 'AO409'; end if;
  if r.requested_by = app_user() then raise exception 'cannot approve own request' using errcode = 'AO403'; end if;
  select role into caller_role from memberships where tenant_id = app_tenant() and user_id = app_user() and active;
  if caller_role not in ('partner', 'quality_officer') then raise exception 'forbidden' using errcode = 'AO403'; end if;
  perform set_config('app.unlock', 'on', true);
  update engagements set state = 'report_issued', unlocked_until = now() + interval '7 days' where id = r.engagement_id;
  perform set_config('app.unlock', 'off', true);
  update unlock_requests set status = 'approved', approved_by = app_user(), decided_at = now() where id = r.id;
  perform audit_append_internal(r.tenant_id, app_user(), 'engagement.unlocked', 'engagement', r.engagement_id::text,
    jsonb_build_object('reason', r.reason, 'requested_by', r.requested_by, 'approved_by', app_user()));
end
$$;

-- The auto-lock job must not re-lock an engagement that was just unlocked.
create or replace function system_lock_due(p_today date) returns integer
language plpgsql security definer set search_path = public, pg_temp as
$$
declare r record; n integer := 0;
begin
  for r in
    select e.id, e.tenant_id from engagements e join tenants t on t.id = e.tenant_id
     where e.state = 'report_issued'
       and (e.unlocked_until is null or e.unlocked_until <= now())
       and e.report_date + coalesce((t.settings ->> 'assemblyDays')::integer, 60) <= p_today
  loop
    update engagements set state = 'locked' where id = r.id;
    perform audit_append_internal(r.tenant_id, null, 'engagement.auto_locked', 'engagement', r.id::text, '{}'::jsonb);
    n := n + 1;
  end loop;
  return n;
end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'wp_hash(text, jsonb)', 'is_engagement_member(uuid)', 'engagement_is_locked(uuid)',
    'item_signoff(uuid, text, text)', 'item_delete_direct(uuid, text)', 'deletion_request_create(uuid, text)',
    'deletion_request_approve(uuid)', 'unlock_request_create(uuid, text)', 'unlock_request_approve(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to auditos_app', f);
  end loop;
end
$$;

select audit_attach('signoffs');
select audit_attach('deletion_requests');
select audit_attach('unlock_requests');
