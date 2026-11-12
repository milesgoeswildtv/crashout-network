begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select ok(
  pg_get_functiondef('public.complete_destination_link(public.game_key,text,text)'::regprocedure)
    like '%public.claim_destination_identity%',
  'one-time link completion delegates to the canonical identity claim'
);

select ok(
  position('insert into public.game_links' in lower(pg_get_functiondef('public.complete_destination_link(public.game_key,text,text)'::regprocedure))) = 0,
  'one-time link completion does not maintain a second game_links insertion path'
);

select ok(
  position('link_session.user_id' in pg_get_functiondef('public.complete_destination_link(public.game_key,text,text)'::regprocedure)) > 0
  and position('link_session.game_key' in pg_get_functiondef('public.complete_destination_link(public.game_key,text,text)'::regprocedure)) > 0,
  'completion uses the Crashout owner and destination bound to the one-time proof'
);

select ok(
  has_function_privilege('service_role','public.complete_destination_link(public.game_key,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.complete_destination_link(public.game_key,text,text)','EXECUTE'),
  'only the trusted adapter gateway can consume destination link proofs'
);

select ok(
  position('consumed_at = now()' in pg_get_functiondef('public.complete_destination_link(public.game_key,text,text)'::regprocedure)) > 0,
  'successful completion consumes the one-time proof'
);

select * from finish();
rollback;
