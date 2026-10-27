-- Time and expenses. People record their own; the hourly rate is fixed at the moment of entry from the firm's rates, so a later
-- rate change never rewrites history. Once an entry has been invoiced it can no longer be changed or deleted.

create table time_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  user_id uuid not null references users (id),
  engagement_id uuid,
  work_date date not null,
  minutes integer not null check (minutes between 1 and 1440),
  description text not null check (length(description) between 1 and 500),
  billable boolean not null default true,
  rate_cents bigint not null default 0 check (rate_cents >= 0),
  invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, engagement_id) references engagements (tenant_id, id),
  check (engagement_id is not null or billable = false)
);
create index time_entries_person on time_entries (tenant_id, user_id, work_date);
create index time_entries_engagement on time_entries (engagement_id);

create table engagement_expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  engagement_id uuid not null,
  user_id uuid not null references users (id),
  spent_on date not null,
  category text not null check (category in ('fuel', 'transport', 'accommodation', 'meals', 'stationery', 'communication', 'other')),
  description text not null check (length(description) between 1 and 300),
  amount_cents bigint not null check (amount_cents > 0),
  rebillable boolean not null default true,
  receipt_item_id uuid,
  invoice_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, engagement_id) references engagements (tenant_id, id)
);
create index engagement_expenses_engagement on engagement_expenses (engagement_id);
create index engagement_expenses_person on engagement_expenses (tenant_id, user_id, spent_on);

-- Whoever is acting records for themselves, at the rate the firm has set for their role.
create function time_entries_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as
$$
declare caller text := caller_role();
begin
  if tg_op = 'INSERT' then
    if caller is null or caller = 'firm_admin' then raise exception 'forbidden' using errcode = 'AO403'; end if;
    new.user_id := app_user();
    new.invoice_id := null;
    new.rate_cents := case when new.billable and new.engagement_id is not null
      then coalesce((select rate_cents from billing_rates where tenant_id = new.tenant_id and role = caller), 0) else 0 end;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then raise exception 'time_entry_invoiced' using errcode = 'AO409'; end if;
    return old;
  end if;
  if old.invoice_id is distinct from new.invoice_id then
    -- Only the invoicing functions may attach or release an invoice.
    if coalesce(current_setting('app.invoicing', true), '') <> 'on' then raise exception 'time_entry_invoiced' using errcode = 'AO409'; end if;
    return new;
  end if;
  if old.invoice_id is not null then raise exception 'time_entry_invoiced' using errcode = 'AO409'; end if;
  new.user_id := old.user_id;
  new.engagement_id := old.engagement_id;
  new.rate_cents := old.rate_cents;
  new.updated_at := now();
  return new;
end
$$;
create trigger time_entries_guard before insert or update or delete on time_entries for each row execute function time_entries_guard();

create function expenses_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as
$$
declare caller text := caller_role();
begin
  if tg_op = 'INSERT' then
    if caller is null or caller = 'firm_admin' then raise exception 'forbidden' using errcode = 'AO403'; end if;
    new.user_id := app_user();
    new.invoice_id := null;
    if new.receipt_item_id is not null and not exists (
      select 1 from wp_items where id = new.receipt_item_id and engagement_id = new.engagement_id and kind = 'evidence' and deleted_at is null
    ) then raise exception 'invalid_receipt' using errcode = 'AO422'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then raise exception 'expense_invoiced' using errcode = 'AO409'; end if;
    return old;
  end if;
  if old.invoice_id is distinct from new.invoice_id then
    if coalesce(current_setting('app.invoicing', true), '') <> 'on' then raise exception 'expense_invoiced' using errcode = 'AO409'; end if;
    return new;
  end if;
  if old.invoice_id is not null then raise exception 'expense_invoiced' using errcode = 'AO409'; end if;
  if new.receipt_item_id is distinct from old.receipt_item_id and new.receipt_item_id is not null and not exists (
    select 1 from wp_items where id = new.receipt_item_id and engagement_id = old.engagement_id and kind = 'evidence' and deleted_at is null
  ) then raise exception 'invalid_receipt' using errcode = 'AO422'; end if;
  new.user_id := old.user_id;
  new.engagement_id := old.engagement_id;
  return new;
end
$$;
create trigger expenses_guard before insert or update or delete on engagement_expenses for each row execute function expenses_guard();

alter table time_entries enable row level security;
alter table time_entries force row level security;
alter table engagement_expenses enable row level security;
alter table engagement_expenses force row level security;

-- Seen by their owner, by a manager on the engagement, and by partners.
create policy time_select on time_entries for select using (
  tenant_id = app_tenant()
  and (user_id = app_user() or is_active_partner()
       or (engagement_id is not null and coalesce(caller_role(), '') = 'manager' and is_engagement_member(engagement_id)))
);
create policy time_insert on time_entries for insert
  with check (tenant_id = app_tenant() and user_id = app_user() and (engagement_id is null or is_engagement_member(engagement_id)));
create policy time_update on time_entries for update using (tenant_id = app_tenant() and user_id = app_user()) with check (tenant_id = app_tenant());
create policy time_delete on time_entries for delete using (tenant_id = app_tenant() and user_id = app_user());

create policy expenses_select on engagement_expenses for select using (
  tenant_id = app_tenant()
  and (user_id = app_user() or is_active_partner() or (coalesce(caller_role(), '') = 'manager' and is_engagement_member(engagement_id)))
);
create policy expenses_insert on engagement_expenses for insert
  with check (tenant_id = app_tenant() and user_id = app_user() and is_engagement_member(engagement_id));
create policy expenses_update on engagement_expenses for update using (tenant_id = app_tenant() and user_id = app_user()) with check (tenant_id = app_tenant());
create policy expenses_delete on engagement_expenses for delete using (tenant_id = app_tenant() and user_id = app_user());

grant select, delete on time_entries, engagement_expenses to auditos_app;
grant insert (tenant_id, engagement_id, work_date, minutes, description, billable) on time_entries to auditos_app;
grant update (work_date, minutes, description, billable) on time_entries to auditos_app;
grant insert (tenant_id, engagement_id, spent_on, category, description, amount_cents, rebillable, receipt_item_id) on engagement_expenses to auditos_app;
grant update (spent_on, category, description, amount_cents, rebillable, receipt_item_id) on engagement_expenses to auditos_app;
