import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migrations = [
  '0001_initial.sql',
  '0002_secure_player_provisioning.sql',
  '0003_social_foundation.sql',
  '0004_player_identity_settings.sql',
  '0005_admin_foundation.sql',
  '0006_public_player_profiles.sql',
  '0007_network_indexes.sql',
  '0008_player_reporting_moderation.sql',
  '0009_shop_inventory.sql',
  '0010_achievements_progress.sql',
  '0011_player_avatars.sql',
  '0012_public_profile_avatars.sql',
  '0013_destination_registry_linking.sql',
  '0014_destination_adapter_gateway.sql',
  '0015_oauth_client_isolation.sql',
];
for (const name of migrations) {
  const path = new URL('../supabase/migrations/' + name, import.meta.url);
  const sql = readFileSync(path, 'utf8');
  assert.ok(sql.trim().length > 0, name + ' must not be empty');
}
const sql = readFileSync(new URL('../supabase/migrations/0010_achievements_progress.sql', import.meta.url), 'utf8');
const required = [
  'alter table public.achievement_events enable row level security',
  'revoke all on public.achievement_progress,public.achievement_events,public.player_achievements from anon,authenticated',
  'grant execute on function public.ingest_achievement_event(uuid,public.game_key,text,text,bigint) to service_role',
  'revoke all on function public.ingest_achievement_event(uuid,public.game_key,text,text,bigint) from public,anon,authenticated',
  'nulls not distinct',
  'on conflict do nothing returning id into inserted_id',
  'public.admin_save_achievement',
  'public.get_network_progress',
];
for (const fragment of required) assert.ok(sql.includes(fragment), 'Missing SQL safety invariant: ' + fragment);
assert.ok(!/grant\s+execute\s+on\s+function\s+public\.ingest_achievement_event[^;]*to\s+authenticated/i.test(sql),
  'Achievement ingestion must never be executable by authenticated browser clients');
const avatarSql = readFileSync(new URL('../supabase/migrations/0011_player_avatars.sql', import.meta.url), 'utf8');
for (const fragment of ["values('player-avatars','player-avatars',true,2097152", "'image/jpeg','image/png','image/webp'", "storage.foldername(name))[1]=auth.uid()::text", 'players delete own avatar']) {
  assert.ok(avatarSql.includes(fragment), 'Missing avatar storage safety invariant: ' + fragment);
}

const publicAvatarSql = readFileSync(new URL('../supabase/migrations/0012_public_profile_avatars.sql', import.meta.url), 'utf8');
assert.ok(publicAvatarSql.includes('avatar_url text'), 'Public profile RPC must include avatar URL');
assert.ok(publicAvatarSql.includes('not exists(select 1 from public.user_blocks'), 'Public profile RPC must preserve block visibility checks');

console.log('Migration structure, achievement trust boundaries, avatar ownership, and public-profile privacy checks passed (SQL execution is still required against Supabase).');

const destinationSql = readFileSync(new URL('../supabase/migrations/0013_destination_registry_linking.sql', import.meta.url), 'utf8');
for (const fragment of [
  "integration_state in ('disabled','adapter_required','ready','maintenance')",
  "check (not enabled or (integration_state = 'ready' and launch_url is not null))",
  "encode(digest(convert_to(raw_token,'UTF8'),'sha256'),'hex')",
  "expires_at>now()",
  "revoke all on function public.complete_destination_link(text,text) from public,anon,authenticated",
  "grant execute on function public.complete_destination_link(text,text) to service_role",
  "grant execute on function public.start_destination_link(public.game_key,text) to authenticated",
]) assert.ok(destinationSql.includes(fragment), 'Missing destination-linking safety invariant: ' + fragment);
assert.ok(!/grant\s+execute\s+on\s+function\s+public\.complete_destination_link[^;]*to\s+authenticated/i.test(destinationSql),
  'Only trusted destination adapters may complete destination links');

console.log('Destination registry and link-session trust-boundary checks passed.');

const gatewaySql = readFileSync(new URL('../supabase/migrations/0014_destination_adapter_gateway.sql', import.meta.url), 'utf8');
for (const fragment of [
  'p_game_key public.game_key',
  'and s.game_key=p_game_key',
  'and i.enabled=true',
  'grant execute on function public.complete_destination_link(public.game_key,text,text) to service_role',
]) assert.ok(gatewaySql.includes(fragment), 'Missing adapter-gateway database invariant: ' + fragment);

const adapterAuth = readFileSync(new URL('../supabase/functions/_shared/adapter-auth.ts', import.meta.url), 'utf8');
for (const fragment of [
  'CRASHOUT_SHYST_ADAPTER_KEY_SHA256',
  'CRASHOUT_POKER_ADAPTER_KEY_SHA256',
  'CRASHOUT_REALMS_ADAPTER_KEY_SHA256',
  'CRASHOUT_RITUALS_ADAPTER_KEY_SHA256',
  'CRASHOUT_DEGEN_ADAPTER_KEY_SHA256',
  'CRASHOUT_MMO_ADAPTER_KEY_SHA256',
  'x-crashout-adapter-key',
  'constantTimeEqual',
  'Deno.env.get',
]) assert.ok(adapterAuth.includes(fragment), 'Missing shared adapter-auth security invariant: ' + fragment);

const gateway = readFileSync(new URL('../supabase/functions/complete-destination-link/index.ts', import.meta.url), 'utf8');
assert.ok(gateway.includes('authenticateAdapter(request, gameKey)'), 'Link completion must use shared destination adapter authentication');
assert.ok(gateway.includes('p_game_key: gameKey'), 'Link completion must bind the adapter to its requested destination');

const resolver = readFileSync(new URL('../supabase/functions/resolve-destination-identity/index.ts', import.meta.url), 'utf8');
for (const fragment of ['authenticateAdapter(request, gameKey)', 'destination_integrations', 'integration_state', 'game_links', 'external_player_id']) {
  assert.ok(resolver.includes(fragment), 'Missing destination identity resolver invariant: ' + fragment);
}
assert.ok(!resolver.includes('email'), 'Identity resolver must not return email or profile data');

const oauthIsolation = readFileSync(new URL('../supabase/migrations/0015_oauth_client_isolation.sql', import.meta.url), 'utf8');
for (const fragment of [
  'crashout_oauth_client',
  'custom_access_token_hook',
  "claims->>'client_id'",
  'data_api_token_audience_allowed',
  'oauth_id_token_audience_guard',
  'NOBYPASSRLS',
]) assert.ok(oauthIsolation.includes(fragment), 'Missing OAuth token isolation invariant: ' + fragment);

const supabaseConfig = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
assert.ok(supabaseConfig.includes('[functions.resolve-destination-identity]'), 'Identity resolver must be registered in Supabase config');
assert.ok(supabaseConfig.includes('uri = "pg-functions://postgres/public/custom_access_token_hook"'), 'Local Auth must run the custom access-token hook');

console.log('Destination adapter authentication, identity resolver, and OAuth token-isolation checks passed.');
