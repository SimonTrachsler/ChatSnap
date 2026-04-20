begin;

-- Keep only the top 3 entries per owner (highest rank, newest first).
with ranked as (
  select
    id,
    row_number() over (
      partition by owner_id
      order by rank desc, created_at desc, id desc
    ) as rn
  from public.best_friends
)
delete from public.best_friends bf
using ranked r
where bf.id = r.id
  and r.rn > 3;

create or replace function public.best_friends_enforce_max_three()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*)
    into v_count
  from public.best_friends bf
  where bf.owner_id = new.owner_id
    and (tg_op <> 'update' or bf.id <> old.id);

  if v_count >= 3 then
    raise exception 'You can only pin up to 3 favorite chats.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists best_friends_enforce_max_three on public.best_friends;

create trigger best_friends_enforce_max_three
  before insert or update on public.best_friends
  for each row
  execute function public.best_friends_enforce_max_three();

comment on function public.best_friends_enforce_max_three() is
  'Prevents storing more than 3 favorite/pinned friends per owner.';

commit;
