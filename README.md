# CRASHOUT Network — v0.1.0 foundation

Mobile-first React + TypeScript + Vite hub for the CRASHOUT network. CRASHOUT is the shared identity and discovery layer; Poker, SHYST, REALMS, RITUALS, DEGEN and future destinations retain their own gameplay services and economies.

## Local development
- Node.js 20+
- `npm install`
- Copy `.env.example` to `.env.local` and set Supabase URL + anon key when configured.
- `npm run dev`
- `npm run typecheck` and `npm run build`

## Status
The frontend now includes Supabase authentication flows, server-side profile provisioning, player directory and friend requests, private notifications, public player profile cards, editable identity settings, and a restricted admin overview with audited role management. The shop now has isolated per-game catalogs, atomic purchase processing, private inventory, and purchase receipts. Moderation report submission/review is implemented. Wallet provisioning/top-ups, item redemption/equip flows, and destination integrations are not complete. Role changes are superadministrator-only; superadministrator grants are disabled. No destination is represented as live without a verified integration.

Review `supabase/migrations/0001_initial.sql` before applying to a NEW Supabase project. Never expose service-role keys in browser code. Wallet and role mutations must be server-side, atomic, audited, and idempotent. Game currencies remain isolated.

First administrator setup is documented in `docs/ADMIN_BOOTSTRAP.md`; the first superadministrator must be assigned through the trusted Supabase SQL Editor, never from the client.

## Migration discipline
Apply the SQL files once, in numeric order, to a new Supabase project: `0001` through `0012` in numeric order, including `0010_achievements_progress.sql`, `0011_player_avatars.sql`, and `0012_public_profile_avatars.sql`. The CI migration checker verifies required files and selected security invariants, but does not execute SQL or replace a live database migration test. Do not skip migrations or apply them out of order. Back up an existing project before introducing these schema changes.

## Account setup
The account screens call Supabase Auth directly. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the local environment or hosting provider. Apply every migration in order: `0001_initial.sql`, `0002_secure_player_provisioning.sql`, `0003_social_foundation.sql`, `0004_player_identity_settings.sql`, `0005_admin_foundation.sql`, `0006_public_player_profiles.sql`, and `0007_network_indexes.sql`, `0008_player_reporting_moderation.sql`, and `0009_shop_inventory.sql`, and `0010_achievements_progress.sql`, and `0011_player_avatars.sql`. Configure Supabase email confirmation and allowed redirect URLs for the deployed origin. The database trigger provisions the profile, six-character Player ID, and default player role when an auth user is created. The client cannot set Player IDs or roles. Social actions run through authenticated database functions; direct client writes to friendship and notification tables are revoked.

The project does not contain Supabase project credentials. Until a project is configured and migrations are applied, the interface intentionally reports that account services are not connected.


## Reporting and moderation
Migration `0008_player_reporting_moderation.sql` adds authenticated player reports and a moderator queue. Players can report another player from that player's public profile using a fixed category and optional details. A reporter cannot report themselves or create multiple active reports against the same target. Reports are not directly readable or writable from the browser; submission, queue access, and review transitions use scoped database functions. Moderators can take a report for review, resolve it, or dismiss it. Every submission and review transition is written to the audit log. This initial workflow does not suspend accounts, ban players, or automatically decide whether a report is valid.


## Shop and game economies
Migration `0009_shop_inventory.sql` adds per-game product catalogs, private player inventory, purchase receipts, and a server-side purchase function. Every product belongs to exactly one game and one currency code. The purchase function locks the product and wallet, checks stock and per-player limits, debits only the matching game's wallet, records a ledger entry and receipt, and grants inventory in one database transaction. A failure rolls back the entire purchase. Players cannot write balances, ledger entries, product records, receipts, or inventory directly.

Products are inactive by default and must be published through the administrator-only `admin_save_shop_product` function. Purchases intentionally fail when a player has no wallet provisioned for that exact game/currency pair; this migration does not mint currency or create balances. No currency exchange or cross-game transfers exist. Inventory is currently an ownership record; game-specific equip, consume, or redemption actions must be implemented by the owning destination rather than assumed by the hub.


Shop UI and catalog administration are included in the current CI validation scope; database execution still requires a configured Supabase project.


## Achievements and verified progression
Migration 0010 adds network- and game-scoped achievement definitions, private player progress, award records, and idempotent event ingestion. The Rankings screen now displays database-backed network counts and achievement progress. Administrators can define and publish achievements. Only trusted destination services using a server-side service-role credential may call ingest_achievement_event; browser clients cannot submit activity, edit progress, or grant awards. See docs/ACHIEVEMENT_INTEGRATION.md for the event contract. This does not create shared currencies or imply any destination integration is active. SQL still requires execution and verification in a configured Supabase project.


## Player avatars
Migration 0011 provisions the public-read `player-avatars` Storage bucket with a 2 MB limit and JPEG/PNG/WebP MIME allowlist. Authenticated players can upload, replace, or remove only objects under their own auth UUID folder. The account screen updates the profile avatar URL; social directory cards render it. Storage policies are not live until the migration is applied to the configured Supabase project.

Migration 0012 extends the authenticated public-profile RPC to include the player's avatar URL while retaining the existing block-aware visibility rules. Public profile cards do not expose private account or contact data.
