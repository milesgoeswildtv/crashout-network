-- Trusted destination activity and achievement progression. Players cannot self-award progress.
create table public.achievement_definitions (
 id uuid primary key default gen_random_uuid(),
 scope text not null check(scope in ('network','game')),
 game_key public.game_key references public.games(key),
 code text not null unique check(code ~ '^[a-z0-9][a-z0-9_-]{2,47}$'),
 name text not null check(char_length(trim(name)) between 1 and 64),
 description text not null default '' check(char_length(description)<=240),
 category text not null default 'milestone' check(category in ('milestone','skill','social','seasonal')),
 icon_key text not null default 'trophy' check(icon_key ~ '^[a-z0-9_-]{1,24}$'),
 target_count bigint not null default 1 check(target_count>0),
 active boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((scope='network' and game_key is null) or (scope='game' and game_key is not null))
);
create index achievement_definitions_active_idx on public.achievement_definitions(active,scope,game_key);
create table public.achievement_progress (
 user_id uuid not null references auth.users(id) on delete cascade,
 achievement_id uuid not null references public.achievement_definitions(id) on delete cascade,
 progress_count bigint not null default 0 check(progress_count>=0),
 updated_at timestamptz not null default now(),primary key(user_id,achievement_id)
);
create index achievement_progress_user_idx on public.achievement_progress(user_id,updated_at desc);
create table public.achievement_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 game_key public.game_key,event_code text not null check(event_code ~ '^[a-z0-9][a-z0-9_.-]{1,63}$'),
 source_event_id text not null check(char_length(source_event_id) between 1 and 160),
 amount bigint not null check(amount>0 and amount<=1000000),created_at timestamptz not null default now()
);
-- PostgreSQL enum-to-text casts are not immutable index expressions. Native enum
-- indexing plus NULLS NOT DISTINCT gives network events a stable dedupe key too.
create unique index achievement_events_source_dedupe_idx
 on public.achievement_events(user_id,game_key,event_code,source_event_id) nulls not distinct;
create index achievement_events_user_idx on public.achievement_events(user_id,created_at desc);
create table public.player_achievements (
 user_id uuid not null references auth.users(id) on delete cascade,
 achievement_id uuid not null references public.achievement_definitions(id) on delete cascade,
 awarded_at timestamptz not null default now(),primary key(user_id,achievement_id)
);
create index player_achievements_user_idx on public.player_achievements(user_id,awarded_at desc);
alter table public.achievement_definitions enable row level security;
alter table public.achievement_progress enable row level security;
alter table public.achievement_events enable row level security;
alter table public.player_achievements enable row level security;
create policy "active achievements are visible" on public.achievement_definitions for select to anon,authenticated using(active=true);
create policy "players read own achievement progress" on public.achievement_progress for select to authenticated using(user_id=auth.uid());
create policy "players read own awards" on public.player_achievements for select to authenticated using(user_id=auth.uid());
revoke all on public.achievement_definitions from anon,authenticated;
grant select on public.achievement_definitions to anon,authenticated;
revoke all on public.achievement_progress,public.achievement_events,public.player_achievements from anon,authenticated;
grant select on public.achievement_progress,public.player_achievements to authenticated;

create or replace function public.get_network_progress()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to view network progress'; end if;
 select jsonb_build_object(
  'network_players',(select count(*) from public.profiles),
  'network_friendships',(select count(*) from public.friendships where status='accepted' and requester<addressee),
  'available_achievements',(select count(*) from public.achievement_definitions where active),
  'earned_achievements',(select count(*) from public.player_achievements where user_id=auth.uid()),
  'achievements',coalesce((select jsonb_agg(jsonb_build_object(
   'id',d.id,'scope',d.scope,'game_key',d.game_key,'code',d.code,'name',d.name,'description',d.description,
   'category',d.category,'icon_key',d.icon_key,'target_count',d.target_count,
   'progress_count',least(coalesce(p.progress_count,0),d.target_count),'awarded_at',a.awarded_at
  ) order by (a.awarded_at is not null) desc,d.scope,d.name)
  from public.achievement_definitions d
  left join public.achievement_progress p on p.achievement_id=d.id and p.user_id=auth.uid()
  left join public.player_achievements a on a.achievement_id=d.id and a.user_id=auth.uid()
  where d.active),'[]'::jsonb)
 ) into result;
 return result;
end; $$;

-- Only destination services holding the service-role credential can ingest activity.
create or replace function public.ingest_achievement_event(
 p_user_id uuid,p_game_key public.game_key,p_event_code text,p_source_event_id text,p_amount bigint default 1
) returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare inserted_id bigint; updated_rows integer; awards integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Trusted destination service required'; end if;
 if p_user_id is null or p_event_code is null or p_source_event_id is null or p_amount is null or p_amount<1 or p_amount>1000000
 then raise exception 'Invalid activity event'; end if;
 if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Player not found'; end if;
 insert into public.achievement_events(user_id,game_key,event_code,source_event_id,amount)
 values(p_user_id,p_game_key,p_event_code,p_source_event_id,p_amount)
 on conflict do nothing returning id into inserted_id;
 if inserted_id is null then return jsonb_build_object('accepted',false,'duplicate',true,'awarded',0); end if;
 insert into public.achievement_progress(user_id,achievement_id,progress_count)
 select p_user_id,d.id,least(p_amount,d.target_count) from public.achievement_definitions d
 where d.active and d.code=p_event_code
 and ((d.scope='network' and d.game_key is null) or (d.scope='game' and d.game_key=p_game_key))
 on conflict(user_id,achievement_id) do update
 set progress_count=least(public.achievement_progress.progress_count+excluded.progress_count,
 (select target_count from public.achievement_definitions where id=public.achievement_progress.achievement_id)),updated_at=now();
 get diagnostics updated_rows=row_count;
 insert into public.player_achievements(user_id,achievement_id)
 select p_user_id,p.achievement_id from public.achievement_progress p
 join public.achievement_definitions d on d.id=p.achievement_id
 where p.user_id=p_user_id and d.active and p.progress_count>=d.target_count
 on conflict(user_id,achievement_id) do nothing;
 get diagnostics awards=row_count;
 return jsonb_build_object('accepted',true,'duplicate',false,'progress_rows',updated_rows,'awarded',awards);
end; $$;

create or replace function public.admin_save_achievement(
 p_id uuid,p_scope text,p_game_key public.game_key,p_code text,p_name text,p_description text,
 p_category text,p_icon_key text,p_target_count bigint,p_active boolean
) returns uuid language plpgsql security definer set search_path=public,pg_temp
as $$
declare saved_id uuid;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required'; end if;
 if p_scope not in ('network','game') or (p_scope='network' and p_game_key is not null)
 or (p_scope='game' and p_game_key is null) or p_code is null or p_code !~ '^[a-z0-9][a-z0-9_-]{2,47}$'
 or p_name is null or char_length(trim(p_name)) not between 1 and 64 or char_length(coalesce(p_description,''))>240
 or p_category not in ('milestone','skill','social','seasonal') or p_icon_key is null
 or p_icon_key !~ '^[a-z0-9_-]{1,24}$' or p_target_count is null or p_target_count<1
 then raise exception 'Invalid achievement definition'; end if;
 if p_id is null then
  insert into public.achievement_definitions(scope,game_key,code,name,description,category,icon_key,target_count,active)
  values(p_scope,p_game_key,p_code,trim(p_name),coalesce(p_description,''),p_category,p_icon_key,p_target_count,coalesce(p_active,false))
  returning id into saved_id;
 else
  update public.achievement_definitions set scope=p_scope,game_key=p_game_key,code=p_code,name=trim(p_name),
  description=coalesce(p_description,''),category=p_category,icon_key=p_icon_key,target_count=p_target_count,
  active=coalesce(p_active,false),updated_at=now() where id=p_id returning id into saved_id;
  if saved_id is null then raise exception 'Achievement not found'; end if;
 end if;
 insert into public.audit_log(actor,action,target_type,target_id,metadata)
 values(auth.uid(),'admin.achievement_saved','achievement',saved_id::text,
 jsonb_build_object('scope',p_scope,'game_key',p_game_key,'code',p_code,'active',p_active));
 return saved_id;
end; $$;
revoke all on function public.get_network_progress() from public,anon;
grant execute on function public.get_network_progress() to authenticated;
revoke all on function public.ingest_achievement_event(uuid,public.game_key,text,text,bigint) from public,anon,authenticated;
grant execute on function public.ingest_achievement_event(uuid,public.game_key,text,text,bigint) to service_role;
revoke all on function public.admin_save_achievement(uuid,text,public.game_key,text,text,text,text,text,bigint,boolean) from public,anon;
grant execute on function public.admin_save_achievement(uuid,text,public.game_key,text,text,text,text,text,bigint,boolean) to authenticated;
