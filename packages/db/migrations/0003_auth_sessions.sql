-- Authentication: sessions and the SECURITY DEFINER functions that are the only way the
-- app role touches credentials. The app role has no grants on sessions or secret columns.

alter table users add column last_totp_step bigint;

-- A user can see their own memberships across tenants, and the tenants they belong to.
create policy memberships_self on memberships for select using (user_id = app_user());
create policy tenants_member on tenants for select using (
  exists (select 1 from memberships m where m.tenant_id = tenants.id and m.user_id = app_user())
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users (id),
  tenant_id uuid references tenants (id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  stepup_at timestamptz,
  ip text,
  user_agent text,
  revoked_at timestamptz
);
create index sessions_user on sessions (user_id);
alter table sessions enable row level security;

create function auth_lookup(p_email text)
returns table (id uuid, password_hash text, mfa_secret_enc text, mfa_enabled boolean, active boolean, locked_until timestamptz, last_totp_step bigint)
language sql security definer set search_path = public, pg_temp as
$$
  select u.id, u.password_hash, u.mfa_secret_enc, u.mfa_enabled, u.active, u.locked_until, u.last_totp_step
  from users u where lower(u.email) = lower(p_email)
$$;

create function auth_user_by_id(p_user uuid)
returns table (id uuid, mfa_secret_enc text, mfa_enabled boolean, active boolean, locked_until timestamptz, last_totp_step bigint, email text)
language sql security definer set search_path = public, pg_temp as
$$
  select u.id, u.mfa_secret_enc, u.mfa_enabled, u.active, u.locked_until, u.last_totp_step, u.email
  from users u where u.id = p_user
$$;

create function auth_record_failure(p_user uuid, p_max integer, p_lock_minutes integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as
$$
declare locked boolean;
begin
  update users set
    failed_logins = failed_logins + 1,
    locked_until = case when failed_logins + 1 >= p_max then now() + make_interval(mins => p_lock_minutes) else locked_until end
  where id = p_user
  returning (failed_logins >= p_max) into locked;
  return coalesce(locked, false);
end
$$;

create function auth_record_success(p_user uuid) returns void
language sql security definer set search_path = public, pg_temp as
$$ update users set failed_logins = 0, locked_until = null where id = p_user $$;

create function auth_begin_mfa(p_user uuid, p_secret_enc text) returns void
language sql security definer set search_path = public, pg_temp as
$$ update users set mfa_secret_enc = p_secret_enc where id = p_user and mfa_enabled = false $$;

create function auth_enable_mfa(p_user uuid) returns void
language sql security definer set search_path = public, pg_temp as
$$ update users set mfa_enabled = true where id = p_user and mfa_secret_enc is not null $$;

create function auth_accept_totp_step(p_user uuid, p_step bigint) returns boolean
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  update users set last_totp_step = p_step
  where id = p_user and (last_totp_step is null or last_totp_step < p_step);
  return found;
end
$$;

create function session_create(p_user uuid, p_token_hash text, p_abs_hours integer, p_ip text, p_ua text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as
$$
declare sid uuid; n integer; only_tenant uuid;
begin
  perform set_config('app.user_id', p_user::text, true);
  select count(*), min(tenant_id::text)::uuid into n, only_tenant
    from memberships where user_id = p_user and active;
  insert into sessions (token_hash, user_id, tenant_id, expires_at, ip, user_agent)
  values (p_token_hash, p_user, case when n = 1 then only_tenant else null end,
          now() + make_interval(hours => p_abs_hours), p_ip, left(p_ua, 300))
  returning id into sid;
  return sid;
end
$$;

create function session_load(p_token_hash text, p_idle_minutes integer)
returns table (session_id uuid, user_id uuid, tenant_id uuid, stepup_at timestamptz, role text, grade integer, membership_active boolean)
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
    select s.id, s.user_id, s.tenant_id, s.stepup_at, m.role, m.grade, m.active
    from (select 1) one
    left join memberships m on m.tenant_id = s.tenant_id and m.user_id = s.user_id;
end
$$;

create function session_select_tenant(p_session uuid, p_user uuid, p_tenant uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  perform set_config('app.user_id', p_user::text, true);
  perform set_config('app.tenant_id', p_tenant::text, true);
  if not exists (select 1 from memberships where tenant_id = p_tenant and user_id = p_user and active) then
    return false;
  end if;
  update sessions set tenant_id = p_tenant where id = p_session and user_id = p_user and revoked_at is null;
  return found;
end
$$;

create function session_stepup(p_session uuid, p_user uuid) returns void
language sql security definer set search_path = public, pg_temp as
$$ update sessions set stepup_at = now() where id = p_session and user_id = p_user and revoked_at is null $$;

create function session_revoke(p_session uuid, p_user uuid) returns void
language sql security definer set search_path = public, pg_temp as
$$ update sessions set revoked_at = now() where id = p_session and user_id = p_user $$;

create function session_revoke_user(p_user uuid) returns void
language sql security definer set search_path = public, pg_temp as
$$ update sessions set revoked_at = now() where user_id = p_user and revoked_at is null $$;

do $$
declare f text;
begin
  foreach f in array array[
    'auth_lookup(text)', 'auth_user_by_id(uuid)', 'auth_record_failure(uuid, integer, integer)',
    'auth_record_success(uuid)', 'auth_begin_mfa(uuid, text)', 'auth_enable_mfa(uuid)',
    'auth_accept_totp_step(uuid, bigint)', 'session_create(uuid, text, integer, text, text)',
    'session_load(text, integer)', 'session_select_tenant(uuid, uuid, uuid)', 'session_stepup(uuid, uuid)',
    'session_revoke(uuid, uuid)', 'session_revoke_user(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to auditos_app', f);
  end loop;
end
$$;
