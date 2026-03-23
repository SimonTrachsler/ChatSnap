-- =============================================================================
-- Friend request data model: status = pending | accepted | rejected only.
-- - Migrate existing declined/canceled -> rejected (no data loss).
-- - Enforce requester_id <> receiver_id (already in place).
-- - One pending request per unordered pair (partial unique index).
-- - Trigger: receiver may set accepted|rejected; requester may set rejected (withdraw).
-- - accept_friend_request (existing): sets accepted and inserts both friends rows.
-- =============================================================================

-- 1) Migrate existing data: declined and canceled -> rejected
update public.friend_requests
set status = 'rejected'
where status in ('declined', 'canceled');

-- 2) Drop old status check and add new one
do $$
declare
  c name;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.friend_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.friend_requests drop constraint %I', c);
  end loop;
end $$;

alter table public.friend_requests
  add constraint friend_requests_status_check
  check (status in ('pending', 'accepted', 'rejected'));

comment on column public.friend_requests.status is 'pending | accepted | rejected';

-- 3) One pending request per unordered pair (works with from_user/to_user OR requester_id/receiver_id)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'requester_id') then
    execute 'create unique index if not exists friend_requests_one_pending_per_pair on public.friend_requests (least(requester_id, receiver_id), greatest(requester_id, receiver_id)) where status = ''pending''';
  elsif exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'from_user') then
    execute 'create unique index if not exists friend_requests_one_pending_per_pair on public.friend_requests (least(from_user, to_user), greatest(from_user, to_user)) where status = ''pending''';
  end if;
end $$;

-- 4) Trigger: only status updates; receiver -> accepted|rejected, requester -> rejected (works with both column naming schemes)
drop trigger if exists friend_requests_receiver_update_only_status on public.friend_requests;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'requester_id') then
    create or replace function public.friend_requests_receiver_update_only_status()
    returns trigger language plpgsql security definer set search_path = public as $fn$
    begin
      if auth.uid() = old.receiver_id then
        if new.status is null or new.status not in ('accepted', 'rejected') then
          raise exception 'Receiver may only set status to accepted or rejected.';
        end if;
      elsif auth.uid() = old.requester_id then
        if new.status is null or new.status <> 'rejected' then
          raise exception 'Requester may only set status to rejected (withdraw).';
        end if;
      else
        raise exception 'Only the receiver or requester can update a friend request.';
      end if;
      if old.requester_id is distinct from new.requester_id or old.receiver_id is distinct from new.receiver_id or old.id is distinct from new.id then
        raise exception 'Only status can be updated.';
      end if;
      return new;
    end; $fn$;
  elsif exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'friend_requests' and column_name = 'from_user') then
    create or replace function public.friend_requests_receiver_update_only_status()
    returns trigger language plpgsql security definer set search_path = public as $fn$
    begin
      if auth.uid() = old.to_user then
        if new.status is null or new.status not in ('accepted', 'rejected') then
          raise exception 'Receiver may only set status to accepted or rejected.';
        end if;
      elsif auth.uid() = old.from_user then
        if new.status is null or new.status <> 'rejected' then
          raise exception 'Requester may only set status to rejected (withdraw).';
        end if;
      else
        raise exception 'Only the receiver or requester can update a friend request.';
      end if;
      if old.from_user is distinct from new.from_user or old.to_user is distinct from new.to_user or old.id is distinct from new.id then
        raise exception 'Only status can be updated.';
      end if;
      return new;
    end; $fn$;
  end if;
end $$;

create trigger friend_requests_receiver_update_only_status
  before update on public.friend_requests
  for each row
  execute function public.friend_requests_receiver_update_only_status();
