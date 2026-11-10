-- OAuth client isolation regression tests.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select ok(
  exists(select 1 from pg_roles where rolname='crashout_oauth_client' and not rolcanlogin and not rolbypassrls),
  'OAuth access tokens use a non-login, non-bypass role'
);
select ok(
  pg_has_role('authenticator','crashout_oauth_client','MEMBER'),
  'PostgREST authenticator may switch to the isolated OAuth role'
);
select ok(
  not pg_has_role('crashout_oauth_client','authenticated','MEMBER')
  and not pg_has_role('crashout_oauth_client','anon','MEMBER'),
  'the OAuth role does not inherit anon or authenticated permissions'
);
select ok(
  not has_schema_privilege('crashout_oauth_client','public','CREATE'),
  'OAuth role cannot create objects in public schema'
);

select is(
  (select count(*)::integer
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','v','m')
     and (has_table_privilege('crashout_oauth_client',c.oid,'SELECT')
       or has_table_privilege('crashout_oauth_client',c.oid,'INSERT')
       or has_table_privilege('crashout_oauth_client',c.oid,'UPDATE')
       or has_table_privilege('crashout_oauth_client',c.oid,'DELETE'))),
  0,
  'OAuth role has no direct table or view privileges'
);
select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef
     and has_function_privilege('crashout_oauth_client',p.oid,'EXECUTE')),
  0,
  'OAuth role cannot execute public RPC functions'
);

select ok(
  has_function_privilege('supabase_auth_admin','public.custom_access_token_hook(jsonb)','EXECUTE'),
  'only Supabase Auth admin can execute the custom access-token hook'
);
select ok(
  not has_function_privilege('anon','public.custom_access_token_hook(jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.custom_access_token_hook(jsonb)','EXECUTE'),
  'browser roles cannot call the custom access-token hook'
);
select ok(
  (select prosecdef from pg_proc where oid='public.custom_access_token_hook(jsonb)'::regprocedure),
  'custom access-token hook executes with its controlled definer privileges'
);
select ok(
  (select coalesce(array_to_string(proconfig,','),'') like '%search_path=%'
   from pg_proc where oid='public.custom_access_token_hook(jsonb)'::regprocedure),
  'custom access-token hook pins an empty search_path'
);

select is(
  public.custom_access_token_hook(
    '{"claims":{"role":"authenticated","aud":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}}'::jsonb
  )->'claims'->>'role',
  'authenticated',
  'ordinary CRASHOUT user sessions keep their existing database role'
);
select is(
  public.custom_access_token_hook(
    '{"claims":{"role":"authenticated","aud":"authenticated","sub":"11111111-1111-1111-1111-111111111111","client_id":"shyst-staging-client"}}'::jsonb
  )->'claims'->>'role',
  'crashout_oauth_client',
  'OAuth client access tokens are switched to the isolated database role'
);
select is(
  public.custom_access_token_hook(
    '{"claims":{"role":"authenticated","aud":"authenticated","sub":"11111111-1111-1111-1111-111111111111","client_id":"shyst-staging-client"}}'::jsonb
  )->'claims'->>'sub',
  '11111111-1111-1111-1111-111111111111',
  'OAuth client role isolation preserves the canonical user subject'
);
select is(
  public.custom_access_token_hook(
    '{"claims":{"role":"authenticated","aud":"authenticated","sub":"11111111-1111-1111-1111-111111111111","client_id":"shyst-staging-client"}}'::jsonb
  )->'claims'->>'client_id',
  'shyst-staging-client',
  'OAuth client role isolation preserves the registered client id'
);

select is(
  (select count(*)::integer
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relrowsecurity
     and (
       has_table_privilege('anon',c.oid,'SELECT')
       or has_table_privilege('anon',c.oid,'INSERT')
       or has_table_privilege('anon',c.oid,'UPDATE')
       or has_table_privilege('anon',c.oid,'DELETE')
       or has_table_privilege('authenticated',c.oid,'SELECT')
       or has_table_privilege('authenticated',c.oid,'INSERT')
       or has_table_privilege('authenticated',c.oid,'UPDATE')
       or has_table_privilege('authenticated',c.oid,'DELETE')
     )
     and not exists(
       select 1 from pg_policies p
       where p.schemaname='public' and p.tablename=c.relname
         and p.policyname='oauth_id_token_audience_guard'
         and p.permissive='RESTRICTIVE'
         and 'anon'=any(p.roles) and 'authenticated'=any(p.roles)
         and p.qual ilike '%data_api_token_audience_allowed%'
         and p.with_check ilike '%data_api_token_audience_allowed%'
     )),
  0,
  'every exposed RLS table rejects OAuth ID tokens while preserving native anon and user JWTs'
);


select ok(
  has_function_privilege('anon','public.data_api_token_audience_allowed()','EXECUTE')
  and has_function_privilege('authenticated','public.data_api_token_audience_allowed()','EXECUTE'),
  'native anon and authenticated roles can evaluate the Data API audience guard'
);
select ok(
  not has_function_privilege('crashout_oauth_client','public.data_api_token_audience_allowed()','EXECUTE'),
  'isolated OAuth clients cannot invoke the Data API audience guard'
);

select set_config('request.jwt.claims','{"iss":"supabase","ref":"local-project","role":"anon"}',true);
select ok(
  public.data_api_token_audience_allowed(),
  'the native anonymous API key remains allowed through the audience guard'
);
select set_config('request.jwt.claims','{"iss":"https://local-project.supabase.co/auth/v1","aud":"authenticated","role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}',true);
select ok(
  public.data_api_token_audience_allowed(),
  'ordinary signed-in CRASHOUT sessions remain allowed through the audience guard'
);
select set_config('request.jwt.claims','{"iss":"https://local-project.supabase.co/auth/v1","aud":"shyst-staging-client","role":"authenticated","sub":"11111111-1111-1111-1111-111111111111"}',true);
select ok(
  not public.data_api_token_audience_allowed(),
  'OIDC ID tokens are rejected as Data API credentials by their client audience'
);
select set_config('request.jwt.claims','{"iss":"https://local-project.supabase.co/auth/v1","aud":"authenticated","role":"crashout_oauth_client","client_id":"shyst-staging-client","sub":"11111111-1111-1111-1111-111111111111"}',true);
select ok(
  not public.data_api_token_audience_allowed(),
  'OAuth access tokens are rejected by the Data API audience guard after role isolation'
);


select set_config('request.jwt.claims','{"iss":"https://local-project.supabase.co/auth/v1","aud":"authenticated","role":"authenticated","client_id":"shyst-staging-client","sub":"11111111-1111-1111-1111-111111111111"}',true);
select ok(
  not public.data_api_token_audience_allowed(),
  'OAuth access tokens with client_id are rejected even if their role claim is still authenticated'
);

select * from finish();
rollback;
