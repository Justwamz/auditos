-- Tenancy: tenants, users, memberships, helper functions, RLS.

create function app_tenant() returns uuid language sql stable as
$$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create function app_user() returns uuid language sql stable as
$$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

grant execute on function app_tenant(), app_user() to auditos_app;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table tenants enable row level security;
create policy tenants_self on tenants using (id = app_tenant());
grant select, update (name, settings) on tenants to auditos_app;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  mfa_secret_enc text,
  mfa_enabled boolean not null default false,
  active boolean not null default true,
  failed_logins integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create unique index users_email_lower on users (lower(email));

create table memberships (
  tenant_id uuid not null references tenants (id),
  user_id uuid not null references users (id),
  role text not null check (role in ('firm_admin','partner','manager','senior','staff','quality_officer','eqr')),
  grade integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index memberships_user on memberships (user_id);
alter table memberships enable row level security;
alter table memberships force row level security;
create policy memberships_tenant on memberships
  using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update (role, grade, active) on memberships to auditos_app;

-- users is global. Visible to the app role only for self or members of the current tenant,
-- and never the secret columns. NOT forced: the SECURITY DEFINER auth functions run as owner.
alter table users enable row level security;
create policy users_visible on users for select using (
  id = app_user()
  or exists (select 1 from memberships m where m.user_id = users.id and m.tenant_id = app_tenant())
);
grant select (id, email, active, mfa_enabled, created_at) on users to auditos_app;
