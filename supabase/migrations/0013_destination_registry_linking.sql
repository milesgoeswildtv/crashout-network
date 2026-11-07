-- Destination registry and trusted account-link handshake.
-- Destinations remain unavailable until their own server-side adapter is verified.
create table public.destination_integrations (
  game_key public.game_key primary key references public.games(key) on delete cascade,
  integration_state text not null default 'adapter_required' check (integration_state in ('disabled','adapter_required','ready','maintenance')),
  enabled boolean not null default false, launch_url text, adapter_version text,
  capabilities jsonb not null default '[]'::jsonb check (jsonb_typeof(capabilities) = 'array'),
  updated_at timestamptz not null default now(),
  check (not enabled or (integration_state = 'ready' and launch_url is not null))
);
insert into public.destination_integrations(game_key,integration_state,enabled) values
 ('shyst','adapter_required',false),('poker','adapter_required',false),('realms','adapter_required',false),
 ('rituals','adapter_required',false),('degen','adapter_required',false),('mmo','disabled',false);
alter table public.destination_integrations enable row level security;
create policy "destination integration catalog is public read" on public.destination_integrations for select to anon,authenticated using (true);
revoke insert,update,delete on public.destination_integrations from anon,authenticated;
grant select on public.destination_integrations to anon,authenticated;
grant all on public.destination_integrations to service_role;
create table public.destination_link_sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 game_key public.game_key not null references public.games(key), flow text not null check(flow in ('existing','create')),
 token_hash text not null unique, expires_at timestamptz not null default (now()+interval '10 minutes'),
 consumed_at timestamptz, created_at timestamptz not null default now());
create index destination_link_sessions_expiry_idx on public.destination_link_sessions(expires_at) where consumed_at is null;
alter table public.destination_link_sessions enable row level security;
revoke all on public.destination_link_sessions from anon,authenticated;
grant all on public.destination_link_sessions to service_role;
create or replace function public.start_destination_link(p_game_key public.game_key,p_flow text) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare actor_id uuid:=auth.uid(); raw_token text; target_url text; session_expiry timestamptz;
begin
 if actor_id is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_flow not in ('existing','create') then raise exception 'Unsupported destination link flow' using errcode='22023'; end if;
 select launch_url into target_url from public.destination_integrations where game_key=p_game_key and enabled=true and integration_state='ready' and launch_url is not null;
 if target_url is null then raise exception 'Destination is not enabled for account linking' using errcode='55000'; end if;
 raw_token:=encode(gen_random_bytes(32),'hex'); session_expiry:=now()+interval '10 minutes';
 insert into public.destination_link_sessions(user_id,game_key,flow,token_hash,expires_at) values(actor_id,p_game_key,p_flow,encode(digest(convert_to(raw_token,'UTF8'),'sha256'),'hex'),session_expiry);
 return jsonb_build_object('token',raw_token,'launch_url',target_url,'flow',p_flow,'expires_at',session_expiry);
end; $$;
revoke all on function public.start_destination_link(public.game_key,text) from public,anon;
grant execute on function public.start_destination_link(public.game_key,text) to authenticated;
create or replace function public.complete_destination_link(p_token text,p_external_player_id text) returns uuid
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare link_session public.destination_link_sessions%rowtype; created_link_id uuid;
begin
 if p_token is null or length(p_token)<>64 or p_external_player_id is null or length(btrim(p_external_player_id))=0 or length(p_external_player_id)>200 then
  raise exception 'Invalid destination link proof' using errcode='22023'; end if;
 select * into link_session from public.destination_link_sessions where token_hash=encode(digest(convert_to(p_token,'UTF8'),'sha256'),'hex') and consumed_at is null and expires_at>now() for update;
 if not found then raise exception 'Destination link proof is invalid, expired, or already used' using errcode='28000'; end if;
 -- Trusted destination adapter must prove existing-account ownership or create the account before this call.
 insert into public.game_links(user_id,game_key,external_player_id) values(link_session.user_id,link_session.game_key,btrim(p_external_player_id)) returning id into created_link_id;
 update public.destination_link_sessions set consumed_at=now() where id=link_session.id;
 insert into public.audit_log(actor,action,target_type,target_id,metadata) values(link_session.user_id,'destination.account_linked','game_link',created_link_id::text,jsonb_build_object('game_key',link_session.game_key,'flow',link_session.flow));
 return created_link_id;
end; $$;
revoke all on function public.complete_destination_link(text,text) from public,anon,authenticated;
grant execute on function public.complete_destination_link(text,text) to service_role;