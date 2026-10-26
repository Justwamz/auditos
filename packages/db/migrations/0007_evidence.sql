-- Evidence bytes are tied to a recorded hash, so the item's title and content never change.
create function wp_items_evidence_immutable() returns trigger language plpgsql as
$$
begin
  if old.kind = 'evidence' and (new.title is distinct from old.title or new.content is distinct from old.content) then
    raise exception 'evidence_immutable' using errcode = 'AO409';
  end if;
  return new;
end
$$;
create trigger wp_items_evidence_immutable before update on wp_items
  for each row execute function wp_items_evidence_immutable();
