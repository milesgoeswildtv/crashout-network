-- Player reporting and moderator review queue.
-- Reports are private to the reporting player and authorized moderators/admins.
create table public.player_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('harassment','cheating','impersonation','spam','other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  moderator_id uuid references auth.users(id),
  moderator_note text not null default '' check (char_length(moderator_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reporter_id <> target_id)
);
create index player_reports_status_created_idx on public.player_reports(status, created_at desc);
create index player_reports_target_idx on public.player_reports(target_id, created_at desc);
alter table public.player_reports enable row level security;
revoke all on public.player_reports from anon, authenticated;

create or replace function public.submit_player_report(
  target_player_id text,
  report_category text,
  report_details text default ''
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare target_user uuid; report_uuid uuid; clean_details text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if report_category is null or report_category not in ('harassment','cheating','impersonation','spam','other') then
    raise exception 'Choose a valid report category';
  end if;
  clean_details := trim(coalesce(report_details,''));
  if char_length(clean_details) > 1000 then raise exception 'Details must be 1000 characters or fewer'; end if;
  select id into target_user from public.profiles
    where player_id=upper(trim(target_player_id));
  if target_user is null then raise exception 'Player not found'; end if;
  if target_user=auth.uid() then raise exception 'You cannot report your own account'; end if;
  if exists(select 1 from public.player_reports
    where reporter_id=auth.uid() and target_id=target_user and status in ('open','reviewing')) then
    raise exception 'You already have an active report for this player';
  end if;
  insert into public.player_reports(reporter_id,target_id,category,details)
    values(auth.uid(),target_user,report_category,clean_details)
    returning id into report_uuid;
  insert into public.audit_log(actor,action,target_type,target_id,metadata)
    values(auth.uid(),'player.report_submitted','player_report',report_uuid::text,
      jsonb_build_object('category',report_category));
  return report_uuid;
end;
$$;

create or replace function public.admin_list_player_reports(report_status text default 'open')
returns table(
  id uuid, category text, details text, status text, moderator_note text,
  created_at timestamptz, reporter_player_id text, reporter_username text,
  target_player_id text, target_username text
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists(
    select 1 from public.user_roles where user_id=auth.uid()
      and role in ('moderator','admin','superadmin')
  ) then raise exception 'Moderator access required'; end if;
  if report_status not in ('open','reviewing','resolved','dismissed','all') then
    raise exception 'Invalid report filter';
  end if;
  return query
    select r.id,r.category,r.details,r.status,r.moderator_note,r.created_at,
      rp.player_id,rp.username,tp.player_id,tp.username
    from public.player_reports r
    join public.profiles rp on rp.id=r.reporter_id
    join public.profiles tp on tp.id=r.target_id
    where report_status='all' or r.status=report_status
    order by case r.status when 'open' then 0 when 'reviewing' then 1 else 2 end,
      r.created_at asc
    limit 100;
end;
$$;

create or replace function public.admin_review_player_report(
  report_id uuid, decision text, review_note text default ''
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare report_row public.player_reports%rowtype; clean_note text;
begin
  if auth.uid() is null or not exists(
    select 1 from public.user_roles where user_id=auth.uid()
      and role in ('moderator','admin','superadmin')
  ) then raise exception 'Moderator access required'; end if;
  if decision not in ('reviewing','resolved','dismissed') then
    raise exception 'Invalid moderation decision';
  end if;
  clean_note := trim(coalesce(review_note,''));
  if char_length(clean_note)>1000 then raise exception 'Review note must be 1000 characters or fewer'; end if;
  select * into report_row from public.player_reports where id=report_id for update;
  if not found then raise exception 'Report not found'; end if;
  if report_row.status in ('resolved','dismissed') then
    raise exception 'This report has already been closed';
  end if;
  update public.player_reports set status=decision, moderator_id=auth.uid(),
    moderator_note=clean_note, updated_at=now() where id=report_id;
  insert into public.audit_log(actor,action,target_type,target_id,metadata)
    values(auth.uid(),'moderation.report_'||decision,'player_report',report_id::text,
      jsonb_build_object('target_user_id',report_row.target_id,'category',report_row.category));
end;
$$;

revoke all on function public.submit_player_report(text,text,text) from public, anon;
revoke all on function public.admin_list_player_reports(text) from public, anon;
revoke all on function public.admin_review_player_report(uuid,text,text) from public, anon;
grant execute on function public.submit_player_report(text,text,text) to authenticated;
grant execute on function public.admin_list_player_reports(text) to authenticated;
grant execute on function public.admin_review_player_report(uuid,text,text) to authenticated;

-- Moderators can access the restricted console, but cannot change player roles.
create or replace function public.admin_network_overview()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(
    select 1 from public.user_roles where user_id=auth.uid()
      and role in ('moderator','admin','superadmin')
  ) then raise exception 'Moderator access required'; end if;
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
revoke all on function public.admin_network_overview() from public, anon;
grant execute on function public.admin_network_overview() to authenticated;
