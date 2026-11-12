-- Unify both directions of the CRASHOUT <-> destination link handshake.
-- OIDC claims and one-time destination-link sessions must share one atomic
-- identity claim path so uniqueness, idempotency, and auditing are identical.

create or replace function public.complete_destination_link(
  p_game_key public.game_key,
  p_token text,
  p_external_player_id text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  link_session public.destination_link_sessions%rowtype;
  claim_result jsonb;
  created_link_id uuid;
begin
  if p_token is null
     or length(p_token) <> 64
     or p_external_player_id is null
     or length(btrim(p_external_player_id)) = 0
     or length(btrim(p_external_player_id)) > 200 then
    raise exception 'Invalid destination link proof'
      using errcode = '22023';
  end if;

  select s.*
    into link_session
    from public.destination_link_sessions s
    join public.destination_integrations i
      on i.game_key = s.game_key
   where s.token_hash = encode(digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
     and s.game_key = p_game_key
     and s.consumed_at is null
     and s.expires_at > now()
     and i.enabled = true
     and i.integration_state = 'ready'
   for update of s;

  if not found then
    raise exception 'Destination link proof is invalid, expired, already used, or for another destination'
      using errcode = '28000';
  end if;

  -- This is the same atomic claim function used by the OIDC sign-in/link path.
  -- It serializes both identities, permits an exact repeat, and rejects either
  -- identity being attached to a different account.
  claim_result := public.claim_destination_identity(
    link_session.game_key,
    link_session.user_id,
    btrim(p_external_player_id)
  );

  if coalesce((claim_result ->> 'linked')::boolean, false) is not true
     or claim_result ->> 'link_id' is null then
    raise exception 'Destination identity claim did not complete'
      using errcode = '55000';
  end if;

  created_link_id := (claim_result ->> 'link_id')::uuid;

  update public.destination_link_sessions
     set consumed_at = now()
   where id = link_session.id;

  return created_link_id;
end;
$$;

revoke all on function public.complete_destination_link(public.game_key, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_destination_link(public.game_key, text, text)
  to service_role;

comment on function public.complete_destination_link(public.game_key, text, text) is
  'Consumes a one-time destination link proof and delegates identity creation to claim_destination_identity so all linking directions share atomic uniqueness and idempotency.';
