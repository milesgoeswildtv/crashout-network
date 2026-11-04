-- Player identity editing. Player ID and role remain immutable to the player.
create or replace function public.update_player_identity(new_username text, new_display_name text)
returns table(player_id text, username text, display_name text, updated_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_username text := lower(trim(coalesce(new_username,'')));
  clean_display text := btrim(coalesce(new_display_name,''));
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if clean_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username must be 3–20 letters, numbers, or underscores';
  end if;
  if char_length(clean_display) not between 1 and 32 then
    raise exception 'Display name must be 1–32 characters';
  end if;
  if exists(select 1 from public.profiles p where lower(p.username)=clean_username and p.id<>actor) then
    raise exception 'That username is already taken';
  end if;

  update public.profiles p
    set username=clean_username, display_name=clean_display, updated_at=now()
    where p.id=actor;

  if not found then raise exception 'Player profile not found'; end if;

  insert into public.audit_log(actor,action,target_type,target_id,metadata)
    values(actor,'player.identity_updated','profile',actor::text,
      jsonb_build_object('username',clean_username));

  return query select p.player_id,p.username,p.display_name,p.updated_at
    from public.profiles p where p.id=actor;
end;
$$;

revoke all on function public.update_player_identity(text,text) from public, anon;
grant execute on function public.update_player_identity(text,text) to authenticated;
