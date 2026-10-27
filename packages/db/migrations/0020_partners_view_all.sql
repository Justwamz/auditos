-- Partners can read every engagement of their firm. Changing anything still needs membership of the engagement team,
-- so a partner who is not on the team sees the file but cannot edit, sign off, delete or move it.

-- True for an active partner of the current firm. Reads memberships only, so it is safe inside policies.
create function is_active_partner() returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$
  select exists (
    select 1 from memberships
     where tenant_id = app_tenant() and user_id = app_user() and active and role = 'partner'
  )
$$;

-- Read access: team members, and partners of the firm.
create function can_view_engagement(p_engagement uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$ select is_engagement_member(p_engagement) or is_active_partner() $$;

revoke all on function is_active_partner(), can_view_engagement(uuid) from public;
grant execute on function is_active_partner(), can_view_engagement(uuid) to auditos_app;

-- Reads.
drop policy engagements_member on engagements;
create policy engagements_member on engagements for select using (
  tenant_id = app_tenant()
  and (exists (select 1 from engagement_members em where em.engagement_id = engagements.id and em.user_id = app_user()) or is_active_partner())
);
drop policy wp_items_select on wp_items;
create policy wp_items_select on wp_items for select using (tenant_id = app_tenant() and can_view_engagement(engagement_id));
drop policy unlock_requests_select on unlock_requests;
create policy unlock_requests_select on unlock_requests for select using (tenant_id = app_tenant() and can_view_engagement(engagement_id));
drop policy review_notes_select on review_notes;
create policy review_notes_select on review_notes for select using (tenant_id = app_tenant() and can_view_engagement(engagement_id));

-- Writes stay with the team. These policies were only checking the firm; they now check the engagement team as well.
drop policy review_notes_insert on review_notes;
create policy review_notes_insert on review_notes for insert with check (tenant_id = app_tenant() and is_engagement_member(engagement_id));
drop policy review_notes_update on review_notes;
create policy review_notes_update on review_notes for update
  using (tenant_id = app_tenant() and is_engagement_member(engagement_id)) with check (tenant_id = app_tenant());

drop policy signoffs_write on signoffs;
create policy signoffs_write on signoffs for insert
  with check (tenant_id = app_tenant() and exists (select 1 from wp_items i where i.id = signoffs.item_id and is_engagement_member(i.engagement_id)));
drop policy signoffs_revoke on signoffs;
create policy signoffs_revoke on signoffs for update
  using (tenant_id = app_tenant() and exists (select 1 from wp_items i where i.id = signoffs.item_id and is_engagement_member(i.engagement_id)))
  with check (tenant_id = app_tenant());

drop policy deletion_requests_write on deletion_requests;
create policy deletion_requests_write on deletion_requests for insert
  with check (tenant_id = app_tenant() and exists (select 1 from wp_items i where i.id = deletion_requests.item_id and is_engagement_member(i.engagement_id)));
drop policy deletion_requests_update on deletion_requests;
create policy deletion_requests_update on deletion_requests for update
  using (tenant_id = app_tenant() and exists (select 1 from wp_items i where i.id = deletion_requests.item_id and is_engagement_member(i.engagement_id)))
  with check (tenant_id = app_tenant());

drop policy unlock_requests_write on unlock_requests;
create policy unlock_requests_write on unlock_requests for insert with check (tenant_id = app_tenant() and is_engagement_member(engagement_id));
drop policy unlock_requests_update on unlock_requests;
create policy unlock_requests_update on unlock_requests for update
  using (tenant_id = app_tenant() and is_engagement_member(engagement_id)) with check (tenant_id = app_tenant());
