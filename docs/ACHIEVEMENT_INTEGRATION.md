# Achievement and activity integration contract

Migration: 0010_achievements_progress.sql.

## Trust boundary
The hub never accepts achievement progress from a player browser. A destination backend must authenticate its own player/session, resolve that player to the hub Supabase auth user UUID using its trusted account-link mapping, then call ingest_achievement_event with its server-side Supabase service-role credential. Never put the service-role key in a game client, browser bundle, mobile app, or chat.

## Event contract
Arguments:
- p_user_id: hub auth.users UUID belonging to the verified player.
- p_game_key: shyst, poker, realms, rituals, degen, mmo. Network-wide achievements use NULL only for genuinely network-scoped events.
- p_event_code: stable achievement code configured by an administrator.
- p_source_event_id: immutable ID for the source game's completed match, session, or event. Reuse this exact ID on retries.
- p_amount: positive increment, capped at 1,000,000 per event.

The database deduplicates (player, game_key, event_code, source_event_id), then updates only active matching definitions and awards an achievement when its target is reached. Replayed events do not increment progress. A destination must not send events until it can securely map its authenticated player to the hub user. Do not guess external IDs or invent integration endpoints.

## Scope and economy isolation
Game achievements match only the corresponding game_key. Network achievements are separate definitions with NULL game key and can be driven only by explicitly network-scoped trusted events. This system does not award currency, alter game wallets, or share inventories.

## Verification status
Frontend typecheck/build validates the UI only. SQL has not been executed against a configured Supabase project. No destination is connected to this event contract yet, so current stats show only database-backed network player/friend counts and published/earned achievement counts. No activity, wins, playtime, or leaderboards are fabricated.
