-- The application may now also record views and personal-data reveals. System events still come from the database.
create or replace function audit_append(p_action text, p_type text, p_id text, p_detail jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if app_tenant() is null then raise exception 'audit: tenant context required'; end if;
  if p_action !~ '^(auth|evidence|export|view|pii)\.[a-z0-9_]{1,40}$' then
    raise exception 'audit: action not allowed' using errcode = 'AO403';
  end if;
  perform audit_append_internal(app_tenant(), app_user(), p_action, p_type, p_id, p_detail);
end
$$;

-- Repeated views by the same person of the same thing within a few minutes are logged once.
create index audit_events_recent_view on audit_events (tenant_id, actor_user_id, action, entity_id, at desc);

-- Events describe themselves: when written, each one is given the engagement, client and paper it concerns, as they were
-- named at that moment. Lookups follow the row-level rules of whoever is acting, so a system event simply gets less context.
create function audit_context(p_type text, p_id text, p_detail jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as
$$
declare
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  d jsonb := coalesce(p_detail, '{}'::jsonb);
  ctx jsonb := '{}'::jsonb;
  itm uuid; eng uuid; cid uuid; cname text; ititle text; ikind text; raw text;
begin
  raw := coalesce(d ->> 'item_id', d -> 'new' ->> 'item_id', d -> 'old' ->> 'item_id');
  if p_type = 'wp_item' and p_id ~ uuid_re then itm := p_id::uuid;
  elsif raw ~ uuid_re then itm := raw::uuid;
  end if;
  if itm is not null then
    select engagement_id, title, kind into eng, ititle, ikind from wp_items where id = itm;
    if found then ctx := ctx || jsonb_build_object('itemTitle', ititle, 'itemKind', ikind); end if;
  end if;
  if eng is null then
    raw := coalesce(d ->> 'engagementId', d ->> 'engagement_id', d -> 'new' ->> 'engagement_id', d -> 'old' ->> 'engagement_id');
    if p_type in ('engagement', 'engagements') and p_id ~ uuid_re then eng := p_id::uuid;
    elsif raw ~ uuid_re then eng := raw::uuid;
    end if;
  end if;
  if eng is not null then
    select c.id, c.name into cid, cname from engagements e join clients c on c.id = e.client_id where e.id = eng;
    ctx := ctx || jsonb_build_object('engagementId', eng);
  elsif p_type in ('client', 'clients') and p_id ~ uuid_re then
    select id, name into cid, cname from clients where id = p_id::uuid;
  end if;
  if cid is not null then ctx := ctx || jsonb_build_object('clientId', cid, 'clientName', cname); end if;
  return ctx;
end
$$;
revoke all on function audit_context(text, text, jsonb) from public;

create or replace function audit_append_internal(
  p_tenant uuid, p_actor uuid, p_action text, p_type text, p_id text, p_detail jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  last_seq bigint;
  last_hash text;
  next_seq bigint;
  prev text;
  ts timestamptz := clock_timestamp();
  detail jsonb;
begin
  if p_tenant is null then
    raise exception 'audit: tenant context required';
  end if;
  detail := audit_context(p_type, p_id, p_detail) || coalesce(p_detail, '{}'::jsonb);
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text, 0));
  select seq, hash into last_seq, last_hash
    from audit_events where tenant_id = p_tenant order by seq desc limit 1;
  next_seq := coalesce(last_seq, 0) + 1;
  prev := coalesce(last_hash, repeat('0', 64));
  insert into audit_events (tenant_id, seq, at, actor_user_id, action, entity_type, entity_id, detail, prev_hash, hash)
  values (
    p_tenant, next_seq, ts, p_actor, p_action, p_type, p_id, detail, prev,
    encode(digest(prev || audit_canonical(p_tenant, next_seq, ts, p_actor, p_action, p_type, p_id, detail), 'sha256'), 'hex')
  );
end
$$;
