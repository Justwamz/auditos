-- A client always has an accountable manager, and a person who still holds clients or open prospects cannot leave.

-- While a handover function runs (and only then), an administrator can see the open prospects they are moving.
drop policy prospects_select on prospects;
create policy prospects_select on prospects for select using (
  tenant_id = app_tenant()
  and (owner_id = app_user() or sees_all_prospects() or (is_tenant_admin() and coalesce(current_setting('app.handover', true), '') = 'on'))
);
drop policy prospects_update on prospects;
create policy prospects_update on prospects for update
  using (tenant_id = app_tenant() and (owner_id = app_user() or sees_all_prospects() or (is_tenant_admin() and coalesce(current_setting('app.handover', true), '') = 'on')))
  with check (tenant_id = app_tenant());

create function client_reassign_manager(p_client uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
declare c clients%rowtype;
begin
  if not (is_active_partner() or is_tenant_admin()) then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required' using errcode = 'AO422'; end if;
  select * into c from clients where id = p_client for update;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if not client_manager_valid(p_user) then raise exception 'invalid_account_manager' using errcode = 'AO422'; end if;
  update clients set account_manager_id = p_user where id = p_client;
  perform audit_append_internal(app_tenant(), app_user(), 'client.manager_changed', 'client', p_client::text,
    jsonb_build_object('clientId', p_client, 'clientName', c.name, 'from', person_name(c.account_manager_id), 'to', person_name(p_user), 'reason', trim(p_reason)));
end
$$;

-- What a person holds: the clients they manage and the open prospects they own.
create function member_responsibilities(p_user uuid) returns table (kind text, id uuid, name text)
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if not (is_active_partner() or is_tenant_admin()) then raise exception 'forbidden' using errcode = 'AO403'; end if;
  perform set_config('app.handover', 'on', true);
  return query select 'client'::text, c.id, c.name from clients c where c.account_manager_id = p_user order by c.name;
  return query select 'prospect'::text, p.id, p.name from prospects p where p.owner_id = p_user and p.stage not in ('won', 'lost') order by p.name;
  perform set_config('app.handover', 'off', true);
end
$$;

-- Moves every client and open prospect from one person to another, with one reason, in one step.
create function member_handover(p_from uuid, p_to uuid, p_reason text) returns table (clients integer, prospects integer)
language plpgsql security definer set search_path = public, pg_temp as
$$
declare n_c integer; n_p integer; r record;
begin
  if not (is_active_partner() or is_tenant_admin()) then raise exception 'forbidden' using errcode = 'AO403'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'reason_required' using errcode = 'AO422'; end if;
  if p_from = p_to then raise exception 'same_person' using errcode = 'AO422'; end if;
  perform set_config('app.handover', 'on', true);
  select count(*) into n_c from clients where account_manager_id = p_from;
  select count(*) into n_p from prospects where owner_id = p_from and stage not in ('won', 'lost');
  if n_c > 0 and not client_manager_valid(p_to) then raise exception 'invalid_account_manager' using errcode = 'AO422'; end if;
  if n_p > 0 and not prospect_owner_valid(p_to) then raise exception 'invalid_owner' using errcode = 'AO422'; end if;
  for r in select id, name from clients where account_manager_id = p_from loop
    update clients set account_manager_id = p_to where id = r.id;
    perform audit_append_internal(app_tenant(), app_user(), 'client.manager_changed', 'client', r.id::text,
      jsonb_build_object('clientId', r.id, 'clientName', r.name, 'from', person_name(p_from), 'to', person_name(p_to), 'reason', trim(p_reason)));
  end loop;
  for r in select id, name from prospects where owner_id = p_from and stage not in ('won', 'lost') loop
    update prospects set owner_id = p_to, updated_at = now() where id = r.id;
    perform audit_append_internal(app_tenant(), app_user(), 'prospect.reassigned', 'prospect', r.id::text,
      jsonb_build_object('prospectName', r.name, 'from', person_name(p_from), 'to', person_name(p_to), 'reason', trim(p_reason)));
  end loop;
  perform set_config('app.handover', 'off', true);
  perform audit_append_internal(app_tenant(), app_user(), 'member.handed_over', 'user', p_from::text,
    jsonb_build_object('from', person_name(p_from), 'to', person_name(p_to), 'clients', n_c, 'prospects', n_p, 'reason', trim(p_reason)));
  return query select n_c, n_p;
end
$$;

revoke all on function client_reassign_manager(uuid, uuid, text), member_responsibilities(uuid), member_handover(uuid, uuid, text) from public;
grant execute on function client_reassign_manager(uuid, uuid, text), member_responsibilities(uuid), member_handover(uuid, uuid, text) to auditos_app;

-- Switching someone off, or moving them to a role that cannot hold what they hold, needs a handover first.
create or replace function admin_update_member(p_user uuid, p_role text, p_grade integer, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  if app_tenant() is null or not is_tenant_admin() then
    raise exception 'admin: admin permission required' using errcode = 'AO403';
  end if;
  perform set_config('app.handover', 'on', true);
  if (p_active = false or (p_role is not null and p_role not in ('manager', 'partner')))
     and exists (select 1 from clients where account_manager_id = p_user) then
    perform set_config('app.handover', 'off', true);
    raise exception 'has_responsibilities' using errcode = 'AO409';
  end if;
  if (p_active = false or p_role in ('firm_admin', 'quality_officer', 'eqr'))
     and exists (select 1 from prospects where owner_id = p_user and stage not in ('won', 'lost')) then
    perform set_config('app.handover', 'off', true);
    raise exception 'has_responsibilities' using errcode = 'AO409';
  end if;
  perform set_config('app.handover', 'off', true);
  update memberships set role = coalesce(p_role, role), grade = coalesce(p_grade, grade), active = coalesce(p_active, active)
   where tenant_id = app_tenant() and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'AO404'; end if;
  if not exists (select 1 from memberships where tenant_id = app_tenant() and active and (role = 'firm_admin' or is_admin)) then
    raise exception 'last_admin' using errcode = 'AO409';
  end if;
  if p_active = false then
    update sessions set revoked_at = now() where user_id = p_user and tenant_id = app_tenant() and revoked_at is null;
  end if;
end
$$;
