-- Admin visibility and player-role management. No client-side role table writes.
create or replace function public.admin_network_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  select jsonb_build_object(
    'players',(select count(*) from public.profiles),
    'pending_friend_requests',(select count(*) from public.friendships where status='pending'),
    'unread_notifications',(select count(*) from public.notifications where read_at is null),
    'games',(select coalesce(jsonb_agg(jsonb_build_object('key',key,'display_name',display_name,'status',status) order by display_name),'[]'::jsonb) from public.games),
    'recent_audit',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'actor',actor,'action',action,'target_type',target_type,'target_id',target_id,'created_at',created_at) order by created_at desc),'[]'::jsonb) from (select * from public.audit_log order by created_at desc limit 25) a)
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_find_players(search_text text default '')
returns table(player_id text, username text, display_name text, role public.app_role, created_at timestamptz)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access required';
  end if;
  return query
    select p.player_id,p.username,p.display_name,coalesce(r.role,'player'::public.app_role),p.created_at
    from public.profiles p left join public.user_roles r on r.user_id=p.id
    where trim(coalesce(search_text,''))=''
      or strpos(lower(p.username),lower(trim(search_text)))>0
      or strpos(lower(p.display_name),lower(trim(search_text)))>0
      or strpos(lower(p.player_id),lower(trim(search_text)))>0
    order by p.created_at desc limit 50;
end;
$$;

create or replace function public.admin_set_player_role(target_player_id text, new_role public.app_role)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare target_id uuid; old_role public.app_role;
begin
  if auth.uid() is null or not exists(
    select 1 from public.user_roles where user_id=auth.uid() and role='superadmin'
  ) then raise exception 'Superadministrator access required'; end if;
  if new_role='superadmin' then raise exception 'Superadministrator grants are disabled'; end if;
  select id into target_id from public.profiles where player_id=upper(trim(target_player_id));
  if target_id is null then raise exception 'Player not found'; end if;
  if target_id=auth.uid() then raise exception 'You cannot change your own role'; end if;
  select role into old_role from public.user_roles where user_id=target_id;
  if old_role='superadmin' then raise exception 'Superadministrator roles cannot be changed here'; end if;
  insert into public.user_roles(user_id,role,granted_by,granted_at)
    values(target_id,new_role,auth.uid(),now())
    on conflict(user_id) do update set role=excluded.role,granted_by=excluded.granted_by,granted_at=excluded.granted_at;
  insert into public.audit_log(actor,action,target_type,target_id,metadata)
    values(auth.uid(),'admin.player_role_changed','profile',target_id::text,
      jsonb_build_object('from',coalesce(old_role::text,'player'),'to',new_role::text));
end;
$$;

revoke all on function public.admin_network_overview() from public, anon;
revoke all on function public.admin_find_players(text) from public, anon;
revoke all on function public.admin_set_player_role(text,public.app_role) from public, anon;
grant execute on function public.admin_network_overview() to authenticated;
grant execute on function public.admin_find_players(text) to authenticated;
grant execute on function public.admin_set_player_role(text,public.app_role) to authenticated;
