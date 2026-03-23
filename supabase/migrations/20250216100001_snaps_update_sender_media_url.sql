-- Sender darf eigenen Snap updaten (nur media_url nach Upload setzen)
create policy "snaps_update_sender"
  on public.snaps for update
  to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- Sender darf nur media_url setzen (von null auf nicht-null); Rest unverändert
create or replace function public.snaps_sender_update_only_media_url()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.sender_id then
    if new.sender_id is distinct from old.sender_id
       or new.recipient_id is distinct from old.recipient_id
       or new.opened is distinct from old.opened
       or new.id is distinct from old.id
       or new.created_at is distinct from old.created_at then
      raise exception 'Sender darf nur media_url setzen.';
    end if;
    if old.media_url is not null and new.media_url is distinct from old.media_url then
      raise exception 'media_url kann nur einmal gesetzt werden.';
    end if;
  end if;
  return new;
end;
$$;

create trigger snaps_sender_update_only_media_url
  before update on public.snaps
  for each row
  execute function public.snaps_sender_update_only_media_url();
