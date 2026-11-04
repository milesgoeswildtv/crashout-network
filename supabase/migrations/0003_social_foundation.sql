-- Social foundation: server-validated player search and friendship transitions.
-- Apply after 0001_initial.sql and 0002_secure_player_provisioning.sql.

alter table public.friendships drop constraint if exists friendships_status_check;
alter table public.friendships add constraint friendships_status_check
  check (status in ('pending','accepted','declined'));

-- Remove broad client writes. All transitions go through narrowly scoped RPCs.
revoke insert, update, delete on table public.friendships from authenticated;
revoke insert, update, delete on table public.notifications from authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.user_blocks (
  blocker uuid not null references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.user_blocks enable row level security;
create policy "blocks visible to blocker" on public.user_blocks
  for select to authenticated using (blocker = auth.uid());
revoke insert, update, delete on table public.user_blocks from authenticated;

create or replace function public.search_players(search_text text)
returns table(player_id text, username text, display_name text, avatar_url text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.player_id, p.username, p.display_name, p.avatar_url
  from public.profiles p
  where auth.uid() is not null
    and length(trim(coalesce(search_text,''))) >= 2
    and p.id <> auth.uid()
    and (
      strpos(lower(p.username), lower(trim(search_text))) > 0
      or strpos(lower(p.display_name), lower(trim(search_text))) > 0
      or strpos(lower(p.player_id), lower(trim(search_text))) > 0
    )
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker = auth.uid() and b.blocked = p.id)
         or (b.blocker = p.id and b.blocked = auth.uid())
    )
  order by
    case when lower(p.username) = lower(trim(search_text)) then 0 else 1 end,
    p.username
  limit 20;
$$;

create or replace function public.send_friend_request(target_username text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  target_id uuid;
  friendship_id uuid;
  existing_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into target_id from public.profiles
    where lower(username) = lower(trim(target_username));
  if target_id is null then raise exception 'Player not found'; end if;
  if target_id = auth.uid() then raise exception 'You cannot add yourself'; end if;
  if exists(select 1 from public.user_blocks
    where (blocker=auth.uid() and blocked=target_id)
       or (blocker=target_id and blocked=auth.uid())) then
    raise exception 'Friend requests are unavailable for this player';
  end if;

  select id,status into friendship_id,existing_status from public.friendships
    where (requester=auth.uid() and addressee=target_id)
       or (requester=target_id and addressee=auth.uid())
    limit 1;
  if friendship_id is not null then
    if existing_status='accepted' then raise exception 'You are already friends'; end if;
    if existing_status='pending' then raise exception 'A friend request is already pending'; end if;
    delete from public.friendships where id=friendship_id;
  end if;

  insert into public.friendships(requester,addressee,status)
    values(auth.uid(),target_id,'pending') returning id into friendship_id;
  insert into public.notifications(user_id,title,body)
    values(target_id,'FRIEND REQUEST','You received a new friend request.');
  return friendship_id;
end;
$$;

create or replace function public.respond_friend_request(request_id uuid, accept_request boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare sender uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.friendships
    set status = case when accept_request then 'accepted' else 'declined' end
    where id=request_id and addressee=auth.uid() and status='pending'
    returning requester into sender;
  if sender is null then raise exception 'Friend request not found or already handled'; end if;
  if accept_request then
    insert into public.notifications(user_id,title,body)
      values(sender,'REQUEST ACCEPTED','Your friend request was accepted.');
  end if;
end;
$$;

create or replace function public.remove_friend(target_player_id text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into target_id from public.profiles where player_id=upper(trim(target_player_id));
  if target_id is null then raise exception 'Player not found'; end if;
  delete from public.friendships
    where status='accepted'
      and ((requester=auth.uid() and addressee=target_id)
        or (requester=target_id and addressee=auth.uid()));
end;
$$;

create or replace function public.block_player(target_player_id text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into target_id from public.profiles where player_id=upper(trim(target_player_id));
  if target_id is null then raise exception 'Player not found'; end if;
  if target_id=auth.uid() then raise exception 'You cannot block yourself'; end if;
  insert into public.user_blocks(blocker,blocked) values(auth.uid(),target_id)
    on conflict do nothing;
  delete from public.friendships
    where (requester=auth.uid() and addressee=target_id)
       or (requester=target_id and addressee=auth.uid());
end;
$$;

create or replace function public.unblock_player(target_player_id text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into target_id from public.profiles where player_id=upper(trim(target_player_id));
  if target_id is null then raise exception 'Player not found'; end if;
  delete from public.user_blocks where blocker=auth.uid() and blocked=target_id;
end;
$$;

create or replace function public.mark_notification_read(notification_id uuid)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  update public.notifications set read_at=now()
  where id=notification_id and user_id=auth.uid() and read_at is null;
$$;

revoke all on function public.search_players(text) from public, anon;
revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.respond_friend_request(uuid,boolean) from public, anon;
revoke all on function public.remove_friend(text) from public, anon;
revoke all on function public.block_player(text) from public, anon;
revoke all on function public.unblock_player(text) from public, anon;
revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.search_players(text) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid,boolean) to authenticated;
grant execute on function public.remove_friend(text) to authenticated;
grant execute on function public.block_player(text) to authenticated;
grant execute on function public.unblock_player(text) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
