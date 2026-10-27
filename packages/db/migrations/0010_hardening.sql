-- Hardening from the independent review: the app role gets no direct write path to state, roles,
-- settings or declaration dates; every controlled change goes through a definer function that checks
-- the caller. Session settings alone never authorise anything.

revoke update (state, report_date, eqr_id, risk_profile) on engagements from auditos_app;
revoke insert on memberships from auditos_app;
revoke update (role, grade, active) on memberships from auditos_app;
revoke update (name, settings) on tenants from auditos_app;
revoke insert on independence_declarations from auditos_app;
grant insert (tenant_id, user_id, engagement_id, statement, threats) on independence_declarations to auditos_app;

-- Membership of an engagement only counts while the person's firm membership is active.
create or replace function is_engagement_member(p_engagement uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select exists (
    select 1 from engagement_members em
      join memberships m on m.tenant_id = em.tenant_id and m.user_id = em.user_id and m.active
     where em.engagement_id = p_engagement and em.user_id = app_user() and em.tenant_id = app_tenant()
  )
$$;

-- The unlock flag only works for the owner role, i.e. inside our own definer functions.
create or replace function engagements_guard() returns trigger language plpgsql as
$$
begin
  if old.state = 'locked' then
    if current_setting('app.unlock', true) = 'on' and current_user = 'auditos_owner' and new.state = 'report_issued' then
      new.locked_at := null;
      return new;
    end if;
    raise exception 'engagement is locked';
  end if;
  if new.state <> old.state then
    if engagement_order(new.state) <> engagement_order(old.state) + 1 then
      raise exception 'invalid state transition % -> %', old.state, new.state;
    end if;
    if new.state = 'report_issued' and new.report_date is null then
      raise exception 'report date required to issue the report';
    end if;
    if new.state = 'locked' then
      new.locked_at := now();
    end if;
  end if;
  return new;
end
$$;

create function engagement_transition(p_engagement uuid, p_to text, p_report_date date) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare caller_role text;
begin
  if not is_engagement_member(p_engagement) then raise exception 'not_found' using errcode = 'AO404'; end if;
  select role into caller_role from memberships where tenant_id = app_tenant() and user_id = app_user() and active;
  if caller_role is null or caller_role not in ('manager', 'partner') then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if p_to in ('partner_approved', 'report_issued', 'locked') and caller_role <> 'partner' then
    raise exception 'forbidden' using errcode = 'AO403';
  end if;
  update engagements set state = p_to, report_date = coalesce(p_report_date, report_date)
   where id = p_engagement and tenant_id = app_tenant();
end
$$;

create or replace function engagement_set_eqr(p_engagement uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare pid uuid; caller_role text;
begin
  select partner_id into pid from engagements e
   where e.id = p_engagement and e.tenant_id = app_tenant() and is_engagement_member(e.id);
  if pid is null then raise exception 'not_found' using errcode = 'AO404'; end if;
  select role into caller_role from memberships where tenant_id = app_tenant() and user_id = app_user() and active;
  if caller_role is distinct from 'partner' then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if p_user = pid then raise exception 'engagement partner cannot be the eqr' using errcode = 'AO403'; end if;
  if not exists (select 1 from memberships where tenant_id = app_tenant() and user_id = p_user and active and role in ('eqr', 'partner')) then
    raise exception 'user_not_assignable' using errcode = 'AO422';
  end if;
  if not has_independence(p_user, p_engagement) then raise exception 'independence_declaration_required' using errcode = 'AO422'; end if;
  update engagements set eqr_id = p_user where id = p_engagement;
  insert into engagement_members (tenant_id, engagement_id, user_id) values (app_tenant(), p_engagement, p_user) on conflict do nothing;
end
$$;

create function admin_update_member(p_user uuid, p_role text, p_grade integer, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if app_tenant() is null or not exists (
    select 1 from memberships where tenant_id = app_tenant() and user_id = app_user() and role = 'firm_admin' and active
  ) then
    raise exception 'admin: firm_admin required' using errcode = 'AO403';
  end if;
  update memberships set role = coalesce(p_role, role), grade = coalesce(p_grade, grade), active = coalesce(p_active, active)
   where tenant_id = app_tenant() and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if p_active = false then
    update sessions set revoked_at = now() where user_id = p_user and tenant_id = app_tenant() and revoked_at is null;
  end if;
end
$$;

-- Items: creator is always the caller; an addendum must be an addendum of an item in the same engagement.
create or replace function wp_items_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as
$$
declare reason text := nullif(current_setting('app.edit_reason', true), '');
begin
  if tg_op = 'INSERT' then
    if new.addendum_of is not null then
      if new.kind <> 'addendum' then raise exception 'addendum_invalid' using errcode = 'AO422'; end if;
      if not exists (select 1 from wp_items t where t.id = new.addendum_of and t.engagement_id = new.engagement_id and t.tenant_id = new.tenant_id) then
        raise exception 'addendum_invalid' using errcode = 'AO422';
      end if;
    end if;
    if engagement_is_locked(new.engagement_id) and new.addendum_of is null then
      raise exception 'engagement is locked' using errcode = 'AO409';
    end if;
    new.version := 1;
    new.state := 'draft';
    new.deleted_at := null;
    new.deleted_reason := null;
    new.created_by := coalesce(app_user(), new.created_by);
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
    if coalesce(current_setting('app.deleting', true), '') <> 'on' or current_user <> 'auditos_owner' then
      raise exception 'items are deleted only through the deletion procedure' using errcode = 'AO403';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if new.title is distinct from old.title or new.content is distinct from old.content then
    if old.deleted_at is not null then raise exception 'item_deleted' using errcode = 'AO409'; end if;
    if old.state = 'partner_approved' and reason is null then raise exception 'reason_required' using errcode = 'AO422'; end if;
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
    if coalesce(current_setting('app.signoff', true), '') <> 'on' or current_user <> 'auditos_owner' then
      raise exception 'state changes only through sign-off' using errcode = 'AO403';
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;

-- Sign-off: row locked, version re-checked at update time, distinct people across levels, grade rule.
create or replace function item_signoff(p_item uuid, p_level text, p_expected_hash text) returns text
language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  it wp_items%rowtype;
  last_editor uuid;
  caller_role text;
  caller_grade integer;
  editor_grade integer;
  need text;
  target text;
begin
  select * into it from wp_items where id = p_item for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if engagement_is_locked(it.engagement_id) then raise exception 'engagement is locked' using errcode = 'AO409'; end if;
  if it.deleted_at is not null then raise exception 'item_deleted' using errcode = 'AO409'; end if;
  if it.content_hash <> p_expected_hash then raise exception 'stale_content' using errcode = 'AO409'; end if;

  select role, grade into caller_role, caller_grade from memberships where tenant_id = app_tenant() and user_id = app_user() and active;
  if caller_role is null then raise exception 'forbidden' using errcode = 'AO403'; end if;
  select edited_by into last_editor from wp_item_versions where item_id = it.id and version = it.version;
  select grade into editor_grade from memberships where tenant_id = app_tenant() and user_id = last_editor;

  if p_level = 'prepared' then
    need := 'draft'; target := 'prepared';
  elsif p_level = 'manager' then
    need := 'prepared'; target := 'manager_reviewed';
    if caller_role not in ('manager', 'partner') then raise exception 'forbidden' using errcode = 'AO403'; end if;
    if caller_grade <= coalesce(editor_grade, 0) then raise exception 'reviewer grade must exceed preparer grade' using errcode = 'AO403'; end if;
  elsif p_level = 'partner' then
    need := 'manager_reviewed'; target := 'partner_approved';
    if caller_role <> 'partner' and not (caller_role = 'eqr' and it.kind = 'eqr_review') then
      raise exception 'forbidden' using errcode = 'AO403';
    end if;
  else
    raise exception 'invalid_level' using errcode = 'AO422';
  end if;
  if p_level <> 'prepared' then
    if last_editor = app_user() or exists (select 1 from signoffs where item_id = it.id and user_id = app_user() and revoked_at is null) then
      raise exception 'cannot review own work' using errcode = 'AO403';
    end if;
  end if;
  if it.state <> need then raise exception 'invalid_item_state' using errcode = 'AO409'; end if;
  if p_level = 'partner' and exists (select 1 from review_notes where item_id = it.id and status = 'open') then
    raise exception 'open_review_notes' using errcode = 'AO409';
  end if;

  insert into signoffs (tenant_id, item_id, level, user_id, version, content_hash)
  values (it.tenant_id, it.id, p_level, app_user(), it.version, it.content_hash);
  perform set_config('app.signoff', 'on', true);
  update wp_items set state = target where id = it.id and version = it.version and content_hash = it.content_hash;
  if not found then raise exception 'stale_content' using errcode = 'AO409'; end if;
  perform set_config('app.signoff', 'off', true);
  return target;
end
$$;

-- The lock job: the date can never be in the future, and one firm's bad setting cannot stop it for others.
create or replace function system_lock_due(p_today date) returns integer
language plpgsql security definer set search_path = public, pg_temp as
$$
declare r record; n integer := 0;
begin
  for r in
    select e.id, e.tenant_id from engagements e join tenants t on t.id = e.tenant_id
     where e.state = 'report_issued'
       and (e.unlocked_until is null or e.unlocked_until <= now())
       and e.report_date + case when t.settings ->> 'assemblyDays' ~ '^[0-9]{1,3}$' then (t.settings ->> 'assemblyDays')::integer else 60 end
           <= least(p_today, current_date)
  loop
    update engagements set state = 'locked' where id = r.id;
    perform audit_append_internal(r.tenant_id, null, 'engagement.auto_locked', 'engagement', r.id::text, '{}'::jsonb);
    n := n + 1;
  end loop;
  return n;
end
$$;

-- The application may only write audit events in these families; system events come from the database.
create or replace function audit_append(p_action text, p_type text, p_id text, p_detail jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if app_tenant() is null then raise exception 'audit: tenant context required'; end if;
  if p_action !~ '^(auth|evidence|export)\.[a-z0-9_]{1,40}$' then
    raise exception 'audit: action not allowed' using errcode = 'AO403';
  end if;
  perform audit_append_internal(app_tenant(), app_user(), p_action, p_type, p_id, p_detail);
end
$$;

-- A failed tenant selection must not leave the tenant set for the rest of the transaction.
create or replace function session_select_tenant(p_session uuid, p_user uuid, p_tenant uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  perform set_config('app.user_id', p_user::text, true);
  perform set_config('app.tenant_id', p_tenant::text, true);
  if not exists (select 1 from memberships where tenant_id = p_tenant and user_id = p_user and active) then
    perform set_config('app.tenant_id', '', true);
    return false;
  end if;
  update sessions set tenant_id = p_tenant where id = p_session and user_id = p_user and revoked_at is null;
  return found;
end
$$;

revoke all on function engagement_transition(uuid, text, date) from public;
revoke all on function admin_update_member(uuid, text, integer, boolean) from public;
grant execute on function engagement_transition(uuid, text, date) to auditos_app;
grant execute on function admin_update_member(uuid, text, integer, boolean) to auditos_app;
