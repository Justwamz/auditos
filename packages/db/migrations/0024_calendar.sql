-- The shared calendar. An event is seen by the people it concerns, by partners, and by managers whose teams it touches.
-- Writes go through functions that also record a plain-English audit event; the application role can only read.

create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  title text not null check (length(title) between 2 and 200),
  kind text not null check (kind in ('meeting', 'fieldwork', 'deadline', 'leave', 'training', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  location text check (location is null or length(location) <= 200),
  notes text check (notes is null or length(notes) <= 2000),
  client_id uuid,
  engagement_id uuid,
  attendee_ids uuid[] not null default '{}',
  created_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references users (id),
  check (ends_at >= starts_at),
  check (cardinality(attendee_ids) <= 50),
  foreign key (tenant_id, client_id) references clients (tenant_id, id),
  foreign key (tenant_id, engagement_id) references engagements (tenant_id, id)
);
create index calendar_events_range on calendar_events (tenant_id, starts_at);

-- Who may see an event: the person who made it, the people invited, members of the engagement it belongs to, partners,
-- and a manager when the creator or an invitee shares an engagement team with that manager.
create function calendar_can_see(p_created_by uuid, p_attendees uuid[], p_engagement uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select app_user() = p_created_by
      or app_user() = any (p_attendees)
      or (p_engagement is not null and is_engagement_member(p_engagement))
      or is_active_partner()
      or (
        caller_role() = 'manager' and exists (
          select 1 from engagement_members a
            join engagement_members b on b.engagement_id = a.engagement_id and b.tenant_id = a.tenant_id
           where a.tenant_id = app_tenant() and a.user_id = app_user()
             and (b.user_id = p_created_by or b.user_id = any (p_attendees))
        )
      )
$$;
revoke all on function calendar_can_see(uuid, uuid[], uuid) from public;
grant execute on function calendar_can_see(uuid, uuid[], uuid) to auditos_app;

alter table calendar_events enable row level security;
alter table calendar_events force row level security;
create policy calendar_select on calendar_events for select
  using (tenant_id = app_tenant() and calendar_can_see(created_by, attendee_ids, engagement_id));
create policy calendar_insert on calendar_events for insert with check (tenant_id = app_tenant());
create policy calendar_update on calendar_events for update
  using (tenant_id = app_tenant() and calendar_can_see(created_by, attendee_ids, engagement_id)) with check (tenant_id = app_tenant());
grant select on calendar_events to auditos_app;

create function calendar_check(p_attendees uuid[], p_client uuid, p_engagement uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if coalesce(caller_role(), 'firm_admin') = 'firm_admin' then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if exists (
    select 1 from unnest(p_attendees) a
     where not exists (select 1 from memberships m join users u on u.id = m.user_id where m.tenant_id = app_tenant() and m.user_id = a and m.active and u.active and m.role <> 'firm_admin')
  ) then raise exception 'invalid_attendee' using errcode = 'AO422'; end if;
  if p_client is not null and not exists (select 1 from clients where id = p_client) then raise exception 'client_not_found' using errcode = 'AO404'; end if;
  if p_engagement is not null and not is_engagement_member(p_engagement) then raise exception 'not_found' using errcode = 'AO404'; end if;
end
$$;

create function calendar_create(
  p_title text, p_kind text, p_starts timestamptz, p_ends timestamptz, p_all_day boolean, p_location text, p_notes text,
  p_client uuid, p_engagement uuid, p_attendees uuid[]
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as
$$
declare v uuid := gen_random_uuid(); att uuid[] := coalesce((select array_agg(distinct a) from unnest(p_attendees) a), '{}');
begin
  perform calendar_check(att, p_client, p_engagement);
  insert into calendar_events (id, tenant_id, title, kind, starts_at, ends_at, all_day, location, notes, client_id, engagement_id, attendee_ids, created_by)
  values (v, app_tenant(), trim(p_title), p_kind, p_starts, p_ends, coalesce(p_all_day, false), nullif(trim(p_location), ''), nullif(trim(p_notes), ''), p_client, p_engagement, att, app_user());
  perform audit_append_internal(app_tenant(), app_user(), 'calendar.scheduled', 'calendar_event', v::text,
    jsonb_build_object('title', trim(p_title), 'kind', p_kind, 'startsAt', p_starts, 'engagementId', p_engagement, 'clientId', p_client));
  return v;
end
$$;

create function calendar_update(
  p_id uuid, p_title text, p_kind text, p_starts timestamptz, p_ends timestamptz, p_all_day boolean, p_location text, p_notes text,
  p_client uuid, p_engagement uuid, p_attendees uuid[]
) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare e calendar_events%rowtype; att uuid[] := coalesce((select array_agg(distinct a) from unnest(p_attendees) a), '{}');
begin
  select * into e from calendar_events where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if e.created_by <> app_user() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if e.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'AO409'; end if;
  perform calendar_check(att, p_client, p_engagement);
  update calendar_events set title = trim(p_title), kind = p_kind, starts_at = p_starts, ends_at = p_ends, all_day = coalesce(p_all_day, false),
         location = nullif(trim(p_location), ''), notes = nullif(trim(p_notes), ''), client_id = p_client, engagement_id = p_engagement, attendee_ids = att
   where id = p_id;
  perform audit_append_internal(app_tenant(), app_user(), 'calendar.changed', 'calendar_event', p_id::text,
    jsonb_build_object('title', trim(p_title), 'kind', p_kind, 'startsAt', p_starts, 'engagementId', p_engagement, 'clientId', p_client));
end
$$;

-- The person who made it, or a partner, can cancel. The event stays on record, marked cancelled.
create function calendar_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare e calendar_events%rowtype;
begin
  select * into e from calendar_events where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if e.created_by <> app_user() and not is_active_partner() then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if e.cancelled_at is not null then raise exception 'event_cancelled' using errcode = 'AO409'; end if;
  update calendar_events set cancelled_at = now(), cancelled_by = app_user() where id = p_id;
  perform audit_append_internal(app_tenant(), app_user(), 'calendar.cancelled', 'calendar_event', p_id::text,
    jsonb_build_object('title', e.title, 'kind', e.kind, 'startsAt', e.starts_at, 'engagementId', e.engagement_id, 'clientId', e.client_id));
end
$$;

revoke all on function calendar_check(uuid[], uuid, uuid), calendar_create(text, text, timestamptz, timestamptz, boolean, text, text, uuid, uuid, uuid[]),
  calendar_update(uuid, text, text, timestamptz, timestamptz, boolean, text, text, uuid, uuid, uuid[]), calendar_cancel(uuid) from public;
grant execute on function calendar_create(text, text, timestamptz, timestamptz, boolean, text, text, uuid, uuid, uuid[]),
  calendar_update(uuid, text, text, timestamptz, timestamptz, boolean, text, text, uuid, uuid, uuid[]), calendar_cancel(uuid) to auditos_app;
