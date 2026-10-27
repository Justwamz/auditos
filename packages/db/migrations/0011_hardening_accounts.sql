-- Only accounts that have never had a password (pending invites) can be given one through an invite token.
create function auth_needs_invite(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as
$$ select coalesce((select password_hash like 'invite:%' from users where id = p_user), false) $$;
revoke all on function auth_needs_invite(uuid) from public;
grant execute on function auth_needs_invite(uuid) to auditos_app;

-- Locking an account also ends its sessions.
create or replace function auth_record_failure(p_user uuid, p_max integer, p_lock_minutes integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as
$$
declare locked boolean;
begin
  update users set
    failed_logins = failed_logins + 1,
    locked_until = case when failed_logins + 1 >= p_max then now() + make_interval(mins => p_lock_minutes) else locked_until end
  where id = p_user
  returning (failed_logins >= p_max) into locked;
  if coalesce(locked, false) then
    update sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  end if;
  return coalesce(locked, false);
end
$$;
