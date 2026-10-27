-- 0018 first shipped with the memberships table already re-forced when the clients update read it, so on databases that
-- applied that version no account manager was set. This repeats the clients update; it changes nothing where one is set.
alter table memberships no force row level security;
alter table clients no force row level security;

update clients c set account_manager_id = coalesce(
  (select m.user_id from memberships m where m.tenant_id = c.tenant_id and m.user_id = c.created_by and m.role in ('manager', 'partner')),
  (select m.user_id from memberships m where m.tenant_id = c.tenant_id and m.role in ('partner', 'manager') and m.active
    order by case m.role when 'partner' then 0 else 1 end, m.created_at limit 1)
)
where c.account_manager_id is null;

alter table clients force row level security;
alter table memberships force row level security;
