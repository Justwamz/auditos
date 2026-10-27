-- Bank statements read from a client's PDF, CSV or Excel file. The entries are kept encrypted (the app encrypts them before
-- they reach the database); only the account's last four digits are ever stored. Visible to the engagement team, and to
-- partners for reading. Once someone has confirmed the statement was read completely it can no longer be changed or removed.

create table bank_statements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  engagement_id uuid not null,
  uploaded_by uuid not null references users (id),
  filename text not null check (length(filename) between 1 and 200),
  source text not null check (source in ('pdf', 'csv', 'xlsx')),
  bank_name text check (bank_name is null or length(bank_name) <= 60),
  account_last4 text check (account_last4 is null or account_last4 ~ '^[0-9]{1,4}$'),
  period_from date,
  period_to date,
  opening_cents bigint,
  closing_cents bigint,
  txn_count integer not null check (txn_count >= 0),
  integrity_status text not null check (integrity_status in ('verified', 'broken', 'unverified')),
  integrity_messages jsonb not null default '[]'::jsonb,
  content_enc text not null,
  confirmed_at timestamptz,
  confirmed_by uuid references users (id),
  acknowledged_reason text check (acknowledged_reason is null or length(acknowledged_reason) between 5 and 500),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, engagement_id) references engagements (tenant_id, id)
);
create index bank_statements_engagement on bank_statements (engagement_id, created_at);

create function bank_statements_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := app_user();
    new.confirmed_at := null;
    new.confirmed_by := null;
    new.acknowledged_reason := null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.confirmed_at is not null then raise exception 'statement_confirmed' using errcode = 'AO409'; end if;
    return old;
  end if;
  if old.confirmed_at is not null then raise exception 'statement_confirmed' using errcode = 'AO409'; end if;
  -- Only confirming is allowed: nothing else about the statement may change.
  new.tenant_id := old.tenant_id;
  new.engagement_id := old.engagement_id;
  new.uploaded_by := old.uploaded_by;
  new.content_enc := old.content_enc;
  new.integrity_status := old.integrity_status;
  new.integrity_messages := old.integrity_messages;
  new.confirmed_at := now();
  new.confirmed_by := app_user();
  if old.integrity_status <> 'verified' and new.acknowledged_reason is null then
    raise exception 'acknowledgement_required' using errcode = 'AO422';
  end if;
  if old.integrity_status = 'verified' then new.acknowledged_reason := null; end if;
  return new;
end
$$;
create trigger bank_statements_guard before insert or update or delete on bank_statements for each row execute function bank_statements_guard();

alter table bank_statements enable row level security;
alter table bank_statements force row level security;
create policy bank_statements_select on bank_statements for select using (tenant_id = app_tenant() and can_view_engagement(engagement_id));
create policy bank_statements_insert on bank_statements for insert with check (tenant_id = app_tenant() and is_engagement_member(engagement_id));
create policy bank_statements_update on bank_statements for update using (tenant_id = app_tenant() and is_engagement_member(engagement_id)) with check (tenant_id = app_tenant());
create policy bank_statements_delete on bank_statements for delete using (tenant_id = app_tenant() and is_engagement_member(engagement_id));

grant select, delete on bank_statements to auditos_app;
grant insert (tenant_id, engagement_id, filename, source, bank_name, account_last4, period_from, period_to, opening_cents, closing_cents, txn_count, integrity_status, integrity_messages, content_enc) on bank_statements to auditos_app;
grant update (acknowledged_reason) on bank_statements to auditos_app;
