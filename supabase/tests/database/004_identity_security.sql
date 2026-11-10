-- Identity and privilege-boundary regression tests.
-- These assertions intentionally protect the current SECURITY DEFINER design:
-- privileged functions may be callable by authenticated users only when they
-- enforce the caller's identity/role inside the function body.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef
     and coalesce(array_to_string(p.proconfig,','),'') not like '%search_path=%'),
  0,
  'every public SECURITY DEFINER function pins its search_path'
);

select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef
     and has_function_privilege('anon',p.oid,'EXECUTE')),
  0,
  'anonymous users cannot execute public SECURITY DEFINER functions'
);

select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef
     and has_function_privilege('authenticated',p.oid,'EXECUTE')
     and position('auth.uid()' in pg_get_functiondef(p.oid))=0),
  0,
  'every authenticated-callable SECURITY DEFINER function binds behavior to auth.uid()'
);

select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef
     and p.proname in (
       'admin_find_players','admin_list_player_reports','admin_list_shop_products',
       'admin_network_overview','admin_review_player_report','admin_save_achievement',
       'admin_save_shop_product','admin_set_player_role'
     )
     and pg_get_functiondef(p.oid) not ilike '%is_admin()%'
     and pg_get_functiondef(p.oid) not ilike '%user_roles%'),
  0,
  'every exposed admin function enforces an administrator or moderator role'
);

select ok(
  not has_function_privilege('authenticated','public.complete_destination_link(public.game_key,text,text)','EXECUTE'),
  'browser-authenticated users cannot complete destination links'
);
select ok(
  has_function_privilege('service_role','public.complete_destination_link(public.game_key,text,text)','EXECUTE'),
  'only the trusted service role can execute destination-link completion'
);
select ok(
  has_function_privilege('authenticated','public.start_destination_link(public.game_key,text)','EXECUTE'),
  'signed-in users can start their own destination-link handshake'
);
select ok(
  not has_function_privilege('anon','public.start_destination_link(public.game_key,text)','EXECUTE'),
  'anonymous users cannot start destination-link handshakes'
);

select ok(not has_table_privilege('authenticated','public.destination_link_sessions','SELECT'),
  'authenticated clients cannot read private link-session records');
select ok(not has_table_privilege('anon','public.destination_link_sessions','SELECT'),
  'anonymous clients cannot read private link-session records');
select ok(not has_table_privilege('authenticated','public.achievement_events','SELECT'),
  'authenticated clients cannot read trusted achievement-ingestion events');
select ok(not has_table_privilege('anon','public.achievement_events','SELECT'),
  'anonymous clients cannot read trusted achievement-ingestion events');
select ok(not has_table_privilege('authenticated','public.player_reports','SELECT'),
  'authenticated clients cannot read moderation reports directly');
select ok(not has_table_privilege('anon','public.player_reports','SELECT'),
  'anonymous clients cannot read moderation reports directly');

select ok(
  exists(select 1 from pg_indexes where schemaname='public' and tablename='game_links'
    and indexdef ilike '%(user_id, game_key)%' and indexdef ilike 'create unique%'),
  'a CRASHOUT user can have at most one account link per destination'
);
select ok(
  exists(select 1 from pg_indexes where schemaname='public' and tablename='game_links'
    and indexdef ilike '%(game_key, external_player_id)%' and indexdef ilike 'create unique%'),
  'a destination account can belong to at most one CRASHOUT user'
);

select ok(not has_table_privilege('authenticated','public.destination_integrations','UPDATE'),
  'browser-authenticated users cannot change destination readiness');
select ok(not has_table_privilege('anon','public.destination_integrations','UPDATE'),
  'anonymous users cannot change destination readiness');

select * from finish();
rollback;
