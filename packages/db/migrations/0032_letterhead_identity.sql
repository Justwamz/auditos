-- Statements are exported by staff and seniors too, who may not read billing_settings (it holds rates-adjacent and bank data
-- and is limited to people who can see rates). The letterhead only needs three plain fields from it, so this function hands
-- out exactly those for the caller's own firm: legal name, address and KRA PIN. No bank details, no rates.
--
-- The table keeps forced row security, so the function (which runs as the table owner) gets its own narrow policy: it applies
-- to the owner role only, is tenant-scoped, and opens only while the function itself has raised app.letterhead_identity. The
-- app role is not covered by the policy, so raising the flag in a raw session reveals nothing.

create policy billing_settings_identity on billing_settings for select to auditos_owner
  using (tenant_id = app_tenant() and coalesce(current_setting('app.letterhead_identity', true), '') = 'on');

create function firm_letterhead_identity() returns table (legal_name text, address text, kra_pin text)
language plpgsql security definer set search_path = public, pg_temp as
$$
begin
  perform set_config('app.letterhead_identity', 'on', true);
  return query select bs.legal_name, bs.address, bs.kra_pin from billing_settings bs where bs.tenant_id = app_tenant();
  perform set_config('app.letterhead_identity', 'off', true);
end
$$;
revoke all on function firm_letterhead_identity() from public;
grant execute on function firm_letterhead_identity() to auditos_app;
