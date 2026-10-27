-- Every version of a paper is kept for good: no update, delete or truncate, whoever asks (the owner role included).
create function wp_item_versions_immutable() returns trigger language plpgsql as
$$
begin
  raise exception 'version_immutable' using errcode = 'AO409';
end
$$;

create trigger wp_item_versions_no_update before update on wp_item_versions
  for each row execute function wp_item_versions_immutable();
create trigger wp_item_versions_no_delete before delete on wp_item_versions
  for each row execute function wp_item_versions_immutable();
create trigger wp_item_versions_no_truncate before truncate on wp_item_versions
  for each statement execute function wp_item_versions_immutable();
