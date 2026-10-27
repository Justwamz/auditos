-- Billing: the firm's invoice details, hourly rates by role, a catalogue of taxes, and the fee arrangement for each engagement.
-- Rates and fees are commercial information: only partners, managers and people holding the administrator permission read them;
-- partners and administrators set the firm-wide ones, and a manager or partner on the team sets an engagement's fee.

create function can_manage_billing() returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$ select is_active_partner() or is_tenant_admin() $$;

create function can_see_rates() returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$ select can_manage_billing() or coalesce(caller_role(), '') = 'manager' $$;

revoke all on function can_manage_billing(), can_see_rates() from public;
grant execute on function can_manage_billing(), can_see_rates() to auditos_app;

create table billing_settings (
  tenant_id uuid primary key references tenants (id),
  legal_name text check (legal_name is null or length(legal_name) <= 200),
  address text check (address is null or length(address) <= 500),
  kra_pin text check (kra_pin is null or kra_pin ~ '^[AP][0-9]{9}[A-Z]$'),
  bank_details text check (bank_details is null or length(bank_details) <= 500),
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z]{2,6}$'),
  quote_prefix text not null default 'QUO' check (quote_prefix ~ '^[A-Z]{2,6}$'),
  payment_terms_days integer not null default 30 check (payment_terms_days between 0 and 365),
  updated_at timestamptz not null default now()
);

create table billing_rates (
  tenant_id uuid not null references tenants (id),
  role text not null check (role in ('partner', 'manager', 'senior', 'staff', 'quality_officer', 'eqr')),
  rate_cents bigint not null check (rate_cents >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, role)
);

create table tax_rates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  name text not null check (length(name) between 1 and 60),
  rate_bp integer not null check (rate_bp between 0 and 10000),
  on_previous boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table engagement_fees (
  engagement_id uuid primary key,
  tenant_id uuid not null references tenants (id),
  basis text not null check (basis in ('hourly', 'flat')),
  flat_fee_cents bigint check (flat_fee_cents is null or flat_fee_cents >= 0),
  budget_hours numeric(8, 2) check (budget_hours is null or budget_hours >= 0),
  notes text check (notes is null or length(notes) <= 1000),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, engagement_id) references engagements (tenant_id, id),
  check (basis <> 'flat' or flat_fee_cents is not null)
);

do $$
declare t text;
begin
  foreach t in array array['billing_settings', 'billing_rates', 'tax_rates', 'engagement_fees'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

create policy billing_settings_select on billing_settings for select using (tenant_id = app_tenant() and can_see_rates());
create policy billing_settings_insert on billing_settings for insert with check (tenant_id = app_tenant() and can_manage_billing());
create policy billing_settings_update on billing_settings for update using (tenant_id = app_tenant() and can_manage_billing()) with check (tenant_id = app_tenant());

create policy billing_rates_select on billing_rates for select using (tenant_id = app_tenant() and can_see_rates());
create policy billing_rates_insert on billing_rates for insert with check (tenant_id = app_tenant() and can_manage_billing());
create policy billing_rates_update on billing_rates for update using (tenant_id = app_tenant() and can_manage_billing()) with check (tenant_id = app_tenant());

create policy tax_rates_select on tax_rates for select using (tenant_id = app_tenant() and can_see_rates());
create policy tax_rates_insert on tax_rates for insert with check (tenant_id = app_tenant() and can_manage_billing());
create policy tax_rates_update on tax_rates for update using (tenant_id = app_tenant() and can_manage_billing()) with check (tenant_id = app_tenant());

create policy engagement_fees_select on engagement_fees for select using (tenant_id = app_tenant() and can_see_rates() and can_view_engagement(engagement_id));
create policy engagement_fees_insert on engagement_fees for insert
  with check (tenant_id = app_tenant() and is_engagement_member(engagement_id) and coalesce(caller_role(), '') in ('manager', 'partner'));
create policy engagement_fees_update on engagement_fees for update
  using (tenant_id = app_tenant() and is_engagement_member(engagement_id) and coalesce(caller_role(), '') in ('manager', 'partner'))
  with check (tenant_id = app_tenant());

grant select, insert, update on billing_settings, billing_rates, engagement_fees to auditos_app;
grant select, insert, update on tax_rates to auditos_app;

select audit_attach('billing_settings');
select audit_attach('billing_rates');
select audit_attach('tax_rates');
select audit_attach('engagement_fees');
