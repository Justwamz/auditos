-- Clients, engagements, assignment, independence, and the engagement state machine.

create table clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  name text not null,
  sector text not null check (sector in ('trading','consultancy','rental','farming','pension','investment')),
  legal_form text not null,
  framework text not null default 'IFRS_SME' check (framework in ('IFRS_SME','FULL_IFRS')),
  year_end_month integer not null check (year_end_month between 1 and 12),
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
alter table clients enable row level security;
alter table clients force row level security;
create policy clients_tenant on clients using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select, insert, update (name, sector, legal_form, framework, year_end_month) on clients to auditos_app;

create table engagements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  client_id uuid not null,
  period_start date not null,
  period_end date not null,
  state text not null default 'onboarding'
    check (state in ('onboarding','planning','fieldwork','completion','review','partner_approved','report_issued','locked')),
  partner_id uuid not null references users (id),
  eqr_id uuid references users (id),
  report_date date,
  locked_at timestamptz,
  risk_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, client_id) references clients (tenant_id, id),
  check (period_end > period_start)
);
create index engagements_client on engagements (client_id);

create table engagement_members (
  tenant_id uuid not null references tenants (id),
  engagement_id uuid not null,
  user_id uuid not null references users (id),
  added_at timestamptz not null default now(),
  primary key (engagement_id, user_id),
  foreign key (tenant_id, engagement_id) references engagements (tenant_id, id)
);
alter table engagement_members enable row level security;
alter table engagement_members force row level security;
create policy engagement_members_tenant on engagement_members using (tenant_id = app_tenant());
grant select on engagement_members to auditos_app;

-- Engagements are visible only to their members. Not forced: SECURITY DEFINER functions
-- (creation, system auto-lock) run as owner.
alter table engagements enable row level security;
create policy engagements_member on engagements for select using (
  tenant_id = app_tenant()
  and exists (select 1 from engagement_members em where em.engagement_id = engagements.id and em.user_id = app_user())
);
create policy engagements_member_update on engagements for update
  using (tenant_id = app_tenant()
    and exists (select 1 from engagement_members em where em.engagement_id = engagements.id and em.user_id = app_user()))
  with check (tenant_id = app_tenant());
grant select, update (state, report_date, eqr_id, risk_profile) on engagements to auditos_app;

create table independence_declarations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  user_id uuid not null references users (id),
  engagement_id uuid,
  statement text not null,
  threats jsonb not null default '[]'::jsonb,
  declared_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 months'),
  foreign key (tenant_id, engagement_id) references engagements (tenant_id, id)
);
alter table independence_declarations enable row level security;
alter table independence_declarations force row level security;
create policy independence_read on independence_declarations for select using (tenant_id = app_tenant());
create policy independence_insert on independence_declarations for insert
  with check (tenant_id = app_tenant() and user_id = app_user());
grant select, insert on independence_declarations to auditos_app;

create function engagement_order(p_state text) returns integer language sql immutable as
$$ select array_position(array['onboarding','planning','fieldwork','completion','review','partner_approved','report_issued','locked'], p_state) $$;

create function engagements_guard() returns trigger language plpgsql as
$$
begin
  if old.state = 'locked' then
    if current_setting('app.unlock', true) = 'on' and new.state = 'report_issued' then
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
create trigger engagements_guard before update on engagements for each row execute function engagements_guard();

-- Has a current declaration: annual (no engagement) or specific to the engagement.
create function has_independence(p_user uuid, p_engagement uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select exists (
    select 1 from independence_declarations d
    where d.user_id = p_user and d.tenant_id = app_tenant() and d.expires_at > now()
      and (d.engagement_id is null or d.engagement_id = p_engagement)
  )
$$;

create function caller_is_manager_or_partner() returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select exists (select 1 from memberships where tenant_id = app_tenant() and user_id = app_user() and active and role in ('manager','partner'))
$$;

create function engagement_create(p_client uuid, p_start date, p_end date, p_partner uuid, p_risk jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as
$$
declare v uuid := gen_random_uuid();
begin
  if not caller_is_manager_or_partner() then
    raise exception 'forbidden' using errcode = 'AO403';
  end if;
  if p_end <= p_start then
    raise exception 'period_invalid' using errcode = 'AO422';
  end if;
  if not exists (select 1 from clients where id = p_client and tenant_id = app_tenant()) then
    raise exception 'client_not_found' using errcode = 'AO404';
  end if;
  if not exists (select 1 from memberships where tenant_id = app_tenant() and user_id = p_partner and active and role = 'partner') then
    raise exception 'partner_required' using errcode = 'AO422';
  end if;
  if not has_independence(p_partner, null) or not has_independence(app_user(), null) then
    raise exception 'independence_declaration_required' using errcode = 'AO422';
  end if;
  insert into engagements (id, tenant_id, client_id, period_start, period_end, partner_id, risk_profile)
  values (v, app_tenant(), p_client, p_start, p_end, p_partner, coalesce(p_risk, '{}'::jsonb));
  insert into engagement_members (tenant_id, engagement_id, user_id) values (app_tenant(), v, p_partner);
  insert into engagement_members (tenant_id, engagement_id, user_id) values (app_tenant(), v, app_user())
  on conflict do nothing;
  return v;
end
$$;

create function engagement_add_member(p_engagement uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if not exists (select 1 from engagement_members where engagement_id = p_engagement and user_id = app_user() and tenant_id = app_tenant()) then
    raise exception 'not_found' using errcode = 'AO404';
  end if;
  if not caller_is_manager_or_partner() then
    raise exception 'forbidden' using errcode = 'AO403';
  end if;
  if not exists (select 1 from memberships where tenant_id = app_tenant() and user_id = p_user and active and role <> 'firm_admin') then
    raise exception 'user_not_assignable' using errcode = 'AO422';
  end if;
  if not has_independence(p_user, p_engagement) then
    raise exception 'independence_declaration_required' using errcode = 'AO422';
  end if;
  insert into engagement_members (tenant_id, engagement_id, user_id) values (app_tenant(), p_engagement, p_user)
  on conflict do nothing;
end
$$;

create function engagement_set_eqr(p_engagement uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare pid uuid;
begin
  select partner_id into pid from engagements e
   where e.id = p_engagement and e.tenant_id = app_tenant()
     and exists (select 1 from engagement_members em where em.engagement_id = e.id and em.user_id = app_user());
  if pid is null then
    raise exception 'not_found' using errcode = 'AO404';
  end if;
  if p_user = pid then
    raise exception 'engagement partner cannot be the eqr' using errcode = 'AO403';
  end if;
  if not exists (select 1 from memberships where tenant_id = app_tenant() and user_id = p_user and active and role in ('eqr','partner')) then
    raise exception 'user_not_assignable' using errcode = 'AO422';
  end if;
  if not has_independence(p_user, p_engagement) then
    raise exception 'independence_declaration_required' using errcode = 'AO422';
  end if;
  update engagements set eqr_id = p_user where id = p_engagement;
  insert into engagement_members (tenant_id, engagement_id, user_id) values (app_tenant(), p_engagement, p_user)
  on conflict do nothing;
end
$$;

-- System job: locks report_issued engagements past their assembly deadline, across all tenants.
create function system_lock_due(p_today date) returns integer
language plpgsql security definer set search_path = public, pg_temp as
$$
declare r record; n integer := 0;
begin
  for r in
    select e.id, e.tenant_id from engagements e join tenants t on t.id = e.tenant_id
     where e.state = 'report_issued'
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
    'engagement_order(text)', 'has_independence(uuid, uuid)', 'caller_is_manager_or_partner()',
    'engagement_create(uuid, date, date, uuid, jsonb)', 'engagement_add_member(uuid, uuid)',
    'engagement_set_eqr(uuid, uuid)', 'system_lock_due(date)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to auditos_app', f);
  end loop;
end
$$;

select audit_attach('clients');
select audit_attach('engagements');
select audit_attach('engagement_members');
select audit_attach('independence_declarations');
