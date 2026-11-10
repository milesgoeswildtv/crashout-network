-- Isolate OAuth relying-party tokens from CRASHOUT's direct Data API.
-- OAuth clients receive identity tokens, not the ability to query CRASHOUT's
-- internal database or invoke its user/admin SECURITY DEFINER RPCs.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crashout_oauth_client') THEN
    CREATE ROLE crashout_oauth_client NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

-- PostgREST's authenticator may SET ROLE to this deliberately privilege-free role.
GRANT crashout_oauth_client TO authenticator;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claims jsonb := COALESCE(event->'claims', '{}'::jsonb);
BEGIN
  -- Supabase OAuth Server places its registered OAuth client id in this claim.
  -- Keep ordinary CRASHOUT browser sessions unchanged; OAuth client access
  -- tokens are issued under a role with no schema/table/function privileges.
  IF NULLIF(claims->>'client_id', '') IS NOT NULL THEN
    claims := jsonb_set(
      claims,
      '{role}',
      to_jsonb('crashout_oauth_client'::text),
      true
    );
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;

-- OIDC ID tokens are for identity, not Data API authorization. Their audience
-- is the OAuth client id, unlike Supabase anon/authenticated access tokens.
-- Apply a restrictive guard to every RLS-enabled public table exposed to either
-- API role. Future migrations adding exposed tables are required to add this
-- guard too; the pgTAP suite enforces coverage.
DO $$
DECLARE
  table_row record;
BEGIN
  FOR table_row IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND (
        has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('anon', c.oid, 'INSERT')
        OR has_table_privilege('anon', c.oid, 'UPDATE')
        OR has_table_privilege('anon', c.oid, 'DELETE')
        OR has_table_privilege('authenticated', c.oid, 'SELECT')
        OR has_table_privilege('authenticated', c.oid, 'INSERT')
        OR has_table_privilege('authenticated', c.oid, 'UPDATE')
        OR has_table_privilege('authenticated', c.oid, 'DELETE')
      )
  LOOP
    EXECUTE format(
      'CREATE POLICY oauth_id_token_audience_guard ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING ((auth.jwt() ->> ''aud'') IN (''anon'', ''authenticated'')) WITH CHECK ((auth.jwt() ->> ''aud'') IN (''anon'', ''authenticated''))',
      table_row.relname
    );
  END LOOP;
END
$$;
