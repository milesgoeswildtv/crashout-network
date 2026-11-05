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
  "coalesce(game_key::text,'network')",
  'on conflict do nothing returning id into inserted_id',
  'public.admin_save_achievement',
  'public.get_network_progress',
];
for (const fragment of required) assert.ok(sql.includes(fragment), 'Missing SQL safety invariant: ' + fragment);
assert.ok(!/grant\s+execute\s+on\s+function\s+public\.ingest_achievement_event[^;]*to\s+authenticated/i.test(sql),
  'Achievement ingestion must never be executable by authenticated browser clients');
console.log('Migration structure and achievement trust-boundary checks passed (SQL execution is still required against Supabase).');
