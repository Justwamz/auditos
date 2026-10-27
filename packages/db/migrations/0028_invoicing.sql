-- Quotes and invoices. An invoice is a draft until a partner or a person holding the administrator permission issues it. Issuing assigns the
-- next number (no gaps), marks the time and expenses it bills, and freezes the document: lines, taxes and totals can no longer change.
-- Corrections are made by voiding with a reason, which releases the time and expenses, and issuing a new invoice.

create table document_counters (
  tenant_id uuid not null references tenants (id),
  kind text not null check (kind in ('invoice', 'quote')),
  year integer not null,
  last_no integer not null default 0,
  primary key (tenant_id, kind, year)
);
alter table document_counters enable row level security;
alter table document_counters force row level security;
create policy document_counters_all on document_counters using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());

-- The next number for this firm and year, for example INV-2026-0007. Runs only inside the issuing functions.
create function next_document_number(p_kind text, p_prefix text) returns text
language plpgsql security definer set search_path = public, pg_temp as
$$
declare yr integer := extract(year from (now() at time zone 'Africa/Nairobi'))::integer; n integer;
begin
  if p_prefix !~ '^[A-Z]{2,6}$' then raise exception 'invalid_prefix' using errcode = 'AO422'; end if;
  insert into document_counters (tenant_id, kind, year, last_no) values (app_tenant(), p_kind, yr, 1)
  on conflict (tenant_id, kind, year) do update set last_no = document_counters.last_no + 1
  returning last_no into n;
  return p_prefix || '-' || yr || '-' || lpad(n::text, 4, '0');
end
$$;
revoke all on function next_document_number(text, text) from public;

create table quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  number text,
  client_id uuid,
  prospect_id uuid references prospects (id),
  title text not null check (length(title) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined')),
  valid_until date,
  notes text check (notes is null or length(notes) <= 2000),
  tax_mode text not null default 'exclusive' check (tax_mode in ('exclusive', 'inclusive')),
  taxes jsonb not null default '[]'::jsonb,
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  decided_at timestamptz,
  unique (tenant_id, number),
  foreign key (tenant_id, client_id) references clients (tenant_id, id),
  check ((client_id is not null) <> (prospect_id is not null))
);

create table quote_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  quote_id uuid not null references quotes (id) on delete cascade,
  position integer not null,
  description text not null check (length(description) between 1 and 500),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_cents bigint not null check (unit_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  number text,
  client_id uuid not null,
  engagement_id uuid,
  status text not null default 'draft' check (status in ('draft', 'sent', 'part_paid', 'paid', 'void')),
  issue_date date,
  due_date date,
  notes text check (notes is null or length(notes) <= 2000),
  tax_mode text not null default 'exclusive' check (tax_mode in ('exclusive', 'inclusive')),
  taxes jsonb not null default '[]'::jsonb,
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  paid_cents bigint not null default 0 check (paid_cents >= 0),
  etims jsonb,
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  unique (tenant_id, number),
  foreign key (tenant_id, client_id) references clients (tenant_id, id),
  foreign key (tenant_id, engagement_id) references engagements (tenant_id, id),
  check (paid_cents <= total_cents)
);
create index invoices_client on invoices (tenant_id, client_id);
create index invoices_status on invoices (tenant_id, status);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  invoice_id uuid not null references invoices (id) on delete cascade,
  position integer not null,
  description text not null check (length(description) between 1 and 500),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_cents bigint not null check (unit_cents >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  source text not null default 'manual' check (source in ('manual', 'time', 'expense', 'fee')),
  source_ids uuid[] not null default '{}'
);

create table invoice_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  invoice_id uuid not null references invoices (id),
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null,
  method text not null check (method in ('bank', 'mpesa', 'cash', 'cheque', 'other')),
  reference text check (reference is null or length(reference) <= 100),
  recorded_by uuid not null references users (id),
  created_at timestamptz not null default now()
);

-- Messages the system would have emailed. Until a real email provider is configured nothing is sent: they are kept here so they can be seen.
create table outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  kind text not null check (kind in ('invoice', 'quote')),
  ref_id uuid not null,
  to_address text not null check (length(to_address) <= 254),
  subject text not null check (length(subject) <= 300),
  body text not null check (length(body) <= 5000),
  provider text not null default 'simulation',
  created_by uuid not null references users (id),
  created_at timestamptz not null default now()
);

-- Who sees a document: the person who made it, partners and administrators, and managers on the engagement (or all quotes, for managers).
create function can_see_invoice(p_created_by uuid, p_engagement uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select app_user() = p_created_by or can_manage_billing()
      or (coalesce(caller_role(), '') = 'manager' and p_engagement is not null and is_engagement_member(p_engagement))
$$;
create function can_see_quote(p_created_by uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$ select app_user() = p_created_by or can_manage_billing() or coalesce(caller_role(), '') = 'manager' $$;
-- Partners, managers and holders of the administrator permission create billing documents.
create function can_create_billing_document() returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$ select can_see_rates() $$;
revoke all on function can_see_invoice(uuid, uuid), can_see_quote(uuid), can_create_billing_document() from public;
grant execute on function can_see_invoice(uuid, uuid), can_see_quote(uuid), can_create_billing_document() to auditos_app;

do $$
declare t text;
begin
  foreach t in array array['quotes', 'quote_lines', 'invoices', 'invoice_lines', 'invoice_payments', 'outbox'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

create policy quotes_select on quotes for select using (tenant_id = app_tenant() and can_see_quote(created_by));
create policy quotes_insert on quotes for insert with check (tenant_id = app_tenant() and created_by = app_user() and can_create_billing_document());
create policy quotes_update on quotes for update using (tenant_id = app_tenant() and can_see_quote(created_by) and can_create_billing_document()) with check (tenant_id = app_tenant());
create policy quote_lines_all on quote_lines
  using (tenant_id = app_tenant() and exists (select 1 from quotes q where q.id = quote_lines.quote_id))
  with check (tenant_id = app_tenant() and exists (select 1 from quotes q where q.id = quote_lines.quote_id));

create policy invoices_select on invoices for select using (tenant_id = app_tenant() and can_see_invoice(created_by, engagement_id));
create policy invoices_insert on invoices for insert with check (tenant_id = app_tenant() and created_by = app_user() and can_create_billing_document());
create policy invoices_update on invoices for update using (tenant_id = app_tenant() and can_see_invoice(created_by, engagement_id) and can_create_billing_document()) with check (tenant_id = app_tenant());
create policy invoices_delete on invoices for delete using (tenant_id = app_tenant() and status = 'draft' and created_by = app_user());
create policy invoice_lines_all on invoice_lines
  using (tenant_id = app_tenant() and exists (select 1 from invoices i where i.id = invoice_lines.invoice_id))
  with check (tenant_id = app_tenant() and exists (select 1 from invoices i where i.id = invoice_lines.invoice_id));
create policy invoice_payments_select on invoice_payments for select
  using (tenant_id = app_tenant() and exists (select 1 from invoices i where i.id = invoice_payments.invoice_id));
create policy invoice_payments_insert on invoice_payments for insert with check (tenant_id = app_tenant());
create policy outbox_select on outbox for select using (tenant_id = app_tenant() and (created_by = app_user() or can_manage_billing()));
create policy outbox_insert on outbox for insert with check (tenant_id = app_tenant() and created_by = app_user());

grant select, insert, update on quotes to auditos_app;
grant select, insert, update, delete on quote_lines to auditos_app;
grant select, insert, update, delete on invoices to auditos_app;
grant select, insert, update, delete on invoice_lines to auditos_app;
grant select on invoice_payments to auditos_app;
grant select, insert on outbox to auditos_app;

-- A draft can be edited; an issued document cannot. Status, payment and tax-submission fields change only through the functions below.
create function invoices_guard() returns trigger language plpgsql set search_path = public, pg_temp as
$$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.number := null; new.paid_cents := 0; new.etims := null; new.issued_at := null; new.voided_at := null; new.void_reason := null;
    return new;
  end if;
  if coalesce(current_setting('app.invoicing', true), '') = 'on' then return new; end if;
  if old.status <> 'draft' then raise exception 'invoice_issued' using errcode = 'AO409'; end if;
  new.status := 'draft'; new.number := null; new.paid_cents := 0; new.etims := null; new.issued_at := null; new.voided_at := null; new.void_reason := null;
  new.created_by := old.created_by; new.tenant_id := old.tenant_id;
  return new;
end
$$;
create trigger invoices_guard before insert or update on invoices for each row execute function invoices_guard();

create function invoice_lines_guard() returns trigger language plpgsql set search_path = public, pg_temp as
$$
declare st text;
begin
  select status into st from invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if st is null then return coalesce(new, old); end if;
  if st <> 'draft' then raise exception 'invoice_issued' using errcode = 'AO409'; end if;
  return coalesce(new, old);
end
$$;
create trigger invoice_lines_guard before insert or update or delete on invoice_lines for each row execute function invoice_lines_guard();

create function quotes_guard() returns trigger language plpgsql set search_path = public, pg_temp as
$$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.number := null; new.sent_at := null; new.decided_at := null;
    return new;
  end if;
  if coalesce(current_setting('app.invoicing', true), '') = 'on' then return new; end if;
  if old.status <> 'draft' then raise exception 'quote_sent' using errcode = 'AO409'; end if;
  new.status := 'draft'; new.number := null; new.sent_at := null; new.decided_at := null; new.created_by := old.created_by;
  return new;
end
$$;
create trigger quotes_guard before insert or update on quotes for each row execute function quotes_guard();

-- Time and expenses can be marked as billed by the invoicing functions, which run for a partner or administrator.
drop policy time_select on time_entries;
create policy time_select on time_entries for select using (
  tenant_id = app_tenant()
  and (user_id = app_user() or is_active_partner()
       or (engagement_id is not null and coalesce(caller_role(), '') = 'manager' and is_engagement_member(engagement_id))
       or (coalesce(current_setting('app.invoicing', true), '') = 'on' and can_manage_billing()))
);
drop policy time_update on time_entries;
create policy time_update on time_entries for update
  using (tenant_id = app_tenant() and (user_id = app_user() or (coalesce(current_setting('app.invoicing', true), '') = 'on' and can_manage_billing())))
  with check (tenant_id = app_tenant());
drop policy expenses_select on engagement_expenses;
create policy expenses_select on engagement_expenses for select using (
  tenant_id = app_tenant()
  and (user_id = app_user() or is_active_partner() or (coalesce(caller_role(), '') = 'manager' and is_engagement_member(engagement_id))
       or (coalesce(current_setting('app.invoicing', true), '') = 'on' and can_manage_billing()))
);
drop policy expenses_update on engagement_expenses;
create policy expenses_update on engagement_expenses for update
  using (tenant_id = app_tenant() and (user_id = app_user() or (coalesce(current_setting('app.invoicing', true), '') = 'on' and can_manage_billing())))
  with check (tenant_id = app_tenant());


-- Issues a draft: number, billed time and expenses, frozen document, one audit entry.
create function invoice_issue(p_id uuid, p_prefix text, p_terms_days integer) returns table (number text, issue_date date, due_date date)
language plpgsql security definer set search_path = public, pg_temp as
$$
declare inv invoices%rowtype; n text; today date := (now() at time zone 'Africa/Nairobi')::date; ids uuid[]; found_n integer; cname text;
begin
  if not can_manage_billing() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  perform set_config('app.invoicing', 'on', true);
  select * into inv from invoices where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if inv.status <> 'draft' then raise exception 'invoice_issued' using errcode = 'AO409'; end if;
  if not exists (select 1 from invoice_lines where invoice_id = p_id) or inv.total_cents <= 0 then raise exception 'invoice_empty' using errcode = 'AO422'; end if;

  select coalesce(array_agg(x), '{}') into ids from (select unnest(source_ids) x from invoice_lines where invoice_id = p_id and source = 'time') s;
  if cardinality(ids) > 0 then
    update time_entries set invoice_id = p_id where id = any (ids) and invoice_id is null;
    get diagnostics found_n = row_count;
    if found_n <> cardinality(ids) then raise exception 'already_billed' using errcode = 'AO409'; end if;
  end if;
  select coalesce(array_agg(x), '{}') into ids from (select unnest(source_ids) x from invoice_lines where invoice_id = p_id and source = 'expense') s;
  if cardinality(ids) > 0 then
    update engagement_expenses set invoice_id = p_id where id = any (ids) and invoice_id is null;
    get diagnostics found_n = row_count;
    if found_n <> cardinality(ids) then raise exception 'already_billed' using errcode = 'AO409'; end if;
  end if;

  n := next_document_number('invoice', p_prefix);
  update invoices set number = n, status = 'sent', issue_date = today, due_date = today + greatest(p_terms_days, 0), issued_at = now() where id = p_id;
  select name into cname from clients where id = inv.client_id;
  perform audit_append_internal(app_tenant(), app_user(), 'invoice.issued', 'invoice', p_id::text,
    jsonb_build_object('number', n, 'clientId', inv.client_id, 'clientName', cname, 'total', inv.total_cents));
  perform set_config('app.invoicing', 'off', true);
  return query select n, today, today + greatest(p_terms_days, 0);
end
$$;

create function invoice_set_etims(p_id uuid, p_etims jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if not can_manage_billing() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  perform set_config('app.invoicing', 'on', true);
  update invoices set etims = p_etims where id = p_id and status <> 'draft';
  if not found then perform set_config('app.invoicing', 'off', true); raise exception 'not_found' using errcode = 'AO404'; end if;
  perform set_config('app.invoicing', 'off', true);
end
$$;

create function invoice_record_payment(p_id uuid, p_amount bigint, p_paid_on date, p_method text, p_reference text) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare inv invoices%rowtype; new_paid bigint; cname text;
begin
  if not can_manage_billing() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  perform set_config('app.invoicing', 'on', true);
  select * into inv from invoices where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if inv.status not in ('sent', 'part_paid') then raise exception 'invoice_not_payable' using errcode = 'AO409'; end if;
  if p_amount <= 0 or inv.paid_cents + p_amount > inv.total_cents then raise exception 'invalid_amount' using errcode = 'AO422'; end if;
  new_paid := inv.paid_cents + p_amount;
  insert into invoice_payments (tenant_id, invoice_id, amount_cents, paid_on, method, reference, recorded_by)
  values (inv.tenant_id, p_id, p_amount, p_paid_on, p_method, nullif(trim(p_reference), ''), app_user());
  update invoices set paid_cents = new_paid, status = case when new_paid = total_cents then 'paid' else 'part_paid' end where id = p_id;
  select name into cname from clients where id = inv.client_id;
  perform audit_append_internal(app_tenant(), app_user(), 'invoice.payment_recorded', 'invoice', p_id::text,
    jsonb_build_object('number', inv.number, 'clientId', inv.client_id, 'clientName', cname, 'amount', p_amount, 'method', p_method, 'fullyPaid', new_paid = inv.total_cents));
  perform set_config('app.invoicing', 'off', true);
end
$$;

create function invoice_void(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare inv invoices%rowtype; cname text;
begin
  if not can_manage_billing() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required' using errcode = 'AO422'; end if;
  perform set_config('app.invoicing', 'on', true);
  select * into inv from invoices where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if inv.status not in ('sent') then raise exception 'invoice_not_voidable' using errcode = 'AO409'; end if;
  update time_entries set invoice_id = null where invoice_id = p_id;
  update engagement_expenses set invoice_id = null where invoice_id = p_id;
  update invoices set status = 'void', voided_at = now(), void_reason = trim(p_reason) where id = p_id;
  select name into cname from clients where id = inv.client_id;
  perform audit_append_internal(app_tenant(), app_user(), 'invoice.voided', 'invoice', p_id::text,
    jsonb_build_object('number', inv.number, 'clientId', inv.client_id, 'clientName', cname, 'reason', trim(p_reason)));
  perform set_config('app.invoicing', 'off', true);
end
$$;

create function quote_send(p_id uuid, p_prefix text) returns text
language plpgsql security definer set search_path = public, pg_temp as
$$
declare q quotes%rowtype; n text; cname text;
begin
  perform set_config('app.invoicing', 'on', true);
  select * into q from quotes where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if q.created_by <> app_user() and not can_manage_billing() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if q.status <> 'draft' then raise exception 'quote_sent' using errcode = 'AO409'; end if;
  if q.total_cents <= 0 then raise exception 'invoice_empty' using errcode = 'AO422'; end if;
  n := next_document_number('quote', p_prefix);
  update quotes set number = n, status = 'sent', sent_at = now() where id = p_id;
  select coalesce((select name from clients where id = q.client_id), (select name from prospects where id = q.prospect_id)) into cname;
  perform audit_append_internal(app_tenant(), app_user(), 'quote.sent', 'quote', p_id::text,
    jsonb_build_object('number', n, 'subject', cname, 'total', q.total_cents));
  perform set_config('app.invoicing', 'off', true);
  return n;
end
$$;

create function quote_decide(p_id uuid, p_decision text) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare q quotes%rowtype; cname text;
begin
  if p_decision not in ('accepted', 'declined') then raise exception 'invalid_decision' using errcode = 'AO422'; end if;
  perform set_config('app.invoicing', 'on', true);
  select * into q from quotes where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if q.created_by <> app_user() and not can_manage_billing() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if q.status <> 'sent' then raise exception 'quote_not_open' using errcode = 'AO409'; end if;
  update quotes set status = p_decision, decided_at = now() where id = p_id;
  select coalesce((select name from clients where id = q.client_id), (select name from prospects where id = q.prospect_id)) into cname;
  perform audit_append_internal(app_tenant(), app_user(), 'quote.' || case p_decision when 'accepted' then 'accepted' else 'declined' end, 'quote', p_id::text,
    jsonb_build_object('number', q.number, 'subject', cname, 'total', q.total_cents));
  perform set_config('app.invoicing', 'off', true);
end
$$;

revoke all on function invoice_issue(uuid, text, integer), invoice_set_etims(uuid, jsonb), invoice_record_payment(uuid, bigint, date, text, text), invoice_void(uuid, text),
  quote_send(uuid, text), quote_decide(uuid, text) from public;
grant execute on function invoice_issue(uuid, text, integer), invoice_set_etims(uuid, jsonb), invoice_record_payment(uuid, bigint, date, text, text), invoice_void(uuid, text),
  quote_send(uuid, text), quote_decide(uuid, text) to auditos_app;
