-- Secure account provisioning. Apply after 0001_initial.sql.
-- The client never chooses its Player ID or role, and cannot update immutable identity fields.
revoke update on table public.profiles from authenticated;
grant update(display_name, avatar_url, updated_at) on table public.profiles to authenticated;

create or replace function public.provision_new_player()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate_id text;
  candidate_username text;
  base_username text;
  candidate_display text;
  suffix text;
  attempts integer := 0;
begin
  base_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username',''), '[^a-zA-Z0-9_]', '', 'g'));
  if length(base_username) < 3 then
    base_username := 'player';
  end if;
  base_username := left(base_username, 20);

  candidate_display := btrim(coalesce(new.raw_user_meta_data->>'display_name',''));
  if candidate_display = '' then
    candidate_display := base_username;
  end if;
  candidate_display := left(candidate_display, 32);

  -- Retry the complete insert on unique violations so simultaneous signups cannot
  -- race the preflight checks and abort account creation.
  loop
    candidate_id := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    candidate_username := base_username;
    if exists (select 1 from public.profiles where username = candidate_username) then
      suffix := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
      candidate_username := left(base_username, 15) || '_' || suffix;
    end if;

    begin
      insert into public.profiles(id, player_id, username, display_name)
      values (new.id, candidate_id, candidate_username, candidate_display);
      exit;
    exception when unique_violation then
      attempts := attempts + 1;
      if attempts > 25 then
        raise exception 'Unable to allocate unique player identity';
      end if;
    end;
  end loop;

  insert into public.user_roles(user_id, role)
  values (new.id, 'player')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_provision_player on auth.users;
create trigger on_auth_user_created_provision_player
after insert on auth.users
for each row execute function public.provision_new_player();

revoke all on function public.provision_new_player() from public, anon, authenticated;

-- No client-facing write policy exists for roles, wallets, ledger entries, game
-- links, or audit events. Trusted server functions are required for those actions.
