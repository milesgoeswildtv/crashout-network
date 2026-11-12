-- Atomic, proof-based first-time claim for an existing destination account.
-- Called only after the destination adapter authenticates and independently
-- validates the CRASHOUT OIDC ID token (issuer, signature, audience, nonce, expiry).
create or replace function public.claim_destination_identity(
  p_game_key public.game_key,
  p_crashout_user_id uuid,
  p_external_player_id text
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  existing_by_user public.game_links%rowtype;
  existing_by_player public.game_links%rowtype;
  created_link public.game_links%rowtype;
begin
  if p_external_player_id is null
     or length(btrim(p_external_player_id)) = 0
     or length(p_external_player_id) > 200 then
    raise exception 'Invalid destination player identity' using errcode='22023';
  end if;

  if not exists (
    select 1 from public.destination_integrations
    where game_key = p_game_key and enabled = true and integration_state = 'ready'
  ) then
    raise exception 'Destination is not ready for identity claims' using errcode='55000';
  end if;

  -- Serialize claims for this destination and both identities.
  perform pg_advisory_xact_lock(hashtextextended(p_game_key::text || ':' || p_crashout_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_game_key::text || ':' || btrim(p_external_player_id), 0));

  select * into existing_by_user from public.game_links
    where game_key = p_game_key and user_id = p_crashout_user_id;
  select * into existing_by_player from public.game_links
    where game_key = p_game_key and external_player_id = btrim(p_external_player_id);

  if existing_by_user.id is not null or existing_by_player.id is not null then
    if existing_by_user.id is not null
       and existing_by_player.id is not null
       and existing_by_user.id = existing_by_player.id then
      return jsonb_build_object('ok', true, 'linked', true, 'already_linked', true, 'link_id', existing_by_user.id);
    end if;
    raise exception 'Destination identity is already linked to a different account' using errcode='23505';
  end if;

  insert into public.game_links(user_id, game_key, external_player_id)
  values (p_crashout_user_id, p_game_key, btrim(p_external_player_id))
  returning * into created_link;

  insert into public.audit_log(actor, action, target_type, target_id, metadata)
  values (
    p_crashout_user_id,
    'destination.sso_identity_claimed',
    'game_link',
    created_link.id::text,
    jsonb_build_object('game_key', p_game_key, 'external_player_id', btrim(p_external_player_id))
  );

  return jsonb_build_object('ok', true, 'linked', true, 'already_linked', false, 'link_id', created_link.id);
end;
$$;

revoke all on function public.claim_destination_identity(public.game_key, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_destination_identity(public.game_key, uuid, text) to service_role;
