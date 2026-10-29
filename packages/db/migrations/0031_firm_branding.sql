-- Firm branding: a logo (immutable versions), contact details and two brand colours, set only by the firm administrator
-- (the firm_admin role or the administrator permission, as is_tenant_admin() defines it). Every member of the firm can read them.
-- Issued invoices and sent quotations keep a write-once copy of the letterhead they were issued with.

create function can_edit_branding() returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$ select is_tenant_admin() $$;
revoke all on function can_edit_branding() from public;
grant execute on function can_edit_branding() to auditos_app;

-- Logo versions are never changed or deleted: a document may refer to any of them for as long as it exists.
create table firm_logos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  content_type text not null check (content_type in ('image/png', 'image/jpeg')),
  bytes bytea not null check (octet_length(bytes) between 1 and 1048576),
  width integer not null check (width between 1 and 2000),
  height integer not null check (height between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- The type is checked from the bytes themselves, not only from what the caller says.
  check ((content_type = 'image/png' and substring(bytes from 1 for 8) = '\x89504e470d0a1a0a'::bytea)
      or (content_type = 'image/jpeg' and substring(bytes from 1 for 3) = '\xffd8ff'::bytea))
);

create table firm_branding (
  tenant_id uuid primary key references tenants (id),
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color text check (secondary_color is null or secondary_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_id uuid,
  phone text check (phone is null or phone ~ '^[0-9 +()\[\]-]{1,30}$'),
  email text check (email is null or (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  website text check (website is null or (length(website) <= 300 and website ~* '^https?://[^[:space:]]+$')),
  footer_note text check (footer_note is null or length(footer_note) <= 300),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, logo_id) references firm_logos (tenant_id, id)
);

alter table firm_logos enable row level security;
alter table firm_logos force row level security;
alter table firm_branding enable row level security;
alter table firm_branding force row level security;

-- Anyone in the firm reads; writing happens only inside the functions below (the app role holds no write privilege, and the
-- policies also require the administrator, so the owner role running a function is held to the same rule).
create policy firm_logos_select on firm_logos for select using (tenant_id = app_tenant());
create policy firm_logos_insert on firm_logos for insert with check (tenant_id = app_tenant() and can_edit_branding());
create policy firm_branding_select on firm_branding for select using (tenant_id = app_tenant());
create policy firm_branding_insert on firm_branding for insert with check (tenant_id = app_tenant() and can_edit_branding());
create policy firm_branding_update on firm_branding for update using (tenant_id = app_tenant() and can_edit_branding()) with check (tenant_id = app_tenant());

grant select on firm_logos, firm_branding to auditos_app;

alter table invoices add column letterhead jsonb check (letterhead is null or jsonb_typeof(letterhead) = 'object');
alter table quotes add column letterhead jsonb check (letterhead is null or jsonb_typeof(letterhead) = 'object');

-- The letterhead is null on a draft, written once when the document is issued or sent, and never changed afterwards.
-- Only invoice_set_letterhead and quote_set_letterhead (which switch app.letterhead on) may write it, and even then only
-- for someone who may issue the invoice (or send the quotation) and only while the document is in the state it has right
-- after issuing or sending. Setting the flag in a raw session is therefore not enough.
create function letterhead_guard() returns trigger language plpgsql set search_path = public, pg_temp as
$$
begin
  if tg_op = 'INSERT' then
    new.letterhead := null;
    return new;
  end if;
  if new.letterhead is not distinct from old.letterhead then return new; end if;
  if old.letterhead is not null then raise exception 'letterhead_frozen' using errcode = 'AO409'; end if;
  if coalesce(current_setting('app.letterhead', true), '') <> 'on' or old.status <> 'sent' then
    raise exception 'letterhead_forbidden' using errcode = 'AO409';
  end if;
  if tg_table_name = 'quotes' then
    if old.created_by <> app_user() and not can_manage_billing() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  elsif not can_manage_billing() then
    raise exception 'forbidden' using errcode = 'AO403';
  end if;
  return new;
end
$$;
create trigger invoices_letterhead_guard before insert or update on invoices for each row execute function letterhead_guard();
create trigger quotes_letterhead_guard before insert or update on quotes for each row execute function letterhead_guard();

-- Saves the firm branding as a whole (blank values are stored as nothing). The list of what changed is worked out here by
-- comparing with the saved row, never taken from the caller; nothing is recorded when nothing changed. The audit entry
-- carries the list, and the old and new colour codes when a colour changed (a logo is only named as changed).
-- p_branding keys: primaryColor, secondaryColor, logoId, phone, email, website, footerNote (an absent key keeps the saved value).
create function branding_save(p_branding jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  o firm_branding%rowtype;
  v_logo uuid; v_pc text; v_sc text; v_phone text; v_email text; v_web text; v_note text;
  v_changed text[] := '{}';
  v_detail jsonb;
begin
  if not can_edit_branding() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if p_branding is null or jsonb_typeof(p_branding) <> 'object' then raise exception 'invalid_branding' using errcode = 'AO422'; end if;
  -- One writer at a time per firm, so two overlapping saves (a logo upload and a details save) merge instead of overwriting.
  perform pg_advisory_xact_lock(hashtextextended('branding:' || app_tenant()::text, 0));
  select * into o from firm_branding where tenant_id = app_tenant() for update;
  -- A key that is absent keeps what is saved; a key that is present (even null or blank) replaces it.
  v_logo := case when p_branding ? 'logoId' then nullif(trim(p_branding ->> 'logoId'), '')::uuid else o.logo_id end;
  v_pc := case when p_branding ? 'primaryColor' then lower(nullif(trim(p_branding ->> 'primaryColor'), '')) else o.primary_color end;
  v_sc := case when p_branding ? 'secondaryColor' then lower(nullif(trim(p_branding ->> 'secondaryColor'), '')) else o.secondary_color end;
  v_phone := case when p_branding ? 'phone' then nullif(trim(p_branding ->> 'phone'), '') else o.phone end;
  v_email := case when p_branding ? 'email' then nullif(trim(p_branding ->> 'email'), '') else o.email end;
  v_web := case when p_branding ? 'website' then nullif(trim(p_branding ->> 'website'), '') else o.website end;
  v_note := case when p_branding ? 'footerNote' then nullif(trim(p_branding ->> 'footerNote'), '') else o.footer_note end;

  insert into firm_branding (tenant_id, primary_color, secondary_color, logo_id, phone, email, website, footer_note, updated_at)
  values (app_tenant(), v_pc, v_sc, v_logo, v_phone, v_email, v_web, v_note, now())
  on conflict (tenant_id) do update set
    primary_color = excluded.primary_color, secondary_color = excluded.secondary_color, logo_id = excluded.logo_id,
    phone = excluded.phone, email = excluded.email, website = excluded.website, footer_note = excluded.footer_note, updated_at = now();

  if v_logo is distinct from o.logo_id then v_changed := array_append(v_changed, 'logo'); end if;
  if v_pc is distinct from o.primary_color then v_changed := array_append(v_changed, 'primaryColor'); end if;
  if v_sc is distinct from o.secondary_color then v_changed := array_append(v_changed, 'secondaryColor'); end if;
  if v_phone is distinct from o.phone then v_changed := array_append(v_changed, 'phone'); end if;
  if v_email is distinct from o.email then v_changed := array_append(v_changed, 'email'); end if;
  if v_web is distinct from o.website then v_changed := array_append(v_changed, 'website'); end if;
  if v_note is distinct from o.footer_note then v_changed := array_append(v_changed, 'footerNote'); end if;
  if cardinality(v_changed) = 0 then return; end if;

  v_detail := jsonb_build_object('changed', to_jsonb(v_changed));
  if 'primaryColor' = any (v_changed) then v_detail := v_detail || jsonb_build_object('primaryColor', jsonb_build_object('old', o.primary_color, 'new', v_pc)); end if;
  if 'secondaryColor' = any (v_changed) then v_detail := v_detail || jsonb_build_object('secondaryColor', jsonb_build_object('old', o.secondary_color, 'new', v_sc)); end if;
  perform audit_append_internal(app_tenant(), app_user(), 'branding.updated', 'branding', app_tenant()::text, v_detail);
end
$$;

create function branding_add_logo(p_type text, p_bytes bytea, p_w integer, p_h integer) returns uuid
language plpgsql security definer set search_path = public, pg_temp as
$$
declare v_id uuid;
begin
  if not can_edit_branding() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  insert into firm_logos (tenant_id, content_type, bytes, width, height) values (app_tenant(), p_type, p_bytes, p_w, p_h) returning id into v_id;
  return v_id;
end
$$;

-- Write the letterhead of a document that has just been issued (or sent). The API calls these in the same transaction as
-- invoice_issue / quote_send; they accept only status 'sent', so a letterhead can never be attached later to a paid, void,
-- accepted or declined document. A draft has none and a set letterhead never changes.
create function invoice_set_letterhead(p_id uuid, p_letterhead jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare inv invoices%rowtype;
begin
  if not can_manage_billing() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  select * into inv from invoices where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if p_letterhead is null or jsonb_typeof(p_letterhead) <> 'object' then raise exception 'invalid_letterhead' using errcode = 'AO422'; end if;
  if inv.status <> 'sent' then raise exception 'invoice_not_just_issued' using errcode = 'AO409'; end if;
  if inv.letterhead is not null then raise exception 'letterhead_frozen' using errcode = 'AO409'; end if;
  perform set_config('app.invoicing', 'on', true);
  perform set_config('app.letterhead', 'on', true);
  update invoices set letterhead = p_letterhead where id = p_id;
  perform set_config('app.letterhead', 'off', true);
  perform set_config('app.invoicing', 'off', true);
end
$$;

create function quote_set_letterhead(p_id uuid, p_letterhead jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare q quotes%rowtype;
begin
  select * into q from quotes where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if q.created_by <> app_user() and not can_manage_billing() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if p_letterhead is null or jsonb_typeof(p_letterhead) <> 'object' then raise exception 'invalid_letterhead' using errcode = 'AO422'; end if;
  if q.status <> 'sent' then raise exception 'quote_not_just_sent' using errcode = 'AO409'; end if;
  if q.letterhead is not null then raise exception 'letterhead_frozen' using errcode = 'AO409'; end if;
  perform set_config('app.invoicing', 'on', true);
  perform set_config('app.letterhead', 'on', true);
  update quotes set letterhead = p_letterhead where id = p_id;
  perform set_config('app.letterhead', 'off', true);
  perform set_config('app.invoicing', 'off', true);
end
$$;

revoke all on function letterhead_guard() from public;
revoke all on function branding_save(jsonb), branding_add_logo(text, bytea, integer, integer),
  invoice_set_letterhead(uuid, jsonb), quote_set_letterhead(uuid, jsonb) from public;
grant execute on function branding_save(jsonb), branding_add_logo(text, bytea, integer, integer),
  invoice_set_letterhead(uuid, jsonb), quote_set_letterhead(uuid, jsonb) to auditos_app;
