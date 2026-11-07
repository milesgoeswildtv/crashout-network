-- Route destination completion through one central gateway with destination-scoped credentials.
-- Destination servers never receive the Supabase service-role key.
revoke all on function public.complete_destination_link(text,text) from public,anon,authenticated,service_role;
drop function public.complete_destination_link(text,text);

create function public.complete_destination_link(
  p_game_key public.game_key,
  p_token text,
  p_external_player_id text
) returns uuid
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  link_session public.destination_link_sessions%rowtype;
  created_link_id uuid;
begin
  if p_token is null or length(p_token)<>64
     or p_external_player_id is null
     or length(btrim(p_external_player_id))=0
     or length(p_external_player_id)>200 then
    raise exception 'Invalid destination link proof' using errcode='22023';
  end if;

  select s.* into link_session
  from public.destination_link_sessions s
  join public.destination_integrations i on i.game_key=s.game_key
  where s.token_hash=encode(digest(convert_to(p_token,'UTF8'),'sha256'),'hex')
    and s.game_key=p_game_key
    and s.consumed_at is null
    and s.expires_at>now()
    and i.enabled=true
    and i.integration_state='ready'
  for update of s;

  if not found then
    raise exception 'Destination link proof is invalid, expired, already used, or for another destination'
      using errcode='28000';
  end if;

  -- The gateway authenticates the destination adapter before calling this function.
  -- The adapter must prove existing-account ownership or create the account before completion.
  insert into public.game_links(user_id,game_key,external_player_id)
  values(link_session.user_id,link_session.game_key,btrim(p_external_player_id))
  returning id into created_link_id;

  update public.destination_link_sessions
  set consumed_at=now()
  where id=link_session.id;

  insert into public.audit_log(actor,action,target_type,target_id,metadata)
  values(
    link_session.user_id,
    'destination.account_linked',
    'game_link',
    created_link_id::text,
    jsonb_build_object('game_key',link_session.game_key,'flow',link_session.flow)
  );

  return created_link_id;
end;
$$;

revoke all on function public.complete_destination_link(public.game_key,text,text) from public,anon,authenticated;
grant execute on function public.complete_destination_link(public.game_key,text,text) to service_role;
