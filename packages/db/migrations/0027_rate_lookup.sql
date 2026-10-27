-- The rate stamped on a time entry comes from the firm's rates, which staff cannot read themselves. The lookup runs inside
-- this function only, with a switch the rates policy honours while it runs.
drop policy billing_rates_select on billing_rates;
create policy billing_rates_select on billing_rates for select
  using (tenant_id = app_tenant() and (can_see_rates() or coalesce(current_setting('app.rate_lookup', true), '') = 'on'));

create function rate_for(p_tenant uuid, p_role text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as
$$
declare v bigint;
begin
  perform set_config('app.rate_lookup', 'on', true);
  select rate_cents into v from billing_rates where tenant_id = p_tenant and role = p_role;
  perform set_config('app.rate_lookup', 'off', true);
  return coalesce(v, 0);
end
$$;
revoke all on function rate_for(uuid, text) from public;

create or replace function time_entries_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as
$$
declare caller text := caller_role();
begin
  if tg_op = 'INSERT' then
    if caller is null or caller = 'firm_admin' then raise exception 'forbidden' using errcode = 'AO403'; end if;
    new.user_id := app_user();
    new.invoice_id := null;
    new.rate_cents := case when new.billable and new.engagement_id is not null then rate_for(new.tenant_id, caller) else 0 end;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then raise exception 'time_entry_invoiced' using errcode = 'AO409'; end if;
    return old;
  end if;
  if old.invoice_id is distinct from new.invoice_id then
    if coalesce(current_setting('app.invoicing', true), '') <> 'on' then raise exception 'time_entry_invoiced' using errcode = 'AO409'; end if;
    return new;
  end if;
  if old.invoice_id is not null then raise exception 'time_entry_invoiced' using errcode = 'AO409'; end if;
  new.user_id := old.user_id;
  new.engagement_id := old.engagement_id;
  new.rate_cents := old.rate_cents;
  new.updated_at := now();
  return new;
end
$$;
