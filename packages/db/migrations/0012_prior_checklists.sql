-- Last year's checklist answers are offered as suggestions on the next engagement for the same client.
-- Same function as 0009 with 'checklist' added to the kinds it may read.
create or replace function engagement_prior_snapshot(p_engagement uuid)
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
       and w.kind in ('trial_balance', 'adjustments', 'fs_mapping', 'checklist');
  perform set_config('app.user_id', coalesce(saved, ''), true);
end
$$;
