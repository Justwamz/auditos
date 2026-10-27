-- Partner read access applies only to read requests. The API switches it on (app.view_all) for GET requests and never for
-- anything that writes, so every function that relies on membership to keep outsiders away behaves exactly as before.
create function view_all_on() returns boolean language sql stable as
$$ select coalesce(current_setting('app.view_all', true), '') = 'on' $$;
grant execute on function view_all_on() to auditos_app;

create or replace function can_view_engagement(p_engagement uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$ select is_engagement_member(p_engagement) or (is_active_partner() and view_all_on()) $$;

drop policy engagements_member on engagements;
create policy engagements_member on engagements for select using (
  tenant_id = app_tenant()
  and (exists (select 1 from engagement_members em where em.engagement_id = engagements.id and em.user_id = app_user())
       or (is_active_partner() and view_all_on()))
);
