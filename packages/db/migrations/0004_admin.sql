-- Tenant administration and platform provisioning, as SECURITY DEFINER functions so the app
-- role never needs INSERT on users or tenants.

create function auth_user_fingerprint(p_user uuid) returns text
language sql security definer set search_path = public, pg_temp as
$$ select left(encode(digest(password_hash, 'sha256'), 'hex'), 16) from users where id = p_user $$;

create function auth_set_password(p_user uuid, p_hash text) returns void
language sql security definer set search_path = public, pg_temp as
$$ update users set password_hash = p_hash, failed_logins = 0, locked_until = null where id = p_user $$;

-- Caller must be an active firm_admin of the current tenant context.
create function admin_invite_user(p_email text, p_role text, p_grade integer) returns uuid
language plpgsql security definer set search_path = public, pg_temp as
$$
declare uid uuid;
begin
  if app_tenant() is null or not exists (
    select 1 from memberships where tenant_id = app_tenant() and user_id = app_user() and role = 'firm_admin' and active
  ) then
    raise exception 'admin: firm_admin required';
  end if;
  select id into uid from users where lower(email) = lower(p_email);
  if uid is null then
    insert into users (email, password_hash) values (p_email, 'invite:' || encode(gen_random_bytes(16), 'hex'))
    returning id into uid;
  end if;
  insert into memberships (tenant_id, user_id, role, grade)
  values (app_tenant(), uid, p_role, p_grade)
  on conflict (tenant_id, user_id) do update set role = excluded.role, grade = excluded.grade, active = true;
  return uid;
end
$$;

-- Revokes a member's sessions that are bound to the current tenant.
create function session_revoke_tenant(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if app_tenant() is null or not exists (
    select 1 from memberships where tenant_id = app_tenant() and user_id = app_user() and role = 'firm_admin' and active
  ) then
    raise exception 'admin: firm_admin required';
  end if;
  update sessions set revoked_at = now()
   where user_id = p_user and tenant_id = app_tenant() and revoked_at is null;
end
$$;

-- Called only by the token-guarded platform endpoint.
create function platform_create_tenant(p_name text, p_admin_email text)
returns table (tenant_id uuid, user_id uuid)
language plpgsql security definer set search_path = public, pg_temp as
$$
declare tid uuid; uid uuid;
begin
  insert into tenants (name) values (p_name) returning id into tid;
  select id into uid from users where lower(email) = lower(p_admin_email);
  if uid is null then
    insert into users (email, password_hash) values (p_admin_email, 'invite:' || encode(gen_random_bytes(16), 'hex'))
    returning id into uid;
  end if;
  perform set_config('app.tenant_id', tid::text, true);
  insert into memberships (tenant_id, user_id, role, grade) values (tid, uid, 'firm_admin', 0);
  return query select tid, uid;
end
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'auth_user_fingerprint(uuid)', 'auth_set_password(uuid, text)', 'admin_invite_user(text, text, integer)',
    'session_revoke_tenant(uuid)', 'platform_create_tenant(text, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to auditos_app', f);
  end loop;
end
$$;
