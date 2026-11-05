-- Extend the authenticated public profile card with the player's explicitly public avatar.
drop function if exists public.get_public_player_profile(text);
create function public.get_public_player_profile(target_player_id text)
returns table(player_id text,username text,display_name text,avatar_url text,joined_at timestamptz,friend_count bigint)
language sql stable security definer
set search_path=public,pg_temp
as $$
 select p.player_id,p.username,p.display_name,p.avatar_url,p.created_at,
  (select count(*) from public.friendships f where f.status='accepted' and (f.requester=p.id or f.addressee=p.id)) as friend_count
 from public.profiles p
 where auth.uid() is not null
 and p.player_id=upper(trim(target_player_id))
 and not exists(select 1 from public.user_blocks b
  where (b.blocker=auth.uid() and b.blocked=p.id) or (b.blocker=p.id and b.blocked=auth.uid()));
$$;
revoke all on function public.get_public_player_profile(text) from public,anon;
grant execute on function public.get_public_player_profile(text) to authenticated;
