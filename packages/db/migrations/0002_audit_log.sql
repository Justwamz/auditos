-- Tamper-evident audit log: append-only, hash-chained per tenant, written only by
-- SECURITY DEFINER functions. The app role can SELECT its own tenant's events and nothing else.

create table audit_events (
  tenant_id uuid not null references tenants (id),
  seq bigint not null,
  at timestamptz not null,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  prev_hash text not null,
  hash text not null,
  primary key (tenant_id, seq)
);
alter table audit_events enable row level security;
create policy audit_events_select on audit_events for select using (tenant_id = app_tenant());
grant select on audit_events to auditos_app;

create function audit_canonical(
  p_tenant uuid, p_seq bigint, p_at timestamptz, p_actor uuid,
  p_action text, p_type text, p_id text, p_detail jsonb
) returns text language sql stable as
$$
  select jsonb_build_object(
    'tenant_id', p_tenant, 'seq', p_seq,
    'at', to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor', p_actor, 'action', p_action, 'entity_type', p_type, 'entity_id', p_id, 'detail', p_detail
  )::text
$$;

create function audit_append_internal(
  p_tenant uuid, p_actor uuid, p_action text, p_type text, p_id text, p_detail jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  last_seq bigint;
  last_hash text;
  next_seq bigint;
  prev text;
  ts timestamptz := clock_timestamp();
begin
  if p_tenant is null then
    raise exception 'audit: tenant context required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text, 0));
  select seq, hash into last_seq, last_hash
    from audit_events where tenant_id = p_tenant order by seq desc limit 1;
  next_seq := coalesce(last_seq, 0) + 1;
  prev := coalesce(last_hash, repeat('0', 64));
  insert into audit_events (tenant_id, seq, at, actor_user_id, action, entity_type, entity_id, detail, prev_hash, hash)
  values (
    p_tenant, next_seq, ts, p_actor, p_action, p_type, p_id, coalesce(p_detail, '{}'::jsonb), prev,
    encode(digest(prev || audit_canonical(p_tenant, next_seq, ts, p_actor, p_action, p_type, p_id, coalesce(p_detail, '{}'::jsonb)), 'sha256'), 'hex')
  );
end
$$;

create function audit_append(p_action text, p_type text, p_id text, p_detail jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  perform audit_append_internal(app_tenant(), app_user(), p_action, p_type, p_id, p_detail);
end
$$;

create function audit_row_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as
$$
declare
  rec jsonb;
  tid uuid;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  tid := coalesce((rec ->> 'tenant_id')::uuid, app_tenant());
  perform audit_append_internal(
    tid, app_user(), tg_op, tg_table_name, coalesce(rec ->> 'id', rec ->> 'user_id'),
    case when tg_op = 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)) else rec end
  );
  return null;
end
$$;

create function audit_attach(tbl regclass) returns void language plpgsql as
$$
begin
  execute format(
    'create trigger %I after insert or update or delete on %s for each row execute function audit_row_change()',
    'audit_' || replace(tbl::text, '.', '_'), tbl
  );
end
$$;

-- Returns the first broken seq for a tenant, or null when the chain is intact.
create function audit_verify(p_tenant uuid) returns bigint language plpgsql as
$$
declare
  r record;
  prev text := repeat('0', 64);
  expected bigint := 1;
begin
  for r in select * from audit_events where tenant_id = p_tenant order by seq loop
    if r.seq <> expected or r.prev_hash <> prev then
      return r.seq;
    end if;
    if r.hash <> encode(digest(prev || audit_canonical(r.tenant_id, r.seq, r.at, r.actor_user_id, r.action, r.entity_type, r.entity_id, r.detail), 'sha256'), 'hex') then
      return r.seq;
    end if;
    prev := r.hash;
    expected := expected + 1;
  end loop;
  return null;
end
$$;

revoke all on function audit_canonical(uuid, bigint, timestamptz, uuid, text, text, text, jsonb) from public;
revoke all on function audit_append_internal(uuid, uuid, text, text, text, jsonb) from public;
revoke all on function audit_row_change() from public;
revoke all on function audit_attach(regclass) from public;
revoke all on function audit_verify(uuid) from public;
revoke all on function audit_append(text, text, text, jsonb) from public;
grant execute on function audit_append(text, text, text, jsonb) to auditos_app;

select audit_attach('memberships');
