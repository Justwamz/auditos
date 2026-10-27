-- Named people, and "admin" as a permission a named person holds next to their role.
alter table users add column full_name text check (full_name is null or length(full_name) between 2 and 120);
alter table memberships add column is_admin boolean not null default false;
update memberships set is_admin = true where role = 'firm_admin';
grant select (full_name) on users to auditos_app;

-- True when the caller is an active member of the current firm who holds the admin permission (or the firm_admin role).
create function is_tenant_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select exists (
    select 1 from memberships
     where tenant_id = app_tenant() and user_id = app_user() and active and (role = 'firm_admin' or is_admin)
  )
$$;
revoke all on function is_tenant_admin() from public;
grant execute on function is_tenant_admin() to auditos_app;

-- The session now also reports the admin permission.
drop function session_load(text, integer);
create function session_load(p_token_hash text, p_idle_minutes integer)
returns table (session_id uuid, user_id uuid, tenant_id uuid, stepup_age_seconds double precision, role text, grade integer, membership_active boolean, is_admin boolean)
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
           m.role, m.grade, m.active, coalesce(m.is_admin or m.role = 'firm_admin', false)
    from (select 1) one
    left join memberships m on m.tenant_id = s.tenant_id and m.user_id = s.user_id;
end
$$;
revoke all on function session_load(text, integer) from public;
grant execute on function session_load(text, integer) to auditos_app;

-- Inviting: the caller needs the admin permission; the invitee gets a name and, optionally, the permission.
drop function admin_invite_user(text, text, integer);
create function admin_invite_user(p_email text, p_role text, p_grade integer, p_full_name text, p_is_admin boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as
$$
declare uid uuid;
begin
  if app_tenant() is null or not is_tenant_admin() then
    raise exception 'admin: admin permission required' using errcode = 'AO403';
  end if;
  select id into uid from users where lower(email) = lower(p_email);
  if uid is null then
    insert into users (email, full_name, password_hash) values (p_email, p_full_name, 'invite:' || encode(gen_random_bytes(16), 'hex'))
    returning id into uid;
  else
    update users set full_name = coalesce(full_name, p_full_name) where id = uid;
  end if;
  insert into memberships (tenant_id, user_id, role, grade, is_admin)
  values (app_tenant(), uid, p_role, p_grade, coalesce(p_is_admin, false) or p_role = 'firm_admin')
  on conflict (tenant_id, user_id) do update
    set role = excluded.role, grade = excluded.grade, active = true, is_admin = memberships.is_admin or excluded.is_admin;
  return uid;
end
$$;
revoke all on function admin_invite_user(text, text, integer, text, boolean) from public;
grant execute on function admin_invite_user(text, text, integer, text, boolean) to auditos_app;

create or replace function session_revoke_tenant(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if app_tenant() is null or not is_tenant_admin() then
    raise exception 'admin: admin permission required';
  end if;
  update sessions set revoked_at = now()
   where user_id = p_user and tenant_id = app_tenant() and revoked_at is null;
end
$$;

-- Role, grade and active changes; the last admin cannot be deactivated or demoted out of the permission.
create or replace function admin_update_member(p_user uuid, p_role text, p_grade integer, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if app_tenant() is null or not is_tenant_admin() then
    raise exception 'admin: admin permission required' using errcode = 'AO403';
  end if;
  update memberships set role = coalesce(p_role, role), grade = coalesce(p_grade, grade), active = coalesce(p_active, active)
   where tenant_id = app_tenant() and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if not exists (select 1 from memberships where tenant_id = app_tenant() and active and (role = 'firm_admin' or is_admin)) then
    raise exception 'last_admin' using errcode = 'AO409';
  end if;
  if p_active = false then
    update sessions set revoked_at = now() where user_id = p_user and tenant_id = app_tenant() and revoked_at is null;
  end if;
end
$$;

create function admin_set_admin(p_user uuid, p_is_admin boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if app_tenant() is null or not is_tenant_admin() then
    raise exception 'admin: admin permission required' using errcode = 'AO403';
  end if;
  update memberships set is_admin = p_is_admin where tenant_id = app_tenant() and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if not exists (select 1 from memberships where tenant_id = app_tenant() and active and (role = 'firm_admin' or is_admin)) then
    raise exception 'last_admin' using errcode = 'AO409';
  end if;
end
$$;
revoke all on function admin_set_admin(uuid, boolean) from public;
grant execute on function admin_set_admin(uuid, boolean) to auditos_app;

-- Creating a firm: the first admin is a named person.
drop function platform_create_tenant(text, text);
create function platform_create_tenant(p_name text, p_admin_email text, p_admin_full_name text)
returns table (tenant_id uuid, user_id uuid)
language plpgsql security definer set search_path = public, pg_temp as
$$
declare tid uuid; uid uuid;
begin
  insert into tenants (name) values (p_name) returning id into tid;
  select id into uid from users where lower(email) = lower(p_admin_email);
  if uid is null then
    insert into users (email, full_name, password_hash) values (p_admin_email, p_admin_full_name, 'invite:' || encode(gen_random_bytes(16), 'hex'))
    returning id into uid;
  end if;
  perform set_config('app.tenant_id', tid::text, true);
  insert into memberships (tenant_id, user_id, role, grade, is_admin) values (tid, uid, 'firm_admin', 0, true);
  return query select tid, uid;
end
$$;
revoke all on function platform_create_tenant(text, text, text) from public;
grant execute on function platform_create_tenant(text, text, text) to auditos_app;
