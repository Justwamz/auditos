-- Clients are visible to the people assigned to them. Partners and admins see every client in their firm.
alter table clients add column account_manager_id uuid references users (id);

-- Existing clients: the creator when they are a manager or partner, otherwise the firm's first partner, then manager.
update clients c set account_manager_id = coalesce(
  (select m.user_id from memberships m where m.tenant_id = c.tenant_id and m.user_id = c.created_by and m.role in ('manager', 'partner')),
  (select m.user_id from memberships m where m.tenant_id = c.tenant_id and m.role in ('partner', 'manager') and m.active
    order by case m.role when 'partner' then 0 else 1 end, m.created_at limit 1)
);

-- True for an active partner, a firm admin or a holder of the admin permission: they see all clients.
create function sees_all_clients() returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select exists (
    select 1 from memberships
     where tenant_id = app_tenant() and user_id = app_user() and active and (role in ('partner', 'firm_admin') or is_admin)
  )
$$;

-- True when the caller is an active member of an engagement of this client.
create function client_has_my_engagement(p_client uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select exists (
    select 1 from engagements e
      join engagement_members em on em.engagement_id = e.id and em.tenant_id = e.tenant_id
      join memberships m on m.tenant_id = em.tenant_id and m.user_id = em.user_id and m.active
     where e.client_id = p_client and e.tenant_id = app_tenant() and em.user_id = app_user()
  )
$$;

-- The account manager must still be an active manager or partner of the firm.
create function client_manager_valid(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select exists (
    select 1 from memberships m join users u on u.id = m.user_id
     where m.tenant_id = app_tenant() and m.user_id = p_user and m.active and u.active and m.role in ('manager', 'partner')
  )
$$;

revoke all on function sees_all_clients(), client_has_my_engagement(uuid), client_manager_valid(uuid) from public;
grant execute on function sees_all_clients(), client_has_my_engagement(uuid), client_manager_valid(uuid) to auditos_app;

drop policy clients_tenant on clients;
create policy clients_select on clients for select using (
  tenant_id = app_tenant()
  and (account_manager_id = app_user() or sees_all_clients() or client_has_my_engagement(id))
);
create policy clients_insert on clients for insert with check (tenant_id = app_tenant() and client_manager_valid(account_manager_id));
create policy clients_update on clients for update
  using (tenant_id = app_tenant() and (account_manager_id = app_user() or sees_all_clients()))
  with check (tenant_id = app_tenant());
