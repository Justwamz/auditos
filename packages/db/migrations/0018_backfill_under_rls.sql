-- The backfills in 0014 and 0015 ran as the table owner with row-level security forced, and a migration has no firm
-- context, so they changed nothing. Row security is switched off for the duration of the updates, then forced again.

alter table memberships no force row level security;
alter table clients no force row level security;

update memberships set is_admin = true where role = 'firm_admin' and not is_admin;

update clients c set account_manager_id = coalesce(
  (select m.user_id from memberships m where m.tenant_id = c.tenant_id and m.user_id = c.created_by and m.role in ('manager', 'partner')),
  (select m.user_id from memberships m where m.tenant_id = c.tenant_id and m.role in ('partner', 'manager') and m.active
    order by case m.role when 'partner' then 0 else 1 end, m.created_at limit 1)
)
where c.account_manager_id is null;

alter table clients force row level security;
alter table memberships force row level security;
