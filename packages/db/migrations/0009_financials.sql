-- One trial balance, mapping and adjustments paper per engagement.
create unique index wp_items_singleton on wp_items (engagement_id, kind)
  where deleted_at is null and kind in ('trial_balance', 'trial_balance_prior', 'fs_mapping', 'adjustments');

-- Comparatives: the previous engagement for the same client, readable by members of the current one.
-- Reads as the previous engagement's partner (always a member) inside this function only.
create function engagement_prior_snapshot(p_engagement uuid)
returns table (prior_engagement uuid, kind text, content jsonb)
language plpgsql security definer set search_path = public, pg_temp as
$$
declare cur engagements%rowtype; prev engagements%rowtype; saved text;
begin
  if not is_engagement_member(p_engagement) then
    raise exception 'not_found' using errcode = 'AO404';
  end if;
  select * into cur from engagements where id = p_engagement and tenant_id = app_tenant();
  select * into prev from engagements
   where tenant_id = app_tenant() and client_id = cur.client_id and period_end < cur.period_start
   order by period_end desc limit 1;
  if not found then
    return;
  end if;
  saved := current_setting('app.user_id', true);
  perform set_config('app.user_id', prev.partner_id::text, true);
  return query
    select prev.id, w.kind, w.content from wp_items w
     where w.engagement_id = prev.id and w.deleted_at is null
       and w.kind in ('trial_balance', 'adjustments', 'fs_mapping');
  perform set_config('app.user_id', coalesce(saved, ''), true);
end
$$;
revoke all on function engagement_prior_snapshot(uuid) from public;
grant execute on function engagement_prior_snapshot(uuid) to auditos_app;
