begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

select ok(to_regclass('public.profiles') is not null, 'player identity table exists');
select ok(to_regclass('public.achievement_definitions') is not null, 'achievement definitions exist');
select ok(to_regclass('public.achievement_progress') is not null, 'private achievement progress exists');
select ok(
  not has_function_privilege('authenticated',
    'public.ingest_achievement_event(uuid,public.game_key,text,text,bigint)', 'EXECUTE'),
  'browser-authenticated users cannot ingest trusted achievement events'
);
select ok(
  has_function_privilege('service_role',
    'public.ingest_achievement_event(uuid,public.game_key,text,text,bigint)', 'EXECUTE'),
  'trusted service role can ingest achievement events'
);
select ok(
  not has_table_privilege('authenticated','public.achievement_progress','INSERT'),
  'players cannot insert their own achievement progress'
);
select ok(
  not has_table_privilege('authenticated','public.player_achievements','INSERT'),
  'players cannot grant themselves achievement awards'
);

select * from finish();
rollback;
