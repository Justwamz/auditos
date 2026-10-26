-- Review notes, and sign-off rules that depend on them (plus EQR final sign-off).

create table review_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  item_id uuid not null references wp_items (id),
  engagement_id uuid not null,
  raised_by uuid not null references users (id),
  text text not null check (length(text) between 3 and 2000),
  status text not null default 'open' check (status in ('open','cleared','accepted')),
  response text,
  resolved_by uuid references users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, engagement_id) references engagements (tenant_id, id)
);
create index review_notes_item on review_notes (item_id);
create index review_notes_engagement on review_notes (engagement_id, status);

alter table review_notes enable row level security;
alter table review_notes force row level security;
create policy review_notes_select on review_notes for select using (tenant_id = app_tenant() and is_engagement_member(engagement_id));
create policy review_notes_insert on review_notes for insert with check (tenant_id = app_tenant());
create policy review_notes_update on review_notes for update using (tenant_id = app_tenant()) with check (tenant_id = app_tenant());
grant select on review_notes to auditos_app;

create function review_note_create(p_item uuid, p_text text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as
$$
declare it wp_items%rowtype; caller_role text; v uuid;
begin
  select * into it from wp_items where id = p_item;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  select role into caller_role from memberships where tenant_id = app_tenant() and user_id = app_user() and active;
  if caller_role not in ('manager', 'partner', 'eqr', 'quality_officer') then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if engagement_is_locked(it.engagement_id) then raise exception 'engagement is locked' using errcode = 'AO409'; end if;
  if length(trim(coalesce(p_text, ''))) < 3 then raise exception 'text_required' using errcode = 'AO422'; end if;
  insert into review_notes (tenant_id, item_id, engagement_id, raised_by, text)
  values (it.tenant_id, it.id, it.engagement_id, app_user(), trim(p_text)) returning id into v;
  return v;
end
$$;

-- p_status is 'cleared' or 'accepted'. Whoever last edited the item cannot resolve notes on it.
create function review_note_resolve(p_note uuid, p_status text, p_response text) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare n review_notes%rowtype; it wp_items%rowtype; caller_role text; last_editor uuid;
begin
  select * into n from review_notes where id = p_note;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if n.status <> 'open' then raise exception 'note_not_open' using errcode = 'AO409'; end if;
  select * into it from wp_items where id = n.item_id;
  if engagement_is_locked(n.engagement_id) then raise exception 'engagement is locked' using errcode = 'AO409'; end if;
  select role into caller_role from memberships where tenant_id = app_tenant() and user_id = app_user() and active;
  if p_status = 'cleared' and caller_role not in ('manager', 'partner', 'eqr', 'quality_officer') then
    raise exception 'forbidden' using errcode = 'AO403';
  end if;
  if p_status = 'accepted' and caller_role not in ('manager', 'partner') then
    raise exception 'forbidden' using errcode = 'AO403';
  end if;
  if p_status not in ('cleared', 'accepted') then raise exception 'invalid_status' using errcode = 'AO422'; end if;
  select edited_by into last_editor from wp_item_versions where item_id = it.id and version = it.version;
  if last_editor = app_user() then raise exception 'cannot resolve notes on own work' using errcode = 'AO403'; end if;
  if length(trim(coalesce(p_response, ''))) < 3 then raise exception 'response_required' using errcode = 'AO422'; end if;
  update review_notes set status = p_status, response = trim(p_response), resolved_by = app_user(), resolved_at = now() where id = n.id;
end
$$;

create function open_review_notes(p_engagement uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as
$$ select count(*)::integer from review_notes where engagement_id = p_engagement and status = 'open' and tenant_id = app_tenant() $$;

-- item_signoff, extended: open review notes block partner sign-off; an EQR gives the final sign-off on eqr_review items.
create or replace function item_signoff(p_item uuid, p_level text, p_expected_hash text) returns text
language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  it wp_items%rowtype;
  last_editor uuid;
  caller_role text;
  need text;
  target text;
begin
  select * into it from wp_items where id = p_item;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if engagement_is_locked(it.engagement_id) then raise exception 'engagement is locked' using errcode = 'AO409'; end if;
  if it.deleted_at is not null then raise exception 'item_deleted' using errcode = 'AO409'; end if;
  if it.content_hash <> p_expected_hash then raise exception 'stale_content' using errcode = 'AO409'; end if;

  select role into caller_role from memberships where tenant_id = app_tenant() and user_id = app_user() and active;
  select edited_by into last_editor from wp_item_versions where item_id = it.id and version = it.version;

  if p_level = 'prepared' then
    need := 'draft'; target := 'prepared';
  elsif p_level = 'manager' then
    need := 'prepared'; target := 'manager_reviewed';
    if caller_role not in ('manager', 'partner') then raise exception 'forbidden' using errcode = 'AO403'; end if;
  elsif p_level = 'partner' then
    need := 'manager_reviewed'; target := 'partner_approved';
    if caller_role <> 'partner' and not (caller_role = 'eqr' and it.kind = 'eqr_review') then
      raise exception 'forbidden' using errcode = 'AO403';
    end if;
  else
    raise exception 'invalid_level' using errcode = 'AO422';
  end if;
  if p_level <> 'prepared' and last_editor = app_user() then
    raise exception 'cannot review own work' using errcode = 'AO403';
  end if;
  if it.state <> need then raise exception 'invalid_item_state' using errcode = 'AO409'; end if;
  if p_level = 'partner' and exists (select 1 from review_notes where item_id = it.id and status = 'open') then
    raise exception 'open_review_notes' using errcode = 'AO409';
  end if;

  insert into signoffs (tenant_id, item_id, level, user_id, version, content_hash)
  values (it.tenant_id, it.id, p_level, app_user(), it.version, it.content_hash);
  perform set_config('app.signoff', 'on', true);
  update wp_items set state = target where id = it.id;
  perform set_config('app.signoff', 'off', true);
  return target;
end
$$;

do $$
declare f text;
begin
  foreach f in array array['review_note_create(uuid, text)', 'review_note_resolve(uuid, text, text)', 'open_review_notes(uuid)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to auditos_app', f);
  end loop;
end
$$;

select audit_attach('review_notes');
