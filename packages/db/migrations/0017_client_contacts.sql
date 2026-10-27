-- People at a client, with their personal details encrypted by the application (nothing readable in the database).
create table client_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  client_id uuid not null,
  name text not null check (length(name) between 2 and 120),
  position text check (position is null or length(position) <= 120),
  phone_enc text,
  email_enc text,
  id_number_enc text,
  kra_pin_enc text,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, client_id) references clients (tenant_id, id)
);
create index client_contacts_client on client_contacts (client_id);

alter table client_contacts enable row level security;
alter table client_contacts force row level security;
-- A contact is visible to whoever can see its client (the subquery runs under the clients policy).
create policy client_contacts_select on client_contacts for select
  using (tenant_id = app_tenant() and exists (select 1 from clients c where c.id = client_contacts.client_id));
create policy client_contacts_insert on client_contacts for insert
  with check (tenant_id = app_tenant() and exists (select 1 from clients c where c.id = client_contacts.client_id));
create policy client_contacts_update on client_contacts for update
  using (tenant_id = app_tenant() and exists (select 1 from clients c where c.id = client_contacts.client_id))
  with check (tenant_id = app_tenant());
grant select, insert, update (name, position, phone_enc, email_enc, id_number_enc, kra_pin_enc) on client_contacts to auditos_app;
